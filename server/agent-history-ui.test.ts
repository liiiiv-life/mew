import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('paged conversations keep scroll position and restore account-scoped IndexedDB on desktop/mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {HistoryIndex} from '${root}/shared/agent-history.ts';
import * as cache from '${root}/src/utils/agent-history-cache.ts';
localStorage.setItem('mew:locale','ko');window.cache=cache;window.requests=[];
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text}}});
const events=JSON.parse(sessionStorage.getItem('fixture-events')||'[]');if(!events.length)for(let i=0;i<45;i++)events.push({type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Question '+i}}},{type:'turn_start'},{type:'update',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Answer '+i+' '+(i===42||i===43?'long readable answer\\n\\n'.repeat(65):i===40?'long readable answer '.repeat(100):i===44?'short':'long readable answer '.repeat(15))}}},...(i===44?[
{type:'update',update:{sessionUpdate:'tool_call',toolCallId:'saved-tool-1',title:'Read project requirements',status:'completed'}},
{type:'update',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Considering project requirements'}}},
{type:'update',update:{sessionUpdate:'tool_call',toolCallId:'saved-tool-2',title:'Inspect renderer',status:'failed'}},
{type:'update',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Saved final answer'}}},
]:[]),{type:'turn_end',stopReason:'end_turn',durationMs:i===40||i===44?90000:i===41?45296000:i===42?125000:undefined});
const index=new HistoryIndex('browser-generation');events.forEach(event=>index.push(event));
const meta={type:'meta',meta:{sessionId:'conversation',startedAt:new Date().toISOString(),turns:45,busy:false,queued:location.search.includes('slow')?[]:['Saved queue task'],queuedKinds:['prompt'],queuedAttachments:[[{project:'test',path:'notes.md',mimeType:'text/markdown'}]],queuedSettings:[{model:'Cached model',thinking:'High',permission:'Default'}],usage:null,canLoad:true,canList:true}};
class Socket {
 static OPEN=1;readyState=0;
 constructor(url){window.socket=this;this.url=url;window.requests.push(url);setTimeout(()=>{this.readyState=1;this.onopen?.();const query=new URL(url).searchParams;this.emit({type:'history',page:index.page(events,'conversation',{generation:query.get('generation'),after:query.has('after')?Number(query.get('after')):undefined})});this.emit(meta)},location.search.includes('slow')?1500:20)}
 emit(event){if(['update','user_images','user_attachments','turn_start','turn_end','permission','permission_done','error','fatal'].includes(event.type)){const position={generation:index.generation,seq:events.length};events.push(event);index.push(event);event={type:'history_event',event,position}}this.onmessage?.({data:JSON.stringify(event)})}
 send(raw){const message=JSON.parse(raw);window.requests.push(message);if(message.type==='history')setTimeout(()=>this.emit({type:'history',page:index.page(events,'conversation',message.range)}),20)}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;window.historyIndex=index;window.fixtureEvents=events;
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
  const content = (await Promise.all(['src/components/AgentPanel.tsx', 'src/components/agent-attachment-icon.tsx', 'src/components/MentionTextarea.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
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
        if (pathname === '/api/raw' && new URL(route.request().url()).searchParams.get('path')?.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII=', 'base64') })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-history.test/')
      await page.getByText('Question 44', { exact: true }).waitFor()
      assert.equal(await page.getByText('Question 24', { exact: true }).count(), 0)
      const savedHeader = page.locator('[data-agent-turn-header]').filter({ has: page.getByText('Saved final answer', { exact: true }) })
      await savedHeader.locator('button[aria-expanded]').click()
      const savedTurn = savedHeader.locator('..')
      const savedDetails = savedTurn.locator('[data-agent-work-details]')
      const savedToggle = savedDetails.getByRole('button', { name: '작업 상세', exact: true })
      assert.equal(await savedDetails.count(), 1, 'thoughts between tool groups share one disclosure')
      assert.equal(await savedToggle.getAttribute('aria-expanded'), 'false', 'restored details start collapsed')
      assert.equal(await savedTurn.getByText('Considering project requirements', { exact: true }).count(), 0)
      assert.equal(await savedTurn.locator('.mew-agent-markdown').count(), 2, 'ordinary answers stay outside details')
      await savedToggle.press('Enter')
      assert.equal(await savedToggle.getAttribute('aria-expanded'), 'true')
      const detailText = await savedDetails.innerText()
      assert.ok(detailText.indexOf('Read project requirements') < detailText.indexOf('Considering project requirements'))
      assert.ok(detailText.indexOf('Considering project requirements') < detailText.indexOf('Inspect renderer'))
      assert.equal(await savedDetails.getByText('실패', { exact: true }).count(), 1)
      assert.equal(await savedDetails.getByText(/개 작업/).count(), 0, 'old per-group task summaries are removed')
      const detailBounds = await savedDetails.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      assert.ok(detailBounds.scroll <= detailBounds.client, 'details fit desktop and mobile widths')
      await savedTurn.screenshot({ path: `/tmp/mew-work-details-${width}-${dark ? 'dark' : 'light'}.png` })
      await savedHeader.getByRole('button', { name: '이 답변 복사', exact: true }).click()
      assert.equal(await page.evaluate('window.copied'), 'Answer 44 short\n\nSaved final answer', 'copy excludes thoughts and tools')
      await savedToggle.press('Space')
      assert.equal(await savedToggle.getAttribute('aria-expanded'), 'false')
      await savedHeader.locator('button[aria-expanded]').click()

      const scroll = page.locator('[data-agent-conversation] > div').first()
      await scroll.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
      await page.getByText('Question 5', { exact: true }).waitFor({ state: 'attached' })
      assert.ok(await scroll.evaluate(el => el.scrollTop > 100), 'prepend preserves the previous viewport')
      const timedHeader = page.locator('[data-agent-turn-header]').filter({ has: page.getByText(/^Answer 40 /) })
      await timedHeader.scrollIntoViewIfNeeded()
      await timedHeader.screenshot({ path: `/tmp/mew-answer-header-${width}-${dark ? 'dark' : 'light'}.png` })
      assert.equal(await timedHeader.locator('..').locator('[data-agent-duration]').count(), 0, 'collapsed answers hide duration')
      assert.equal(await timedHeader.getByRole('button', { name: '이 답변 복사', exact: true }).count(), 0, 'collapsed answers hide copy')
      assert.equal(await timedHeader.locator('button[aria-expanded] svg').count(), 0, 'answer has no disclosure icon')
      const questionButton = page.getByText('Question 40', { exact: true }).locator('..')
      assert.equal(await questionButton.locator('svg').count(), 0, 'question has no disclosure icon')
      const question = page.locator('[data-agent-question]').filter({ has: questionButton })
      for (const open of [false, true]) {
        if (open) await questionButton.click()
        const bounds = await question.evaluate(el => {
          const bubble = el.querySelector('button[aria-expanded]')!
          const copy = el.querySelector('button[title="이 질문 복사"]')!
          return { left: bubble.getBoundingClientRect().left, copyRight: copy.getBoundingClientRect().right, background: el.ownerDocument.defaultView!.getComputedStyle(copy.parentElement!).backgroundColor }
        })
        assert.ok(bounds.copyRight < bounds.left, 'question copy sits outside the left of the bubble')
        assert.equal(bounds.background, 'rgba(0, 0, 0, 0)', 'question copy container has no bubble background')
        await question.getByRole('button', { name: '이 질문 복사', exact: true }).click()
        assert.equal(await page.evaluate('window.copied'), 'Question 40')
        assert.equal(await questionButton.getAttribute('aria-expanded'), String(open), 'question copy preserves disclosure state')
      }
      await questionButton.click()
      await timedHeader.locator('button[aria-expanded]').press('Enter')
      const composer = page.locator('[data-keep-keyboard] [contenteditable="true"]')
      await composer.focus()
      if (width < 768) {
        const cdp = await page.context().newCDPSession(page)
        try {
          const composerPanel = page.locator('[data-agent-composer]')
          const original = (await composerPanel.boundingBox())!
          for (const scale of [1.25, 1.5, 2, 1]) {
            await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale })
            await page.waitForFunction(`window.visualViewport.scale === ${scale}`)
            await page.waitForTimeout(80)
            assert.equal(await composerPanel.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).marginBottom), '0px', 'pinch zoom does not insert a keyboard gap below the composer')
            const bounds = (await composerPanel.boundingBox())!
            assert.ok(Math.abs(bounds.y + bounds.height - original.y - original.height) < 1, 'zoom preserves the composer bottom in layout coordinates')
          }
        } finally { await cdp.detach() }
      }
      const answerBody = timedHeader.locator('..').locator('.mew-agent-markdown')
      await answerBody.click({ position: { x: 12, y: 12 } })
      assert.equal(await scroll.evaluate(el => el === el.ownerDocument.activeElement), true, 'answer clicks focus the conversation for question navigation')
      assert.equal(await scroll.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).outlineStyle), 'none', 'clicking answer text after composing does not outline the chat')
      await scroll.press('ArrowUp')
      assert.equal(await scroll.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).outlineWidth), '2px', 'keyboard navigation retains its focus indicator')
      await answerBody.click({ position: { x: 12, y: 12 } })
      assert.equal(await scroll.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).outlineStyle), 'none', 'pointer input clears the ring on an already focused conversation')
      await composer.focus()
      await scroll.focus()
      assert.equal(await scroll.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).outlineWidth), '2px', 'returning focus from the composer restores the keyboard indicator')
      await timedHeader.getByRole('button', { name: '이 답변 복사', exact: true }).click()
      assert.equal(await page.evaluate('window.copied'), 'Answer 40 ' + 'long readable answer '.repeat(100), 'copy retains the full answer')
      assert.equal(await timedHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'true', 'copy leaves the answer expanded')
      await timedHeader.locator('button[aria-expanded]').press('Space')
      assert.equal(await timedHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'false')
      assert.equal(await timedHeader.getByRole('button', { name: '이 답변 복사', exact: true }).count(), 0, 'folding removes copy from the focus order')
      const assertHeaderAlignment = async (header: typeof timedHeader) => {
        const centers = await header.evaluate(el => {
          const center = (element: Pick<typeof el, 'getBoundingClientRect'>) => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2 }
          const dot = el.querySelector('button[aria-expanded] > span[aria-label]')!
          const elements = [dot, ...el.querySelectorAll('[data-agent-duration], button:not([aria-expanded]), button:not([aria-expanded]) svg, button:not([aria-expanded]) > span')]
          return elements.map(element => ({ name: element.getAttribute('aria-label') ?? element.textContent, y: center(element) }))
        })
        assert.ok(Math.max(...centers.map(item => item.y)) - Math.min(...centers.map(item => item.y)) <= 0.5, `expanded header shares one vertical center: ${JSON.stringify(centers)}`)
      }
      const shortHeader = page.locator('[data-agent-turn-header]').filter({ has: page.locator('[data-agent-summary]').filter({ hasText: 'Saved final answer' }) })
      assert.equal(await shortHeader.locator('..').locator('[data-agent-duration]').count(), 0, 'short collapsed answers hide duration')
      const oldHeader = page.locator('[data-agent-turn-header]').filter({ has: page.getByText(/^Answer 43 /) })
      assert.equal(await oldHeader.locator('[data-agent-duration]').count(), 0, 'older transcripts without duration have no time placeholder')
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
      const expandedHeader = page.locator('[data-agent-turn-header]').filter({ has: page.getByText(/^Answer 42 /) })
      const stickyBounds = await expandedHeader.evaluate(el => {
        const scroller = el.parentElement!.parentElement!
        return { header: el.getBoundingClientRect().top, viewport: scroller.getBoundingClientRect().top + scroller.clientTop }
      })
      assert.ok(Math.abs(stickyBounds.header - stickyBounds.viewport) <= 1, `expanded header sticks to the conversation top: ${JSON.stringify(stickyBounds)}`)
      assert.equal(await expandedHeader.locator('[data-agent-duration]').count(), 0, 'expanded headers hide duration')
      await assertHeaderAlignment(expandedHeader)
      const footer = expandedHeader.locator('..').locator('[data-agent-turn-footer]')
      assert.equal(await footer.locator('[data-agent-duration]').textContent(), '2분 5초')
      const timeBounds = await footer.evaluate(el => {
        const time = el.querySelector('[data-agent-duration]')!.getBoundingClientRect()
        const button = el.querySelector('button')!.getBoundingClientRect()
        return { right: time.right, left: button.left, timeCenter: time.top + time.height / 2, buttonCenter: button.top + button.height / 2 }
      })
      assert.ok(timeBounds.right <= timeBounds.left && Math.abs(timeBounds.timeCenter - timeBounds.buttonCenter) <= 0.5, 'duration sits beside collapse on the same vertical center')
      const footerBounds = await footer.evaluate(el => {
        const scroller = el.parentElement!.parentElement!
        return { bottom: el.getBoundingClientRect().bottom, viewportBottom: scroller.getBoundingClientRect().bottom - scroller.clientTop, top: el.getBoundingClientRect().top, bubbleTop: el.parentElement!.getBoundingClientRect().top }
      })
      assert.ok(Math.abs(footerBounds.bottom - footerBounds.viewportBottom) <= 1, `collapse footer sticks to the conversation bottom: ${JSON.stringify(footerBounds)}`)
      assert.ok(footerBounds.top >= footerBounds.bubbleTop, 'footer stays inside its answer bubble')
      await expandedHeader.getByRole('button', { name: '이 답변 복사', exact: true }).click()
      assert.equal(await expandedHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'true', 'sticky copy leaves the answer expanded')
      assert.equal(await page.evaluate('window.copied'), 'Answer 42 ' + 'long readable answer\n\n'.repeat(65))
      await scroll.screenshot({ path: `/tmp/mew-sticky-answer-${width}-${dark ? 'dark' : 'light'}.png` })
      await footer.getByRole('button', { name: '접기', exact: true }).click()
      assert.equal(await expandedHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'false', 'sticky footer collapses its answer')
      assert.equal(await footer.count(), 0, 'collapsed answers remove the footer')
      assert.equal(await expandedHeader.locator('..').locator('[data-agent-duration]').count(), 0, 'folding hides duration')
      await expandedHeader.locator('button[aria-expanded]').press('Enter')
      await scroll.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')) }, middle)
      await footer.getByRole('button', { name: '접기', exact: true }).press('Space')
      assert.equal(await expandedHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'false', 'keyboard activation collapses the answer')
      await expandedHeader.locator('button[aria-expanded]').press('Enter')
      assert.equal(await expandedHeader.getByRole('button', { name: '질문으로', exact: true }).count(), 0, 'expanded headers omit the question jump button')
      await scroll.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')) }, middle)
      await scroll.focus()
      await scroll.press('ArrowUp')
      await assertAtQuestion(42)
      assert.equal(await expandedHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'true', 'keyboard question navigation leaves the answer expanded')
      await scroll.press('ArrowUp')
      await assertAtQuestion(41)
      // A following expanded answer supplies enough scroll range to pass this bubble's end.
      await oldHeader.locator('button[aria-expanded]').evaluate(el => el.dispatchEvent(new el.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true })))
      const boundaryTop = await expandedHeader.evaluate(el => {
        const scroller = el.parentElement!.parentElement!
        return el.parentElement!.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top
          - scroller.clientTop + scroller.scrollTop - el.getBoundingClientRect().height / 2
      })
      await scroll.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')) }, boundaryTop)
      const boundary = await expandedHeader.evaluate(el => ({
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
        bubbleBottom: el.parentElement!.getBoundingClientRect().bottom,
        viewportTop: el.parentElement!.parentElement!.getBoundingClientRect().top,
      }))
      assert.ok(boundary.top < boundary.viewportTop && boundary.bottom <= boundary.bubbleBottom + 1, 'sticky header yields at its own bubble bottom')
      await oldHeader.locator('button[aria-expanded]').evaluate(el => el.dispatchEvent(new el.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true })))
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
      assert.ok(await page.evaluate(`new URL(window.requests[0]).searchParams.get('after')===String(window.fixtureEvents.length)`), 'reload resumes from the cached cursor')
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
        const rolling = await page.evaluate(async () => {
          const cache = (globalThis as any).cache
          const key = cache.historyCacheKey('alice', 'codex', 'rolling', '/workspace')
          const events = Array.from({ length: 22 }, (_, i) => [
            { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: `q${i}` } } },
            { type: 'turn_start' },
            { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `a${i}` } } },
            { type: 'turn_end', stopReason: 'end_turn' },
          ]).flat()
          const value = { generation: 'rolling', sessionId: 'rolling', start: 0, end: events.length, total: events.length, usersBefore: 0, events }
          const store = (globalThis as any).IDBObjectStore
          const original = store.prototype.put
          let puts = 0
          // Existing version-1 cache rows do not have the optional byte count.
          store.prototype.put = function (row: any, ...args: any[]) {
            return original.call(this, this.name === 'events' && row.key === key ? { ...row, bytes: undefined } : row, ...args)
          }
          try { await cache.writeHistoryCache(key, 'rolling', value) }
          finally { store.prototype.put = original }
          events.push(...events.slice(-4))
          store.prototype.put = function (row: any, ...args: any[]) {
            if (this.name === 'events' && row.key === key) puts++
            return original.call(this, row, ...args)
          }
          try { await cache.writeHistoryCache(key, 'rolling', { ...value, end: events.length, total: events.length }) }
          finally { store.prototype.put = original }
          const saved = await cache.readHistoryCache(key)
          const writes = puts
          store.prototype.put = function (row: any, ...args: any[]) {
            if (this.name === 'events' && row.key === key) throw new DOMException('injected rolling quota', 'QuotaExceededError')
            return original.call(this, row, ...args)
          }
          events.push(...events.slice(-4))
          try { await cache.writeHistoryCache(key, 'rolling', { ...value, end: events.length, total: events.length }) }
          finally { store.prototype.put = original }
          const rollback = await cache.readHistoryCache(key)
          await cache.clearHistoryTab('rolling')
          return { writes, start: saved.start, count: saved.events.length, usersBefore: saved.usersBefore,
            rollback: rollback.start === saved.start && rollback.end === saved.end && JSON.stringify(rollback.events) === JSON.stringify(saved.events) }
        })
        assert.deepEqual(rolling, { writes: 4, start: 12, count: 80, usersBefore: 3, rollback: true },
          'the rolling cache writes only the new turn, reads legacy rows and rolls pruning back on quota failure')
      }
      await page.evaluate(`window.cache.clearHistoryTab('history')`)
      assert.equal(await page.evaluate(`window.cache.readHistoryCache(window.cache.historyCacheKey('alice','codex','history','/workspace'))`), null)
      assert.equal(await page.evaluate(`window.cache.readQueueCache(window.cache.historyCacheKey('alice','codex','history','/workspace'))`), null)
      await page.evaluate(`
        window.socket.emit({type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Question 45'}}});
        window.socket.emit({type:'turn_start',startedAt:Date.now()-90000});
        window.socket.emit({type:'update',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Running answer '+('streamed paragraph\\n\\n'.repeat(65))}}});
        window.socket.emit({type:'update',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Live reasoning'}}});
        window.socket.emit({type:'update',update:{sessionUpdate:'tool_call',toolCallId:'live-tool',title:'Live tool',status:'in_progress'}});
        window.socket.emit({type:'meta',meta:{sessionId:'conversation',busy:true,turns:45,queued:[]}});
      `)
      const runningHeader = page.locator('[data-agent-turn-header]').last()
      await runningHeader.getByRole('button', { name: '중단', exact: true }).waitFor()
      assert.equal(await runningHeader.getByRole('button', { name: '이 답변 복사', exact: true }).count(), 0, 'collapsed running answers hide copy')
      assert.equal(await runningHeader.getByRole('button', { name: '중단', exact: true }).isVisible(), true, 'collapsed running answers retain stop')
      await runningHeader.locator('button[aria-expanded]').click()
      const liveDetails = runningHeader.locator('..').locator('[data-agent-work-details]')
      const liveToggle = liveDetails.getByRole('button', { name: '작업 상세', exact: true })
      assert.equal(await liveToggle.getAttribute('aria-expanded'), 'false')
      await liveToggle.click()
      await page.evaluate(() => {
        const socket = (globalThis as any).socket
        socket.emit({ type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'live-tool', status: 'completed' } })
        socket.emit({ type: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'More live reasoning' } } })
        socket.emit({ type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'live-tool-2', title: 'Second live tool', status: 'failed' } })
      })
      await liveDetails.getByText('Second live tool', { exact: true }).waitFor()
      assert.equal(await liveDetails.count(), 1)
      assert.equal(await liveToggle.getAttribute('aria-expanded'), 'true', 'streaming preserves the disclosure state')
      assert.equal(await liveDetails.getByText('완료', { exact: true }).count(), 1)
      assert.equal(await liveDetails.getByText('실패', { exact: true }).count(), 1)
      await liveToggle.click()

      await scroll.evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')) }, await questionTop(45) + 500)
      const runningBounds = await runningHeader.evaluate(el => ({ top: el.getBoundingClientRect().top, viewport: el.parentElement!.parentElement!.getBoundingClientRect().top }))
      assert.ok(Math.abs(runningBounds.top - runningBounds.viewport) <= 1, 'running header sticks with all controls')
      await assertHeaderAlignment(runningHeader)
      assert.equal(await runningHeader.locator('[data-agent-duration]').count(), 0, 'running headers hide duration')
      assert.equal(await runningHeader.locator('..').locator('[data-agent-turn-footer] [data-agent-duration]').isVisible(), true, 'running duration appears in the sticky footer')
      await scroll.screenshot({ path: `/tmp/mew-running-answer-${width}-${dark ? 'dark' : 'light'}.png` })
      await runningHeader.getByRole('button', { name: '중단', exact: true }).click()
      assert.equal(await page.evaluate('window.requests.at(-1).type'), 'cancel', 'sticky stop cancels the active turn')
      assert.equal(await runningHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'true', 'stop does not fold the answer')
      assert.equal(await runningHeader.getByRole('button', { name: '질문으로', exact: true }).count(), 0, 'running headers omit the question jump button')
      await scroll.focus()
      await scroll.press('ArrowUp')
      await assertAtQuestion(45)
      await page.evaluate(() => {
        const socket = (globalThis as any).socket
        for (let i = 0; i < 200; i++) socket.emit({ type: 'update', update: {
          sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ` chunk-${i}` },
        } })
        const index = (globalThis as any).historyIndex
        socket.emit({ type: 'history_event', position: { generation: index.generation, seq: index.length - 1 },
          event: { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'DUPLICATED' } } } })
      })
      await runningHeader.locator('..').locator('.mew-agent-markdown').filter({ hasText: 'chunk-199' }).waitFor()
      assert.equal(await page.getByText('DUPLICATED', { exact: false }).count(), 0)
      assert.equal(await page.getByText('Question 45', { exact: true }).count(), 1)
      await page.waitForFunction(`window.cache.readHistoryCache(${queueKey}).then(value=>value?.events.at(-1)?.update?.content?.text===' chunk-199')`)
      const attachments = [
        { project: '.workspace', path: '.mew/assets/photo.png', mimeType: 'image/png' },
        { project: '.workspace', path: '.mew/assets/voice.mp3', mimeType: 'audio/mpeg' },
        { project: 'docs', path: 'clip.mp4', mimeType: 'video/mp4' },
        { project: '.workspace', path: '.mew/assets/notes.pdf', mimeType: 'application/pdf' },
      ]
      await page.evaluate(files => {
        const socket = (globalThis as any).socket
        socket.emit({ type: 'turn_end', stopReason: 'end_turn' })
        socket.emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '첨부 확인' } } })
        socket.emit({ type: 'user_attachments', attachments: files })
        socket.emit({ type: 'turn_start' })
      }, attachments)
      const media = page.locator('[data-agent-attachments]').last()
      await media.getByRole('link', { name: 'notes.pdf', exact: true }).waitFor()
      const verifyMedia = async () => {
        for (const file of attachments.filter(file => !file.mimeType.startsWith('image/'))) {
          const link = media.getByRole('link', { name: file.path.split('/').at(-1)!, exact: true }).last()
          const url = new URL((await link.getAttribute('href'))!, page.url())
          assert.equal(url.searchParams.get('path'), file.path)
          assert.equal(url.searchParams.get('project'), file.project)
        }
        assert.equal(await media.locator('svg').count(), 4)
        const bubble = media.locator('..')
        assert.notEqual(await bubble.getAttribute('data-agent-question-bubble'), null, 'attachments share the user message bubble')
        assert.equal(await media.innerText(), '첨부 확인', 'tags show icons without extension labels or raw paths')
        assert.equal(await bubble.locator('button button, button a').count(), 0, 'preview and file controls are separate from the disclosure button')
        assert.equal(await media.getByRole('button', { name: /첨부 제거/ }).count(), 0)
        assert.equal(await media.locator('img,audio,video').count(), 0, 'media stays outside the conversation until opened')
        const disclosure = bubble.locator('button[aria-expanded]')
        const expanded = await disclosure.getAttribute('aria-expanded')
        const photo = media.getByRole('button', { name: 'photo.png 사진 미리보기', exact: true })
        await photo.click()
        const preview = page.getByRole('dialog', { name: 'photo.png 사진 미리보기', exact: true })
        await preview.locator('img').evaluate(async el => { await el.decode() })
        const imageUrl = new URL((await preview.locator('img').getAttribute('src'))!, page.url())
        assert.equal(imageUrl.searchParams.get('project'), '.workspace')
        assert.equal(imageUrl.searchParams.get('path'), '.mew/assets/photo.png')
        await preview.getByRole('button', { name: '사진 미리보기 닫기', exact: true }).click()
        assert.equal(await disclosure.getAttribute('aria-expanded'), expanded, 'preview clicks preserve disclosure state')
        for (const key of ['Enter', 'Space']) {
          await photo.press(key)
          await preview.waitFor()
          await preview.press('Escape')
          await preview.waitFor({ state: 'detached' })
          assert.equal(await disclosure.getAttribute('aria-expanded'), expanded, 'preview keyboard activation preserves disclosure state')
        }
        const link = media.getByRole('link', { name: 'notes.pdf', exact: true })
        await link.evaluate(el => el.addEventListener('click', (event: { preventDefault(): void }) => event.preventDefault(), { once: true }))
        await link.click()
        assert.equal(await disclosure.getAttribute('aria-expanded'), expanded, 'file clicks preserve disclosure state')
        assert.ok(await media.evaluate(el => el.getBoundingClientRect().right <= el.ownerDocument.defaultView!.innerWidth))
      }
      await verifyMedia()
      await media.scrollIntoViewIfNeeded()
      await media.screenshot({ path: `/tmp/mew-agent-attachments-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.evaluate(() => { sessionStorage.setItem('fixture-events', JSON.stringify((globalThis as any).fixtureEvents)) })
      await page.reload()
      await page.locator('[data-agent-attachments]').last().getByRole('link', { name: 'notes.pdf', exact: true }).waitFor()
      await verifyMedia()
      await page.evaluate(() => {
        const socket = (globalThis as any).socket
        socket.emit({ type: 'turn_end', stopReason: 'end_turn' })
        socket.emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '이전 사진 [[.workspace:.mew/assets/old photo.jpg]]' } } })
      })
      await page.locator('[data-agent-attachments]').last().getByRole('button', { name: 'old photo.jpg 사진 미리보기', exact: true }).waitFor()
      const inlinePhoto = { project: '.workspace', path: '.mew/assets/사진 #1%.png', mimeType: 'image/png' }
      const inlineNote = { project: 'docs', path: '.mew/files/notes.pdf', mimeType: 'application/pdf' }
      const photoRef = `[[${inlinePhoto.project}:${inlinePhoto.path}]]`
      const noteRef = `[[${inlineNote.project}:${inlineNote.path}]]`
      const inlineText = `앞${photoRef}중간${noteRef}뒤${photoRef} [[docs:guide.md]]`
      await page.evaluate(({ text, files }) => {
        const socket = (globalThis as any).socket
        socket.emit({ type: 'turn_start' })
        socket.emit({ type: 'turn_end', stopReason: 'end_turn' })
        socket.emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } } })
        socket.emit({ type: 'user_attachments', attachments: files })
      }, { text: inlineText, files: [inlinePhoto, inlineNote] })
      const inline = page.locator('[data-agent-question-bubble]').filter({ has: page.getByRole('button', { name: '앞중간뒤 [[docs:guide.md]]', exact: true }) })
      await inline.getByRole('link', { name: 'notes.pdf', exact: true }).waitFor()
      const content = inline.locator('[data-agent-attachments]')
      assert.equal(await content.textContent(), '앞중간뒤 [[docs:guide.md]]')
      assert.deepEqual(await content.evaluate(el => Array.from(el.childNodes, (node: { nodeType: number; textContent: string | null; getAttribute(name: string): string | null }) => node.nodeType === 3
        ? node.textContent : node.getAttribute('title'))), ['앞', '사진 #1%.png', '중간', 'notes.pdf', '뒤', '사진 #1%.png', ' [[docs:guide.md]]'], 'inline order and repeated references survive metadata deduplication')
      assert.ok(await content.evaluate(el => {
        const text = el.ownerDocument.createRange()
        text.selectNode(el.firstChild!)
        const before = text.getBoundingClientRect()
        const tag = el.querySelector('[data-agent-attachment]')!
        const bounds = tag.getBoundingClientRect()
        return el.ownerDocument.defaultView!.getComputedStyle(tag).display === 'inline-flex'
          && bounds.left >= before.right && bounds.top < before.bottom
      }), 'the first tag follows its preceding text on the same line')
      const inlineDisclosure = inline.locator('button[aria-expanded]')
      await inlineDisclosure.press('Enter')
      assert.equal(await inlineDisclosure.getAttribute('aria-expanded'), 'true')
      await inlineDisclosure.press('Space')
      assert.equal(await inlineDisclosure.getAttribute('aria-expanded'), 'false')
      await content.click({ position: { x: 2, y: 5 } })
      assert.equal(await inlineDisclosure.getAttribute('aria-expanded'), 'true', 'clicking text still toggles the question')
      await inline.locator('..').getByRole('button', { name: '이 질문 복사', exact: true }).click()
      assert.equal(await page.evaluate('window.copied'), '앞중간뒤 [[docs:guide.md]]', 'question copy keeps mentions and hides upload paths')
      await inline.getByRole('button', { name: '사진 #1%.png 사진 미리보기', exact: true }).first().click()
      const inlinePreview = page.getByRole('dialog', { name: '사진 #1%.png 사진 미리보기', exact: true })
      const inlineUrl = new URL((await inlinePreview.locator('img').getAttribute('src'))!, page.url())
      assert.equal(inlineUrl.searchParams.get('path'), inlinePhoto.path)
      await inlinePreview.press('Escape')
      assert.equal(await inlineDisclosure.getAttribute('aria-expanded'), 'true')
      await inline.scrollIntoViewIfNeeded()
      await inline.screenshot({ path: `/tmp/mew-agent-inline-bubble-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.evaluate(text => {
        const socket = (globalThis as any).socket
        socket.emit({ type: 'turn_start' })
        socket.emit({ type: 'turn_end', stopReason: 'end_turn' })
        socket.emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } } })
      }, photoRef)
      const photoOnly = page.locator('[data-agent-question-bubble]').filter({ has: page.getByRole('button', { name: '첨부 파일 1개', exact: true }) })
      await photoOnly.getByRole('button', { name: '사진 #1%.png 사진 미리보기', exact: true }).waitFor()
      assert.equal(await photoOnly.innerText(), '')
      assert.equal(await photoOnly.locator('[data-agent-attachment]').count(), 1, 'photo-only messages render their own bubble')
      await page.evaluate(text => {
        const socket = (globalThis as any).socket
        socket.emit({ type: 'turn_start' })
        socket.emit({ type: 'turn_end', stopReason: 'end_turn' })
        socket.emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } } })
      }, `첫 줄\n둘째 줄\n셋째 줄\n${photoRef}`)
      const longQuestion = page.locator('[data-agent-question-bubble]').filter({ has: page.getByRole('button', { name: /^첫 줄/ }) })
      const longDisclosure = longQuestion.locator('button[aria-expanded]')
      await longDisclosure.waitFor()
      await longDisclosure.focus()
      await longDisclosure.press('Tab')
      const focusedPhoto = longQuestion.getByRole('button', { name: '사진 #1%.png 사진 미리보기', exact: true })
      assert.equal(await focusedPhoto.evaluate(el => el.ownerDocument.activeElement === el), true)
      assert.equal(await longDisclosure.getAttribute('aria-expanded'), 'true', 'keyboard focus reveals attachments clipped by the collapsed question')
      assert.ok(await focusedPhoto.evaluate(el => el.getBoundingClientRect().bottom <= el.closest('[data-agent-question-bubble]')!.getBoundingClientRect().bottom))
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
