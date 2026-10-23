import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('system resources integrates live network totals and rates without header network controls', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {HeaderResources} from '${root}/src/components/header-resources.tsx';
import {SystemStatsModal} from '${root}/src/components/SystemStatsModal.tsx';
import {ActiveSessionsButton} from '${root}/src/components/active-sessions-button.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {useI18n} from '${root}/src/i18n.tsx';
import {networkUsage,desktopUsageReporter} from '${root}/src/utils/network-usage.ts';
import {startNetworkTracking} from '${root}/src/utils/network-tracking.ts';
localStorage.setItem('mew:locale','ko');window.usage=()=>networkUsage.getSnapshot();window.remote=desktopUsageReporter();window.nextRemote=()=>window.remote=desktopUsageReporter();window.stopTracking=startNetworkTracking();
function Fixture(){window.locale=useI18n().setLocale;const [open,setOpen]=React.useState(false);return <><header className="flex h-10 items-center gap-1.5 px-2 md:h-12 md:gap-3"><span className="min-w-0 flex-1 truncate">mew</span><HeaderResources onOpen={()=>setOpen(true)}/><ActiveSessionsButton presence={{selfId:'one',sessions:[]}} profile={{email:'owner@example.test',displayName:'Owner',avatarDataUrl:null}}/></header>{open&&<SystemStatsModal onClose={()=>setOpen(false)}/>}</>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);
window.socketRoundTrip=url=>new Promise((resolve,reject)=>{const socket=new WebSocket(url);socket.binaryType='arraybuffer';socket.onopen=()=>socket.send('한글');socket.onmessage=()=>{socket.close();resolve()};socket.onerror=reject});
window.streamRoundTrip=async()=>{const abort=new AbortController();const response=await fetch('/api/stream',{signal:abort.signal});window.streamURL=response.url;const reader=response.body.getReader();await reader.read();await reader.read();abort.abort();try{await reader.read()}catch(error){window.aborted=error.name==='AbortError'}};
window.cloneRoundTrip=async()=>{const response=await fetch('/api/stream-finite');const clone=response.clone();window.cloneURL=clone.url;return Promise.all([response.text(),clone.text()])};`
  const bundle = await build({ input: 'virtual:network.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:network.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:network.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/network-usage-panel.tsx', 'src/components/header-resources.tsx', 'src/components/SystemStatsModal.tsx', 'src/components/active-sessions-button.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/api/system-stats') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ cpu: { usage: 12, cores: 4, model: 'Fixture CPU', temperature: null, loadavg: [0, 0, 0] }, memory: { used: 1000, total: 2000, available: 1000 }, gpus: [], processes: [], hostname: 'network-fixture', uptime: 60 })); return }
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(chunk.code); return }
    if (request.url === '/api/stream') {
      response.setHeader('Content-Type', 'text/event-stream'); response.flushHeaders(); response.write('data: one\n\n')
      const timer = setTimeout(() => response.write('data: two\n\n'), 50)
      request.on('close', () => clearTimeout(timer)); return
    }
    if (request.url === '/api/stream-finite') { response.setHeader('Content-Type', 'text/event-stream'); response.end('data: clone\n\n'); return }
    if (request.url === '/api/payload' || request.url === '/api/remote-desktop/status') { response.setHeader('Content-Type', 'text/plain'); response.end('한글'); return }
    response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`)
  })
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', socket => socket.on('message', (data, binary) => socket.send(data, { binary })))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    page.setDefaultTimeout(5000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(base)
    const usageButton = page.getByRole('button', { name: '시스템 자원 보기', exact: true })
    await usageButton.waitFor()
    await page.waitForTimeout(100)
    const initial = await page.evaluate('window.usage()') as { other: { received: number; sent: number }; desktop: { received: number; sent: number } }
    assert.ok(initial.other.received > 0, 'initial resource transfer is included')
    await page.evaluate(`fetch('/api/payload',{method:'POST',body:'한글'}).then(response=>response.text())`)
    await page.waitForFunction(`window.usage().other.received >= ${initial.other.received + 6}`)
    assert.equal(await page.evaluate('window.usage().other.sent'), 6)
    await page.evaluate(`window.socketRoundTrip('${base.replace('http:', 'ws:')}/api/collab')`)
    assert.equal(await page.evaluate('window.usage().other.sent'), 12)
    const beforeRemote = await page.evaluate('window.usage().desktop.received') as number
    await page.evaluate(`window.socketRoundTrip('${base.replace('http:', 'ws:')}/api/remote-desktop/ws')`)
    assert.equal(await page.evaluate('window.usage().desktop.received'), beforeRemote, 'remote authenticated socket is counted by its session reporter only')
    await page.evaluate(`window.remote({received:1000000,sent:2000});window.remote({received:1000000,sent:2000});window.nextRemote();window.remote({received:200000,sent:1000})`)
    assert.equal(await page.evaluate('window.usage().desktop.received'), 1_200_000)
    assert.equal(await page.evaluate('window.usage().desktop.sent'), 3000)
    await page.evaluate(`fetch('/api/remote-desktop/status').then(response=>response.text())`)
    await page.waitForFunction('window.usage().desktop.received===1200006')
    const beforeStream = await page.evaluate('window.usage().other.received') as number
    await page.evaluate('window.streamRoundTrip()')
    assert.equal(await page.evaluate('window.aborted'), true)
    assert.equal(await page.evaluate('window.streamURL'), `${base}/api/stream`)
    await page.waitForTimeout(100)
    assert.ok((await page.evaluate('window.usage().other.received') as number) >= beforeStream + 22, 'stream chunks are counted once and cancellation still works')
    assert.deepEqual(await page.evaluate('window.cloneRoundTrip()'), ['data: clone\n\n', 'data: clone\n\n'])
    assert.equal(await page.evaluate('window.cloneURL'), `${base}/api/stream-finite`)
    await page.waitForTimeout(100)
    assert.ok((await page.evaluate('window.usage().other.received') as number) >= beforeStream + 35, 'cloning an SSE response does not duplicate byte counts')
    await usageButton.click()
    const dialog = page.getByRole('dialog', { name: '시스템 자원', exact: true })
    await dialog.waitFor()
    const row = dialog.getByRole('table', { name: '누적 사용량', exact: true }).getByRole('row', { name: /원격 데스크톱/ })
    assert.deepEqual(await row.getByRole('cell').allTextContents(), ['3.0 KB', '1.2 MB'])
    await page.evaluate('window.remote({received:400000,sent:4000})')
    await row.getByRole('cell', { name: '1.4 MB', exact: true }).first().waitFor()
    assert.equal(await page.locator('header').getByRole('button', { name: /^네트워크/ }).count(), 0)
    assert.equal(await dialog.getByRole('columnheader', { name: '업로드', exact: true }).count(), 2)
    assert.equal(await dialog.getByRole('columnheader', { name: '다운로드', exact: true }).count(), 2)
    await page.waitForFunction('window.usage().rate.desktop.received > 0')
    await dialog.getByRole('table', { name: '네트워크 속도', exact: true }).waitFor()
    await page.waitForFunction('window.usage().rate.desktop.received === 0')
    assert.equal(await page.evaluate('window.usage().desktop.received'), 1400006, 'idle speed preserves totals')

    await dialog.getByRole('button', { name: '닫기' }).focus()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await usageButton.evaluate(el => el === el.ownerDocument.activeElement), true)
    for (const width of [320, 390, 1100]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 800 })
      await page.locator('html').evaluate((el, theme) => el.classList.toggle('dark', theme === 'dark'), theme)
      await usageButton.click(); await dialog.waitFor()
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), `dialog fits ${width}px ${theme}`)
      assert.ok(await page.locator('header').first().evaluate(el => el.scrollWidth <= el.clientWidth), `header fits ${width}px: ${JSON.stringify(await page.locator('header').first().evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.children].map(child => ({ name: child.tagName, text: child.textContent, rect: child.getBoundingClientRect().toJSON() })) })))}`)
      if (width === 390 || width === 1100) await page.screenshot({ path: `/tmp/mew-network-${width}-${theme}.png` })
      await page.keyboard.press('Escape')
    }
    await usageButton.click()
    for (const [locale, title, category] of [['en', 'System resources', 'Other'], ['zh-CN', '系统资源', '其他'], ['ja', 'システムリソース', 'その他']] as const) {
      await page.evaluate(`window.locale(${JSON.stringify(locale)})`)
      const localized = page.getByRole('dialog', { name: title, exact: true })
      await localized.waitFor(); assert.equal(await localized.getByRole('rowheader', { name: category, exact: true }).count(), 2)
    }
    await page.keyboard.press('Escape')
    const stopped = await page.evaluate('window.stopTracking();window.usage().other.sent')
    await page.evaluate(`fetch('/api/payload',{method:'POST',body:'untracked'}).then(response=>response.text())`)
    assert.equal(await page.evaluate('window.usage().other.sent'), stopped)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close(); sockets.clients.forEach(socket => socket.terminate()); sockets.close(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
