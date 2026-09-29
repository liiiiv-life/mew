import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('Codex panel separates model and effort on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');window.messages=[];
const models={currentModelId:'astra[high]',availableModels:[
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
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/MentionTextarea.tsx', 'src/components/DockWorkspace.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
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
      const draft = page.locator('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
      await draft.fill('새 작업')
      await draft.press('Control+Enter')
      const sent = await page.evaluate<any>('window.messages.find(message => message.type === "prompt")')
      assert.equal(sent.settings.modelId, 'astra[high]')
      assert.equal(sent.settings.thinkingId, 'high')
      assert.equal(sent.settings.modeId, 'default')
      const queuedSettings = { model:'Other', thinking:'Medium', permission:'권한 무시',modelId:'other[medium]',thinkingId:'medium',thinkingConfigId:'reasoning_effort',modeId:'bypassPermissions' }
      await page.evaluate(settings => {
        (globalThis as any).socket.emit({type:'meta',meta:{sessionId:'first',busy:true,queued:['대기 작업'],queuedKinds:['prompt'],queuedSettings:[settings]}})
      }, queuedSettings)
      for (const action of ['cancel', 'save']) {
        await page.getByRole('button', { name:'대기 작업', exact:true }).click()
        await model.filter({ hasText:'Other' }).waitFor()
        assert.equal((await effort.innerText()).trim(), 'medium')
        assert.equal((await permission.innerText()).trim(), '권한 무시')
        await page.evaluate('window.messages=[]')
        await model.click()
        await page.getByRole('option', { name:'Astra', exact:true }).click()
        await effort.click()
        await page.getByRole('option', { name:'Low', exact:true }).click()
        await permission.click()
        await page.getByRole('option', { name:'승인 필요', exact:true }).click()
        assert.equal(await page.evaluate('window.messages.some(message => message.type.startsWith("set_"))'), false, 'queue edits keep live composer controls independent')
        await page.getByRole('button', { name:action === 'cancel' ? '취소' : '저장', exact:true }).click()
        await model.filter({ hasText:'Astra' }).waitFor()
        assert.equal((await effort.innerText()).trim(), 'High', 'original effort is restored')
        assert.equal((await permission.innerText()).trim(), '승인 필요')
        const edit = await page.evaluate<any>('window.messages.find(message => message.type === "edit_queued")')
        if (action === 'cancel') assert.equal(edit, undefined)
        else {
          assert.equal(edit.settings.modelId, 'astra[low]')
          assert.equal(edit.settings.thinkingId, 'low')
          assert.equal(edit.settings.modeId, 'default')
        }
      }
      await page.evaluate(`window.socket.emit({type:'meta',meta:{sessionId:'first',busy:false,queued:[]}})`)
      await model.click()
      await page.getByRole('listbox', { name: '모델', exact: true }).waitFor()
      assert.deepEqual(await page.getByRole('option').allTextContents(), ['Astra', 'Other'])
      assert.equal(await page.getByRole('option', { name: 'Astra', exact: true }).getAttribute('aria-selected'), 'true')
      const box = await page.getByRole('listbox').boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0)
      await page.screenshot({ path: `/tmp/mew-codex-models-${width}.png` })
      await page.getByPlaceholder('검색', { exact: true }).fill('Other')
      await page.getByPlaceholder('검색', { exact: true }).press('Enter')
      assert.deepEqual(await page.evaluate('window.messages.at(-1)'), { type: 'set_model', modelId: 'other' })
      await page.evaluate(`window.socket.emit({type:'models',models:{currentModelId:'other[medium]',availableModels:[{modelId:'astra[low]',name:'Astra (low)'},{modelId:'astra[high]',name:'Astra (high)'},{modelId:'other[low]',name:'Other (low)'},{modelId:'other[medium]',name:'Other (medium)'}]}});window.socket.emit({type:'thinking',thinking:{configId:'reasoning_effort',currentValue:'medium',options:[{id:'low',name:'Low'},{id:'medium',name:'Medium'}]}})`)
      await effort.filter({ hasText: 'Medium' }).waitFor()
      await effort.click()
      await page.getByRole('listbox', { name: '사고', exact: true }).waitFor()
      assert.deepEqual(await page.getByRole('option').allTextContents(), ['Low', 'Medium'])
      await page.getByRole('option', { name: 'Low', exact: true }).click()
      assert.deepEqual(await page.evaluate('window.messages.at(-1)'), { type: 'set_thinking', configId: 'reasoning_effort', value: 'low' })
      await page.evaluate(`window.socket.emit({type:'models',models:{currentModelId:'astra[high]',availableModels:[{modelId:'astra[low]',name:'Astra (low)'},{modelId:'astra[high]',name:'Astra (high)'}]}})`)
      await model.filter({ hasText: 'Astra' }).waitFor()
      assert.equal(await model.isDisabled(), true, 'one base model disables only the model control')
      assert.equal(await effort.isDisabled(), false)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
