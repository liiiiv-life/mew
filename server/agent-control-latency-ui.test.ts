import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('agent controls update immediately through delayed responses, rapid arrows and failures on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');window.messages=[];
const models=window.fixtureModels={currentModelId:'astra[high]',availableModels:[
 {modelId:'astra[low]',name:'Astra (low)'},{modelId:'astra[high]',name:'Astra (high)'},
 {modelId:'other[low]',name:'Other (low)'},{modelId:'other[medium]',name:'Other (medium)'}
]};
class Socket {
 static OPEN=1;readyState=1;
 constructor(){window.socket=this;setTimeout(()=>{this.onopen?.();this.emit({type:'replay',events:[]});this.emit({type:'models',models});this.emit({type:'thinking',thinking:{configId:'reasoning_effort',currentValue:'high',options:[{id:'low',name:'Low'},{id:'high',name:'High'}]}});this.emit({type:'meta',meta:{sessionId:'first',startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:false,canList:false}})},20)}
 emit(value){this.onmessage?.({data:JSON.stringify(value)})}
 send(raw){window.messages.push(JSON.parse(raw))}
 close(){}
}
window.WebSocket=Socket;
createRoot(document.getElementById('root')).render(<I18nProvider><AgentPanel project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></I18nProvider>);`
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
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/agent-header-select.tsx', 'src/components/MentionTextarea.tsx', 'src/components/DockWorkspace.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-models.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'first', label: 'Codex', runtime: 'codex', cwd: '/workspace' }], activeId: 'first' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${width === 1100 ? 'dark' : ''}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-models.test/')
      const model = page.getByTitle('모델', { exact: true })
      const effort = page.getByTitle('사고', { exact: true })
      await model.filter({ hasText: 'Astra' }).waitFor()
      assert.equal((await model.innerText()).trim(), 'Astra')
      assert.equal((await effort.innerText()).trim(), 'High')
      await page.evaluate(`window.socket.emit({type:'modes',modes:{currentModeId:'default',availableModes:[{id:'default',name:'Default'},{id:'bypassPermissions',name:'Bypass'}]}})`)
      const permission = page.getByTitle('권한', { exact: true })
      await permission.filter({ hasText: '승인 필요' }).waitFor()
      // No control responses are emitted until the assertions explicitly release them.
      await model.focus()
      await model.press('ArrowDown')
      assert.equal((await model.innerText()).trim(), 'Other', 'model updates before an ACP response')
      assert.equal((await effort.innerText()).trim(), 'Medium', 'new model uses a supported effort immediately')
      await model.press('ArrowUp')
      assert.equal((await model.innerText()).trim(), 'Astra', 'second arrow uses the local selection')
      assert.equal((await effort.innerText()).trim(), 'Low')
      assert.deepEqual(await page.evaluate('window.messages.filter(message => message.type === \"set_model\").map(message => message.modelId)'), ['other[medium]', 'astra[low]'], 'requests carry exact variants even before the previous model is confirmed')
      await page.evaluate(`window.socket.emit({type:'models',models:{...window.fixtureModels,currentModelId:'other[medium]'}});window.socket.emit({type:'thinking',thinking:{configId:'reasoning_effort',currentValue:'medium',options:[{id:'low',name:'Low'},{id:'medium',name:'Medium'}]}})`)
      assert.equal((await model.innerText()).trim(), 'Astra', 'older model response does not replace the latest choice')
      assert.equal((await effort.innerText()).trim(), 'Low')
      await page.evaluate(`window.socket.emit({type:'models',models:{...window.fixtureModels,currentModelId:'astra[low]'}});window.socket.emit({type:'thinking',thinking:{configId:'reasoning_effort',currentValue:'low',options:[{id:'low',name:'Low'},{id:'high',name:'High'}]}})`)
      await effort.focus(); await effort.press('ArrowDown')
      assert.equal((await effort.innerText()).trim(), 'High', 'effort updates before an ACP response')
      await permission.focus(); await permission.press('ArrowDown')
      assert.equal((await permission.innerText()).trim(), '권한 무시', 'permission updates before an ACP response')
      const draft = page.locator('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
      await draft.fill('선택 직후 전송')
      await draft.press('Control+Enter')
      const sent = await page.evaluate<any>('window.messages.find(message => message.type === "prompt")')
      assert.equal(sent.settings.modelId, 'astra[high]', 'prompt carries the selected exact model without waiting')
      assert.equal(sent.settings.thinkingId, 'high')
      assert.equal(sent.settings.modeId, 'bypassPermissions')
      await page.evaluate(`window.socket.emit({type:'error',message:'fixture settings rejected'})`)
      await effort.filter({ hasText: 'Low' }).waitFor()
      assert.equal((await effort.innerText()).trim(), 'Low', 'failure returns to the confirmed effort')
      assert.equal((await permission.innerText()).trim(), '승인 필요', 'failure returns to the confirmed mode')
      // A server change after acknowledgement is authoritative again.
      await page.evaluate(`window.socket.emit({type:'modes',modes:{currentModeId:'bypassPermissions',availableModes:[{id:'default',name:'Default'},{id:'bypassPermissions',name:'Bypass'}]}})`)
      assert.equal((await permission.innerText()).trim(), '권한 무시')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
