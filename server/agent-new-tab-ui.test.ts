import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('new tab shortcut opens the focused agent picker from conversation and tab bar', { skip: !domBrowserExecutable(), timeout: 40_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {DockWorkspace} from '${root}/src/components/DockWorkspace.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {openFocusedTab,getBinding,matchesShortcut,setBinding} from '${root}/packages/shortcuts/src/index.ts';
localStorage.setItem('mew:locale','ko');window.messages=[];window.sockets={};
const tabs=['first','second'].map(id=>({id,label:id,renamed:true,runtime:'codex',cwd:'/workspace'}));
localStorage.setItem('mew:agent-tabs:'+JSON.stringify('/workspace'),JSON.stringify(tabs));
localStorage.setItem('mew:agent-active-tab:'+JSON.stringify('/workspace'),'first');
class Socket {
 static OPEN=1;readyState=0;
 constructor(url){this.tab=new URL(url).searchParams.get('tab');window.sockets[this.tab]=this}
 emit(value){this.onmessage?.({data:JSON.stringify(value)})}
 open(restore=true){this.readyState=1;this.onopen?.();if(!restore)return;this.emit({type:'replay',restored:true,events:[{type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Saved conversation'}}}]});this.emit({type:'meta',meta:{sessionId:this.tab,startedAt:new Date().toISOString(),turns:1,busy:false,queued:[],usage:null,canLoad:true,canList:true}})}
 send(raw){if(this.readyState!==1)throw new Error('sent while disconnected');window.messages.push({tab:this.tab,...JSON.parse(raw)})}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
window.fileCreates=0;window.setNewBinding=keys=>setBinding('newTab',keys);
window.addEventListener('keydown',event=>{if(matchesShortcut(event,getBinding('newTab'))){if(!openFocusedTab(event))window.fileCreates++}},true);
function Fixture(){
 const [layout,setLayout]=React.useState({version:1,groups:[{id:'agent:restored',kind:'agent'}],tabs:{'agent:first':'agent:restored','agent:second':'agent:restored'},active:{'agent:restored':'first'},tree:{id:'agent:restored'}});
 const panel=<AgentPanel project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} />;
 return <><button id="outside" data-sidebar>Sidebar</button><input id="editor"/><div style={{height:'calc(100% - 40px)',position:'relative',display:'flex'}}>{matchMedia('(min-width:768px)').matches?<DockWorkspace value={layout} onChange={setLayout} foreground="agent" apiRef={null} onEditorDrop={()=>'main'}>{panel}</DockWorkspace>:panel}</div></>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:connection.tsx', write: false, platform: 'browser', output: { format: 'iife', codeSplitting: false }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
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
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/MentionTextarea.tsx', 'src/components/DockWorkspace.tsx', 'packages/ui/src/ConfirmDialog.tsx', 'packages/ui/src/dialog-frame.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const dark of [true, false]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(5000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-close.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: ['first', 'second'].map(id => ({ id, label: id, renamed: true, runtime: 'codex', cwd: '/workspace' })), activeId: 'first' }, claims: [] } })
        if (pathname === '/api/agent-runtimes') return route.fulfill({ json: { runtimes: [{ id: 'codex', installed: true }] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname === '/api/agent/commands') return route.fulfill({ json: { commands: [] } })
        if (pathname === '/api/agent-sets') return route.fulfill({ json: { sets: [] } })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<html class="${dark ? 'dark' : ''}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>` })
      })
      await page.goto('http://mew-close.test/')
      await page.waitForFunction('!!window.sockets?.first').catch(error => { throw new Error(`${error.message} ${JSON.stringify(errors)}`) })
      await page.evaluate('window.sockets.first.open()')
      const first = page.getByRole('tab', { name: /first/ })
      const add = page.getByRole('button', { name: '새 탭', exact: true })
      for (const surface of [page.locator('[data-agent-composer] [contenteditable="true"]'), first]) {
        await surface.focus(); await page.keyboard.press('Alt+n')
        await page.waitForFunction("document.querySelector('[aria-label=\"새 탭\"]')?.getAttribute('aria-pressed')==='true'")
        assert.equal(await page.evaluate('window.fileCreates'), 0)
        await first.click()
      }
      await first.focus()
      for (const extra of [{ repeat: true }, { isComposing: true }]) {
        await first.evaluate((el, extra) => el.dispatchEvent(new el.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'n', code: 'KeyN', altKey: true, bubbles: true, cancelable: true, ...extra })), extra)
        assert.equal(await add.getAttribute('aria-pressed'), 'false')
      }
      await page.evaluate("window.setNewBinding('Alt+M')")
      await first.focus(); await page.keyboard.press('Alt+m')
      await page.waitForFunction("document.querySelector('[aria-label=\"새 탭\"]')?.getAttribute('aria-pressed')==='true'")
      await page.getByRole('button', { name: '에이전트셋', exact: true }).click()
      const pickerButton = page.getByRole('button', { name: /새 에이전트셋/, exact: true })
      await pickerButton.focus(); await page.keyboard.press('Alt+m')
      assert.equal(await page.evaluate('window.fileCreates'), 0, 'picker also owns the shortcut')
      await pickerButton.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor(); await page.keyboard.press('Alt+m')
      assert.equal(await page.evaluate('window.fileCreates'), 0, 'dialog blocks background creation')
      await page.keyboard.press('Escape'); await first.click()
      for (const selector of ['#outside', '#editor']) {
        await page.locator(selector).focus(); await page.keyboard.press('Alt+m')
      }
      assert.equal(await page.evaluate('window.fileCreates'), 2, 'sidebar and editor keep file creation')
      assert.equal(await add.getAttribute('aria-pressed'), 'false')
      await first.focus(); await page.keyboard.press('Alt+m')
      await page.getByRole('button', { name: '런타임', exact: true }).click()
      await page.getByRole('button', { name: 'Codex', exact: true }).click()
      await page.waitForFunction("document.querySelectorAll('[role=tab]').length===3")
      assert.equal(await page.evaluate('window.fileCreates'), 2)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
