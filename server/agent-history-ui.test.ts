import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('paged conversations keep scroll position and restore account-scoped IndexedDB on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {HistoryIndex} from '${root}/shared/agent-history.ts';
import * as cache from '${root}/src/utils/agent-history-cache.ts';
window.cache=cache;window.requests=[];
const events=[];for(let i=0;i<45;i++)events.push({type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Question '+i}}},{type:'turn_start'},{type:'update',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Answer '+i+' '+(i===42?'long readable answer\\n\\n'.repeat(65):'long readable answer '.repeat(15))}}},{type:'turn_end',stopReason:'end_turn'});
const index=new HistoryIndex('browser-generation');events.forEach(event=>index.push(event));
const meta={type:'meta',meta:{sessionId:'conversation',startedAt:new Date().toISOString(),turns:45,busy:false,queued:location.search.includes('slow')?[]:['Saved queue task'],queuedKinds:['prompt'],queuedAttachments:[[{project:'test',path:'notes.md',mimeType:'text/markdown'}]],queuedSettings:[{model:'Cached model',thinking:'High',permission:'Default'}],usage:null,canLoad:true,canList:true}};
class Socket {
 static OPEN=1;readyState=0;
 constructor(url){window.socket=this;this.url=url;window.requests.push(url);setTimeout(()=>{this.readyState=1;this.onopen?.();const query=new URL(url).searchParams;this.emit({type:'history',page:index.page(events,'conversation',{generation:query.get('generation'),after:query.has('after')?Number(query.get('after')):undefined})});this.emit(meta)},location.search.includes('slow')?1500:20)}
 emit(event){this.onmessage?.({data:JSON.stringify(event)})}
 send(raw){const message=JSON.parse(raw);window.requests.push(message);if(message.type==='history')setTimeout(()=>this.emit({type:'history',page:index.page(events,'conversation',message.range)}),20)}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
createRoot(document.getElementById('root')).render(<I18nProvider><div style={{height:'100vh',display:'flex'}}><AgentPanel cacheAccount="alice" project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></div></I18nProvider>);`
  const bundle = await build({ input: 'virtual:history.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'history-fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:history.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
    },
    async load(id) {
      if (id === 'virtual:history.tsx') return source
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
    for (const width of [1100, 390]) for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(6000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-history.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'history', label: 'History', renamed: true, runtime: 'codex', cwd: '/workspace', sessionIds: { [JSON.stringify(['codex', '/workspace'])]: 'conversation' } }], activeId: 'history' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-history.test/')
      await page.getByText('Question 44', { exact: true }).waitFor()
      assert.equal(await page.getByText('Question 24', { exact: true }).count(), 0)
      const scroll = page.locator('[data-agent-conversation] > div').first()
      await scroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
      await page.getByText('Question 5', { exact: true }).waitFor({ state: 'attached' })
      assert.ok(await scroll.evaluate(el => el.scrollTop > 100), 'prepend preserves the previous viewport')
      const questionTop = (number: number) => page.getByText(`Question ${number}`, { exact: true }).evaluate(el => {
        const question = el.closest('[data-agent-question]')!
        const scroller = question.parentElement!
        return question.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop
          - parseFloat(el.ownerDocument.defaultView!.getComputedStyle(scroller).paddingTop) + scroller.scrollTop
      })
      const assertAtQuestion = async (number: number) => {
        const desired = await questionTop(number)
        const actual = await scroll.evaluate(el => el.scrollTop)
        const max = await scroll.evaluate(el => el.scrollHeight - el.clientHeight)
        assert.ok(Math.abs(actual - Math.min(desired, max)) <= 1, `viewport aligns to Question ${number}`)
      }
      await page.getByText(/^Answer 42 /).first().locator('..').click()
      const middle = await questionTop(42) + 500
      await scroll.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')) }, middle)
      await scroll.focus()
      await scroll.press('ArrowUp')
      await assertAtQuestion(42)
      await scroll.press('ArrowUp')
      await assertAtQuestion(41)
      await scroll.press('ArrowDown')
      await assertAtQuestion(42)
      await scroll.press('ArrowDown')
      await assertAtQuestion(43)
      await scroll.press('ArrowDown')
      await assertAtQuestion(44)
      await scroll.press('ArrowDown')
      await assertAtQuestion(44)
      await scroll.press('ArrowUp')
      await assertAtQuestion(43)
      await scroll.press('ArrowUp')
      await assertAtQuestion(42)
      await scroll.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')) }, middle)
      await scroll.press('ArrowDown')
      await assertAtQuestion(43)
      await scroll.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')) }, middle)
      await scroll.evaluate(el => el.dispatchEvent(new el.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true })))
      assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - middle) <= 1, 'selection keys do not jump between questions')
      const draft = page.locator('[data-keep-keyboard] [contenteditable="true"]')
      await draft.fill('first line\nsecond line')
      await draft.press('ArrowUp')
      assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - middle) <= 1, 'composer arrow keys leave conversation scroll alone')
      await draft.fill('')
      await page.getByText(/^Answer 42 /).first().locator('..').click()
      assert.equal(await scroll.evaluate(el => el.ownerDocument.activeElement === el), true, 'clicking a conversation bubble focuses question navigation')
      const button = page.getByText('Question 40', { exact: true }).locator('..')
      await button.focus()
      await button.press('ArrowDown')
      assert.equal(await scroll.evaluate(el => el.ownerDocument.activeElement === el), false, 'keyboard navigation preserves button focus')
      await scroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
      await page.getByText('Question 0', { exact: true }).waitFor({ state: 'attached' })
      await scroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
      await scroll.focus()
      await scroll.press('ArrowUp')
      await assertAtQuestion(0)
      const deadline = Date.now() + 5000
      let cached: unknown = null
      while (!cached && Date.now() < deadline) {
        cached = await page.evaluate(`window.cache.readHistoryCache(window.cache.historyCacheKey('alice','codex','history','/workspace'))`)
        if (!cached) await new Promise(resolve => setTimeout(resolve, 50))
      }
      assert.ok(cached, 'cache exists before navigation')
      const queueKey = `window.cache.historyCacheKey('alice','codex','history','/workspace')`
      await page.waitForFunction(`window.cache.readQueueCache(${queueKey}).then(value=>value?.queued[0]==='Saved queue task')`)
      assert.equal(await page.evaluate(`window.cache.readQueueCache(window.cache.historyCacheKey('bob','codex','history','/workspace'))`), null)
      assert.equal(await page.evaluate(`window.cache.readHistoryCache(window.cache.historyCacheKey('bob','codex','history','/workspace'))`), null)
      await page.evaluate('window.socket.close()')
      assert.equal(await page.getByText('Saved queue task', { exact: true }).count(), 1, 'disconnect preserves the queue')
      await page.goto('http://mew-history.test/?slow')
      await page.getByText('Question 44', { exact: true }).waitFor()
      await page.getByText('Saved queue task', { exact: true }).waitFor()
      await page.getByText('Saved queue task', { exact: true }).click()
      await page.locator('[data-queue-settings]').filter({ hasText: 'Cached model' }).waitFor()
      assert.equal(await page.locator('[data-queue-row] button').first().isDisabled(), true)
      assert.equal(await page.evaluate('window.socket.readyState'), 0, 'local history is visible before the connection opens')
      await page.waitForFunction('window.socket.readyState===1')
      await page.getByText('Saved queue task', { exact: true }).waitFor({ state: 'detached' })
      assert.ok(await page.evaluate(`window.requests[0].includes('after=180')`), 'reload resumes from the cached cursor')
      assert.equal(await page.getByText('Question 44', { exact: true }).count(), 1)
      await page.screenshot({ path: `/tmp/mew-history-${width}-${dark ? 'dark' : 'light'}.png` })
      if (width === 1100 && !dark) {
        const result = await page.evaluate(async () => {
          const cache = (globalThis as any).cache
          const key = cache.historyCacheKey('alice', 'codex', 'history', '/workspace')
          const value = await cache.readHistoryCache(key)
          const store = (globalThis as any).IDBObjectStore
          const original = store.prototype.put
          store.prototype.put = function () { throw new DOMException('injected quota', 'QuotaExceededError') }
          try { await cache.writeHistoryCache(key, 'history', { ...value, generation: 'failed-write' }) }
          finally { store.prototype.put = original }
          return (await cache.readHistoryCache(key))?.generation
        })
        assert.equal(result, 'browser-generation', 'quota failure preserves the previous committed cache')
        assert.equal(await page.getByText('Question 44', { exact: true }).count(), 1)
      }
      await page.evaluate(`window.cache.clearHistoryTab('history')`)
      assert.equal(await page.evaluate(`window.cache.readHistoryCache(window.cache.historyCacheKey('alice','codex','history','/workspace'))`), null)
      assert.equal(await page.evaluate(`window.cache.readQueueCache(window.cache.historyCacheKey('alice','codex','history','/workspace'))`), null)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
