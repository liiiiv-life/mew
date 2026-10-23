import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('conversation answers appear before deferred work, hydrate once with two background requests, and reject stale generations', { skip: !domBrowserExecutable(), timeout: 60_000 }, async t => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {HistoryIndex} from '${root}/shared/agent-history.ts';
import {compactHistoryWork} from '${root}/shared/agent-display.ts';
localStorage.setItem('mew:locale','ko');window.requests=[];window.pendingDetails=new Map();window.maxDetails=0;
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text}}});
const message=(role,text)=>({type:'update',update:{sessionUpdate:role+'_message_chunk',content:{type:'text',text}}});
const records=prefix=>Array.from({length:6},(_,i)=>[
message('user',prefix+' question '+i),{type:'turn_start'},
{type:'update',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:prefix+' reasoning '+i}}},
{type:'update',update:{sessionUpdate:'tool_call',toolCallId:prefix+'-tool-'+i,title:prefix+' inspect file '+i,status:'completed'}},
message('agent',prefix+' answer '+i),{type:'turn_end',stopReason:'end_turn',durationMs:1200}
]).flat();
const generations=new Map();
function makePage(generation,prefix,request={}){const events=records(prefix);generations.set(generation,events);const index=new HistoryIndex(generation);events.forEach(event=>index.push(event));const page=index.page(events,'conversation',{...request,turns:3});return {...page,events:compactHistoryWork(page.events)}}
const meta={type:'meta',meta:{sessionId:'conversation',startedAt:new Date().toISOString(),turns:6,busy:false,queued:[],usage:null,canLoad:true,canList:true}};
class Socket {
 static OPEN=1;readyState=0;
 constructor(url){window.socket=this;window.socketUrl=url;setTimeout(()=>{this.readyState=1;this.onopen?.();const query=new URL(url).searchParams;window.initialAt=performance.now();this.emit({type:'history',page:makePage('initial-generation','Initial',{generation:query.get('generation'),after:query.has('after')?Number(query.get('after')):undefined})});this.emit(meta)},10)}
 emit(event){this.onmessage?.({data:JSON.stringify(event)})}
 send(raw){const request=JSON.parse(raw);window.requests.push(request);if(request.type==='history_details'){window.firstDetailAt??=performance.now();window.pendingDetails.set(request.requestId,request);window.maxDetails=Math.max(window.maxDetails,window.pendingDetails.size)}if(request.type==='history')this.emit({type:'history',page:makePage('initial-generation','Initial',request.range)})}
 close(){this.readyState=3;this.onclose?.()}
}
window.finishDetail=requestId=>{const request=window.pendingDetails.get(requestId);if(!request)throw new Error('Unknown detail request '+requestId);window.pendingDetails.delete(requestId);window.socket.emit({...request,events:generations.get(request.generation).slice(request.start,request.end)})};
window.failDetail=requestId=>{const request=window.pendingDetails.get(requestId);window.pendingDetails.delete(requestId);window.socket.emit({...request,error:'Fixture detail unavailable'})};
window.replaceGeneration=(generation,prefix)=>window.socket.emit({type:'history',page:makePage(generation,prefix)});
window.WebSocket=Socket;
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><div style={{height:'100vh',display:'flex'}}><AgentPanel cacheAccount="alice" project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} /></div></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:work-details.tsx', write: false, platform: 'browser', onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning) }, output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{
    name: 'work-details-fixture',
    async resolveId(id, importer) {
      if (id === 'virtual:work-details.tsx') return id
      if (id === '@mew/tmux-term') return 'virtual:terminal'
      if (id.endsWith('.css')) return 'virtual:style'
      if (id.endsWith('?raw')) { const resolved = await this.resolve(id.slice(0, -4), importer, { skipSelf: true }); if (resolved) return `${resolved.id}?raw` }
    },
    async load(id) {
      if (id === 'virtual:work-details.tsx') return source
      if (id === 'virtual:terminal') return 'export const isHiddenTmuxSession=()=>false;export function TmuxTerminal(){return null}'
      if (id === 'virtual:style') return ''
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))}`
    },
  }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = await fs.readFile(`${root}/src/components/AgentPanel.tsx`, 'utf8')
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(6000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-work-details.test/**', route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: [{ id: 'history', label: 'History', renamed: true, runtime: 'codex', cwd: '/workspace', sessionIds: { [JSON.stringify(['codex', '/workspace'])]: 'conversation' } }], activeId: 'history' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-work-details.test/')
      await page.getByText('Initial question 5', { exact: true }).waitFor()
      await page.getByText('Initial answer 5', { exact: true }).waitFor()
      const socketUrl = new URL(await page.evaluate('window.socketUrl') as string)
      assert.equal(socketUrl.searchParams.get('deferWork'), '1')
      assert.equal(socketUrl.searchParams.get('turns'), '3')
      assert.equal(await page.getByText('Initial question 2', { exact: true }).count(), 0, 'the first render only includes the latest three turns')
      assert.equal(await page.locator('[data-agent-loading]').count(), 0, 'work details do not block the conversation')
      await page.waitForFunction("window.requests.filter(request=>request.type==='history_details').length===2")
      assert.equal(await page.evaluate('window.pendingDetails.size'), 2, 'two deferred runs load in parallel')
      assert.equal(await page.getByText('Initial reasoning 5', { exact: true }).count(), 0, 'work remains unrendered before its response')
      const header = page.locator('[data-agent-turn-header]').filter({ hasText: 'Initial answer 5' })
      await header.locator('button[aria-expanded]').click()
      const turn = header.locator('..')
      const details = turn.locator('[data-agent-work-details]')
      const toggle = details.getByRole('button', { name: '작업 상세', exact: true })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      await toggle.press('Enter')
      await details.locator('[data-agent-work-loading]').waitFor({ state: 'visible' })
      await turn.locator('.mew-agent-markdown').getByText('Initial answer 5', { exact: true }).waitFor({ state: 'visible' })
      await page.screenshot({ path: `/tmp/mew-lazy-work-loading-${width}-${dark ? 'dark' : 'light'}.png` })
      const firstId = await page.evaluate("[...window.pendingDetails.values()].find(request=>request.start===32).requestId")
      await page.evaluate(`window.failDetail(${JSON.stringify(firstId)})`)
      await details.locator('[data-agent-work-error]').waitFor({ state: 'visible' })
      await details.getByRole('button', { name: '다시 시도', exact: true }).click()
      await details.locator('[data-agent-work-loading]').waitFor({ state: 'visible' })
      await page.evaluate('window.finishDetail(window.pendingDetails.keys().next().value)')
      await page.waitForFunction("[...window.pendingDetails.values()].some(request=>request.start===32)")
      const retryId = await page.evaluate("[...window.pendingDetails.values()].find(request=>request.start===32).requestId")
      assert.notEqual(retryId, firstId, 'retry uses a new request rather than accepting the failed attempt')
      await page.evaluate(`window.socket.emit({type:'history_event',position:{generation:'initial-generation',seq:36},event:{type:'update',update:{sessionUpdate:'tool_call_update',toolCallId:'Initial-tool-5',title:'Live updated file status',status:'failed'}}});window.socket.emit({type:'error',message:'Concurrent detail error'});window.finishDetail(${JSON.stringify(retryId)})`)
      await details.getByText('Initial reasoning 5', { exact: true }).waitFor()
      await details.getByText('Live updated file status', { exact: true }).waitFor()
      assert.equal(await details.getByText('실패', { exact: true }).count(), 1, 'live tool status survives hydration of its earlier deferred tool call')
      await page.getByRole('button', { name: 'Concurrent detail error', exact: true }).waitFor()
      assert.equal(await details.locator('[data-agent-work-loading]').count(), 0)
      await page.waitForFunction("window.requests.filter(request=>request.type==='history_details').length===4")
      await page.evaluate('[...window.pendingDetails.keys()].forEach(window.finishDetail)')
      await page.waitForFunction('window.pendingDetails.size===0')
      await page.evaluate("window.socket.emit({type:'history_event',position:{generation:'initial-generation',seq:36},event:{type:'update',update:{sessionUpdate:'tool_call_update',toolCallId:'Initial-tool-5',title:'Duplicated deferred tool update',status:'completed'}}})")
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.equal(await page.getByText('Concurrent detail error', { exact: true }).count(), 1, 'an unsequenced error queued in the same frame remains visible after every hydration')
      assert.equal(await details.getByText('Live updated file status', { exact: true }).count(), 1, 'hydration does not duplicate the tool or replay its live update')
      assert.equal(await page.getByText('Duplicated deferred tool update', { exact: true }).count(), 0, 'a repeated live sequence is ignored after hydration')
      assert.equal(await page.evaluate('window.maxDetails'), 2, 'background concurrency never exceeds two')
      const requestCount = await page.evaluate("window.requests.filter(request=>request.type==='history_details').length")
      await toggle.press('Space')
      await toggle.press('Enter')
      assert.equal(await page.evaluate("window.requests.filter(request=>request.type==='history_details').length"), requestCount, 'reopening loaded details does not query again')
      await header.getByRole('button', { name: '이 답변 복사', exact: true }).click()
      assert.equal(await page.evaluate('window.copied'), 'Initial answer 5', 'answer copy excludes deferred reasoning and tools')
      const detailBounds = await details.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      assert.ok(detailBounds.scroll <= detailBounds.client, 'deferred details fit both viewport widths')
      await page.screenshot({ path: `/tmp/mew-lazy-work-loaded-${width}-${dark ? 'dark' : 'light'}.png` })

      await page.evaluate("window.replaceGeneration('stale-generation','Stale')")
      await page.locator('[data-agent-turn-header]').filter({ hasText: 'Stale answer 5' }).waitFor()
      await page.waitForFunction("[...window.pendingDetails.values()].filter(request=>request.generation==='stale-generation').length===2")
      await page.evaluate("window.replaceGeneration('fresh-generation','Fresh')")
      await page.locator('[data-agent-turn-header]').filter({ hasText: 'Fresh answer 5' }).waitFor()
      await page.waitForFunction("[...window.pendingDetails.values()].filter(request=>request.generation==='fresh-generation').length===2")
      await page.evaluate("[...window.pendingDetails.values()].filter(request=>request.generation==='stale-generation').forEach(request=>window.finishDetail(request.requestId))")
      const freshHeader = page.locator('[data-agent-turn-header]').filter({ hasText: 'Fresh answer 5' })
      const freshTurnToggle = freshHeader.locator('button[aria-expanded]')
      if (await freshTurnToggle.getAttribute('aria-expanded') !== 'true') await freshTurnToggle.click()
      const freshDetails = freshHeader.locator('..').locator('[data-agent-work-details]')
      const freshDetailsToggle = freshDetails.getByRole('button', { name: '작업 상세', exact: true })
      if (await freshDetailsToggle.getAttribute('aria-expanded') !== 'true') await freshDetailsToggle.click()
      await freshDetails.locator('[data-agent-work-loading]').waitFor()
      assert.equal(await page.getByText('Stale reasoning 5', { exact: true }).count(), 0, 'late old-generation details cannot hydrate the new range')
      const conversation = page.locator('[data-agent-conversation]')
      await conversation.evaluate(el => {
        Object.defineProperty(el.ownerDocument, 'visibilityState', { configurable: true, value: 'hidden' })
        el.ownerDocument.dispatchEvent(new Event('visibilitychange'))
      })
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await page.evaluate("[...window.pendingDetails.values()].filter(request=>request.generation==='fresh-generation').forEach(request=>window.finishDetail(request.requestId))")
      await freshDetails.getByText('Fresh reasoning 5', { exact: true }).waitFor()
      await freshDetails.getByText('Fresh inspect file 5', { exact: true }).waitFor()
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.equal(await page.evaluate("window.requests.filter(request=>request.type==='history_details'&&request.generation==='fresh-generation').length"), 2, 'a hidden document finishes in-flight responses without starting queued details')
      await conversation.evaluate(el => {
        Object.defineProperty(el.ownerDocument, 'visibilityState', { configurable: true, value: 'visible' })
        el.ownerDocument.dispatchEvent(new Event('visibilitychange'))
      })
      await page.waitForFunction("window.requests.filter(request=>request.type==='history_details'&&request.generation==='fresh-generation').length===3")
      await page.evaluate('[...window.pendingDetails.keys()].forEach(window.finishDetail)')
      await page.waitForFunction('window.pendingDetails.size===0')
      assert.equal(await page.getByText('Stale reasoning 5', { exact: true }).count(), 0)
      assert.deepEqual(errors, [])
      t.diagnostic(`${width}px ${dark ? 'dark' : 'light'}: StrictMode lifecycle, deferred loading, retry, concurrency, same-frame errors, live tool updates, stale generation and hidden-document pause checked`)
      await page.close()
    }
  } finally { await browser.close() }
})
