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

test('header usage measures HTTP, streaming and sockets, and shows live category totals in a compact dialog', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {NetworkUsageButton} from '${root}/src/components/network-usage-button.tsx';
import {ActiveSessionsButton} from '${root}/src/components/active-sessions-button.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {setUiLocale} from '${root}/packages/ui/src/i18n-core.ts';
import {networkUsage,desktopUsageReporter} from '${root}/src/utils/network-usage.ts';
import {startNetworkTracking} from '${root}/src/utils/network-tracking.ts';
localStorage.setItem('mew:locale','ko');window.usage=()=>networkUsage.getSnapshot();window.remote=desktopUsageReporter();window.nextRemote=()=>window.remote=desktopUsageReporter();window.locale=setUiLocale;window.stopTracking=startNetworkTracking();
createRoot(document.getElementById('root')).render(<I18nProvider><header className="flex h-10 items-center gap-1.5 px-2 md:h-12 md:gap-3"><span className="min-w-0 flex-1 truncate">mew</span><NetworkUsageButton/><ActiveSessionsButton presence={{selfId:'one',sessions:[]}}/><button aria-label="Menu" className="h-8 w-8"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button></header></I18nProvider>);
window.socketRoundTrip=url=>new Promise((resolve,reject)=>{const socket=new WebSocket(url);socket.binaryType='arraybuffer';socket.onopen=()=>socket.send('한글');socket.onmessage=()=>{socket.close();resolve()};socket.onerror=reject});
window.streamRoundTrip=async()=>{const abort=new AbortController();const response=await fetch('/api/stream',{signal:abort.signal});window.streamURL=response.url;const reader=response.body.getReader();await reader.read();await reader.read();abort.abort();try{await reader.read()}catch(error){window.aborted=error.name==='AbortError'}};
window.cloneRoundTrip=async()=>{const response=await fetch('/api/stream-finite');const clone=response.clone();window.cloneURL=clone.url;return Promise.all([response.text(),clone.text()])};`
  const bundle = await build({ input: 'virtual:network.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:network.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:network.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/network-usage-button.tsx', 'src/components/active-sessions-button.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
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
    const usageButton = page.getByRole('button', { name: /^네트워크 사용량 / })
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
    assert.equal(await page.evaluate('window.usage().other.received'), beforeStream + 22, 'stream chunks are counted once and cancellation still works')
    assert.deepEqual(await page.evaluate('window.cloneRoundTrip()'), ['data: clone\n\n', 'data: clone\n\n'])
    assert.equal(await page.evaluate('window.cloneURL'), `${base}/api/stream-finite`)
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate('window.usage().other.received'), beforeStream + 35, 'cloning an SSE response does not duplicate byte counts')
    await usageButton.click()
    const dialog = page.getByRole('dialog', { name: '네트워크 사용량', exact: true })
    await dialog.waitFor()
    const row = dialog.getByRole('row', { name: /원격 데스크톱/ })
    assert.deepEqual(await row.getByRole('cell').allTextContents(), ['1.2 MB', '3.0 KB', '1.2 MB'])
    await page.evaluate('window.remote({received:400000,sent:4000})')
    await row.getByRole('cell', { name: '1.4 MB', exact: true }).first().waitFor()
    await page.keyboard.press('Tab')
    assert.equal(await dialog.getByRole('button', { name: '닫기' }).evaluate(el => el === el.ownerDocument.activeElement), true)
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
    for (const [locale, title, category] of [['en', 'Network usage', 'Other'], ['zh-CN', '网络用量', '其他'], ['ja', '通信量', 'その他']] as const) {
      await page.evaluate(`window.locale(${JSON.stringify(locale)})`)
      const localized = page.getByRole('dialog', { name: title, exact: true })
      await localized.waitFor(); await localized.getByRole('rowheader', { name: category, exact: true }).waitFor()
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
