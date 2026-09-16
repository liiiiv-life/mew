import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('active session count and popup stay live across mobile layout and reconnects', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {ActiveSessionsButton} from '${root}/src/components/active-sessions-button.tsx';
import {usePresence} from '${root}/src/hooks/usePresence.ts';
import {I18nProvider} from '${root}/src/i18n.tsx';
class Socket {static OPEN=1; readyState=1; sent=[]; constructor(){window.socket=this;setTimeout(()=>this.onopen?.(),0)} send(raw){this.sent.push(JSON.parse(raw))} close(){this.readyState=3;this.onclose?.()} receive(activeSessions){this.onmessage?.({data:JSON.stringify({type:'participants',participants:{'work:readme.md':['#abcdef']},activeSessions})})}}
window.WebSocket=Socket;localStorage.setItem('mew:locale','ko');
const base={email:'saens@example.test',displayName:'Saens',browser:'Chrome',device:'Mac',connectedAt:1789522800000,workspaceLabel:'mew',project:'work',path:'src/components/active-sessions-button.tsx',visible:true};
window.roster={selfId:'one',sessions:[{...base,id:'one'},{...base,id:'two',browser:'Safari',device:'iPhone',visible:false,path:null},{...base,id:'three',email:'collaborator-with-a-long-address@example.test',displayName:'Collaborator',path:'docs/'+('very-long-file-name-'.repeat(8))+'.md'},{...base,id:'four',email:null,displayName:null,workspaceLabel:'Public docs',path:'welcome.md'}]};
function Fixture(){const [screen,setScreen]=useState({project:'work',file:'readme.md',label:'mew'});window.setScreen=setScreen;const {activeSessions}=usePresence(screen.project,screen.file,'saens@example.test',()=>{},undefined,screen.label);return <header className="flex h-10 items-center gap-1.5 px-3 md:h-12"><span className="min-w-0 flex-1 truncate">mew</span><ActiveSessionsButton presence={activeSessions}/><button aria-label="메뉴" className="h-8 w-8">☰</button></header>};
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:sessions.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:sessions.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:sessions.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = await fs.readFile(`${root}/src/components/active-sessions-button.tsx`, 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, hasTouch: true })
    await context.route('http://mew-sessions.test/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` }))
    const page = await context.newPage()
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://mew-sessions.test/')
    await page.getByRole('button', { name: '접속 정보 연결 중…' }).waitFor()
    await page.waitForFunction('window.socket?.sent.length === 1')
    assert.deepEqual(await page.evaluate('window.socket.sent[0]'), { type: 'focus', path: 'work:readme.md', project: 'work', workspaceLabel: 'mew', color: await page.evaluate('window.socket.sent[0].color'), visible: true })
    await page.evaluate('window.socket.receive(window.roster)')
    const trigger = page.getByRole('button', { name: '활성 세션 4개' })
    await trigger.waitFor()
    for (const [width, dark] of [[1200, false], [390, false], [1200, true], [390, true]] as const) {
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      await page.setViewportSize({ width, height: 800 })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: '활성 세션 4' })
      await dialog.waitFor()
      assert.equal(await dialog.getByRole('heading', { name: 'Saens', exact: true }).count(), 1)
      assert.equal(await dialog.locator('li').count(), 4)
      assert.equal(await dialog.getByText('현재 세션', { exact: true }).count(), 1)
      assert.equal(await dialog.getByText('백그라운드', { exact: true }).count(), 1)
      assert.equal(await dialog.getByText('열린 파일 없음', { exact: true }).count(), 1)
      const box = await dialog.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width)
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      const email = dialog.getByText('saens@example.test', { exact: true })
      assert.equal(await email.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'text')
      assert.equal(await dialog.getByRole('heading', { name: 'Saens', exact: true }).evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'none')
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: '닫기', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.screenshot({ path: `/tmp/mew-active-sessions-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await trigger.evaluate(el => el === el.ownerDocument.activeElement), true)
    }
    await trigger.click()
    await page.evaluate('window.socket.receive({...window.roster,sessions:window.roster.sessions.slice(0,2)})')
    await page.getByRole('button', { name: '활성 세션 2개' }).waitFor()
    assert.equal(await page.getByRole('dialog').locator('li').count(), 2)
    await page.evaluate('window.socket.close()')
    await page.getByRole('status').getByText('접속 정보 연결 중…').waitFor()
    assert.equal(await page.getByRole('dialog').locator('li').count(), 0)
    assert.equal(await page.getByRole('button', { name: '접속 정보 연결 중…' }).innerText(), '—')
    await page.evaluate("window.setScreen({project:'docs',file:null,label:'other'})")
    await page.waitForFunction('window.socket.readyState === 1 && window.socket.sent.length === 1')
    assert.equal(await page.evaluate('window.socket.sent[0].workspaceLabel'), 'other')
    assert.equal(await page.evaluate('window.socket.sent[0].path'), null)
    await page.evaluate('window.socket.receive(window.roster)')
    await page.getByRole('dialog', { name: '활성 세션 4' }).waitFor()
    await page.evaluate('history.back()')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await trigger.click()
    await page.mouse.click(2, 2)
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
