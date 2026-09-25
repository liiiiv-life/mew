import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('agent loading bubbles cover connection and history, preserve drafts and respect reduced motion', { skip: !domBrowserExecutable(), timeout: 40_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {onMewcatNotice} from '${root}/src/utils/mewcat-notifications.ts';
localStorage.setItem('mew:locale','ko');window.messages=[];window.notices=[];window.sockets={};window.fail=false;window.outsideClicks=0;
onMewcatNotice(notice=>window.notices.push(notice));
class Socket {
 static OPEN=1;readyState=0;
 constructor(url){this.tab=new URL(url).searchParams.get('tab');window.sockets[this.tab]=this;if(window.fail)setTimeout(()=>this.close(),20)}
 emit(value){this.onmessage?.({data:JSON.stringify(value)})}
 open(restore=true){this.readyState=1;this.onopen?.();if(!restore)return;this.emit({type:'replay',events:[{type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Saved conversation'}}}]});this.emit({type:'meta',meta:{sessionId:this.tab,startedAt:new Date().toISOString(),turns:1,busy:false,queued:[],usage:null,canLoad:true,canList:true}})}
 send(raw){if(this.readyState!==1)throw new Error('sent while disconnected');window.messages.push(JSON.parse(raw))}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
createRoot(document.getElementById('root')).render(<I18nProvider><button id="outside" onClick={()=>window.outsideClicks++}>Outside panel</button><div style={{height:'calc(100% - 40px)',position:'relative'}}><AgentPanel project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:connection.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:connection.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
    },
    async load(id) {
      if (id === 'virtual:connection.tsx') return source
      if (id === 'virtual:terminal') return 'export const isHiddenTmuxSession=()=>false;export function TmuxTerminal(){return null}'
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/MentionTextarea.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const dark of [true, false]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-connection.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: ['first', 'second'].map(id => ({ id, label: id, renamed: true, runtime: 'codex', cwd: '/workspace' })), activeId: 'first' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-connection.test/')
      const overlay = page.locator('[data-agent-loading]:visible')
      await overlay.waitFor().catch(error => { throw new Error(`${error.message}\n${JSON.stringify(errors)}`) })
      assert.equal(await overlay.getByRole('status').getAttribute('aria-label'), '연결 중…')
      assert.equal(await overlay.locator('.agent-loading-bubbles__bubble').count(), 4)
      assert.equal(await overlay.locator('.animate-spin').count(), 0)
      const session = page.locator('[data-agent-session]:visible')
      const draft = session.getByPlaceholder('텍스트 입력')
      const send = session.getByRole('button', { name: '전송', exact: true })
      await draft.fill('Draft before first connection')
      assert.equal(await send.isDisabled(), true)
      await page.evaluate('window.sockets.first.open(false)')
      assert.equal(await overlay.isVisible(), true, 'socket open still waits for the conversation')
      await page.evaluate('window.sockets.first.open()')
      await overlay.waitFor({ state: 'hidden' })
      assert.equal(await draft.inputValue(), 'Draft before first connection')
      await draft.fill('Keep this unsent draft')
      await session.getByText('Saved conversation', { exact: true }).waitFor()
      await page.clock.install()
      await page.clock.pauseAt(new Date(Date.now() + 1000))
      await page.evaluate('window.fail=true;window.sockets.first.close()')
      await overlay.waitFor()
      const assertOverlayBounds = async () => {
        const shade = (await overlay.boundingBox())!
        const panel = (await session.boundingBox())!
        const composer = (await session.locator('[data-keep-keyboard]').boundingBox())!
        assert.equal(shade.x, panel.x)
        assert.equal(shade.y, panel.y + 32, 'loading starts below the session toolbar')
        assert.equal(shade.width, panel.width)
        assert.equal(shade.y + shade.height, composer.y, 'shade ends above the composer')
      }
      await assertOverlayBounds()
      const resize = session.getByRole('separator', { name: '입력창 높이 조절' })
      const previousHeight = await resize.getAttribute('aria-valuenow')
      await resize.focus()
      await page.keyboard.press('ArrowUp')
      assert.notEqual(await resize.getAttribute('aria-valuenow'), previousHeight)
      await assertOverlayBounds()
      assert.equal(await overlay.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor), await session.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await overlay.locator('.agent-loading-bubbles__bubble').first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element, '::after').animationName), 'none')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      assert.equal(await overlay.locator('.agent-loading-bubbles__bubble').first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element, '::after').animationName), 'agent-bubble-shimmer')
      assert.equal(await session.locator('[inert]').count(), 2)
      assert.equal(await draft.evaluate(element => element.closest('[inert]') === null), true)
      assert.equal(await send.isDisabled(), true)
      assert.equal(await session.getByRole('button', { name: '파일 첨부', exact: true }).isEnabled(), true)
      await draft.fill('Edited while connecting')
      const sentBefore = await page.evaluate('window.messages.length')
      await draft.press('Control+Enter')
      assert.equal(await page.evaluate('window.messages.length'), sentBefore)
      assert.equal(await draft.inputValue(), 'Edited while connecting')
      assert.equal(await session.getByText('Saved conversation', { exact: true }).count(), 1)
      await page.clock.runFor(12_000)
      assert.deepEqual(await page.evaluate('window.notices'), [], 'even prolonged retry failure produces no notification or sound/desktop delivery')
      await page.screenshot({ path: `/tmp/mew-agent-connection-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.getByRole('tab', { name: 'second', exact: false }).click()
      await page.evaluate('window.fail=false;window.sockets.second.open()')
      await overlay.waitFor({ state: 'hidden' })
      assert.equal(await page.locator('[data-agent-loading]').count(), 1, 'the disconnected background tab keeps its own skeleton')
      await page.getByRole('tab', { name: 'first', exact: false }).click()
      await overlay.waitFor()
      await page.evaluate('window.sockets.first.open()')
      await overlay.waitFor({ state: 'hidden' })
      assert.equal(await draft.inputValue(), 'Edited while connecting')
      assert.equal(await session.locator('[inert]').count(), 0)
      assert.equal(await send.isEnabled(), true)
      await send.click()
      assert.equal(await page.evaluate('window.messages.at(-1).text'), 'Edited while connecting')
      assert.equal(await draft.inputValue(), '')
      await draft.fill('Draft while loading history')
      const openHistory = async (id: string) => {
        await session.getByRole('button', { name: '히스토리', exact: true }).click()
        await session.getByRole('region', { name: '지난 세션' }).locator('.agent-loading-bubbles[data-compact="true"]').waitFor()
        await session.getByLabel('세션 ID', { exact: true }).fill(id)
        await session.getByRole('button', { name: '열기', exact: true }).click()
        await overlay.waitFor()
        assert.equal(await session.locator('[data-agent-conversation]').getAttribute('aria-busy'), 'true')
        assert.equal(await send.isDisabled(), true)
        const before = await page.evaluate('window.messages.length')
        await draft.press('Control+Enter')
        assert.equal(await page.evaluate('window.messages.length'), before)
        assert.equal(await draft.inputValue(), 'Draft while loading history')
      }
      await openHistory('history-replay')
      await page.evaluate("window.sockets.first.emit({type:'replay',events:[]});window.sockets.first.emit({type:'meta',meta:{sessionId:'history-replay',startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:true,canList:true}})")
      await overlay.waitFor({ state: 'hidden' })
      assert.equal(await session.getByText('Saved conversation', { exact: true }).count(), 0)
      assert.equal(await send.isEnabled(), true)
      await openHistory('history-reset')
      await page.evaluate("window.sockets.first.emit({type:'reset'})")
      await overlay.waitFor({ state: 'hidden' })
      await openHistory('history-error')
      await page.evaluate("window.sockets.first.emit({type:'error',message:'History load failed'})")
      await overlay.waitFor({ state: 'hidden' })
      assert.equal(await send.isEnabled(), true)
      assert.equal(await draft.inputValue(), 'Draft while loading history')
      await draft.fill('Typing after recovery')
      await page.evaluate("window.sockets.first.emit({type:'error',message:'Actual agent failure'})")
      assert.equal(await page.evaluate('window.notices.at(-1).kind'), 'error', 'actual agent errors still notify')
      await page.clock.resume()
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
