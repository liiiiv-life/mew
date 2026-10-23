import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

async function composerValue(input: Locator): Promise<string> {
  if (await input.locator('.cm-placeholder').count()) return ''
  return (await input.locator('.cm-line').allTextContents()).join('\n')
}

test('agent loading and clear feedback cover connection, history and startup queues, preserve drafts and respect reduced motion', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {AgentPanel} from '${root}/src/components/AgentPanel.tsx';
import {DockWorkspace} from '${root}/src/components/DockWorkspace.tsx';
import {writeAgentEventCache} from '${root}/src/utils/agentEventCache.ts';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {onMewcatNotice,setNotificationPreferences} from '${root}/src/utils/mewcat-notifications.ts';
import {useMewcatNotifications} from '${root}/src/hooks/use-mewcat-notifications.ts';
window.setNoticePreferences=setNotificationPreferences;
localStorage.setItem('mew:locale','ko');window.messages=[];window.clearTabs=[];window.notices=[];window.sockets={};window.fail=false;window.outsideClicks=0;
const fresh=new URLSearchParams(location.search).has('fresh');
const tabs=(fresh?['fresh']:['first','second']).map(id=>({id,label:id,renamed:true,runtime:'codex',cwd:'/workspace'}));
localStorage.setItem('mew:agent-tabs:'+JSON.stringify('/workspace'),JSON.stringify(tabs));
localStorage.setItem('mew:agent-active-tab:'+JSON.stringify('/workspace'),tabs[0].id);
if(!fresh)writeAgentEventCache('codex','first','/workspace',{sessionId:'first',events:[{type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Cached text must not flash'}}}]});
onMewcatNotice(notice=>window.notices.push(notice));
class Socket {
 static OPEN=1;readyState=0;
 constructor(url){this.tab=new URL(url).searchParams.get('tab');window.sockets[this.tab]=this;if(window.fail)setTimeout(()=>this.close(),20)}
 emit(value){this.onmessage?.({data:JSON.stringify(value)})}
 open(restore=true){this.readyState=1;this.onopen?.();if(!restore)return;this.emit({type:'replay',restored:true,events:[{type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Saved conversation'}}}]});this.emit({type:'meta',meta:{sessionId:this.tab,startedAt:new Date().toISOString(),turns:1,busy:false,queued:[],usage:null,canLoad:true,canList:true}})}
 send(raw){if(this.readyState!==1)throw new Error('sent while disconnected');const message=JSON.parse(raw);window.messages.push(message);if(message.type==='clear_session'){window.clearTabs.push(this.tab);window.clearFeedbackAtSend=document.querySelector('[data-agent-session]:not([hidden]) [data-agent-clear-feedback]')?.dataset.agentClearFeedback;if(!window.holdClear){this.clearCount=(this.clearCount||0)+1;this.emit({type:'meta',meta:{sessionId:this.tab,busy:true,queued:Array(this.clearCount).fill('/clear'),queuedKinds:Array(this.clearCount).fill('clear'),canLoad:true,canList:true}})}}}
 close(){this.readyState=3;this.onclose?.()}
}
window.WebSocket=Socket;
function Fixture(){
 useMewcatNotifications(false,'connection-owner');
 const [noticeTab,setNoticeTab]=React.useState();
 React.useEffect(()=>{const open=event=>setNoticeTab(event.detail.target.tabId);window.addEventListener('mew:open-notification',open);return()=>window.removeEventListener('mew:open-notification',open)},[]);
 const [layout,setLayout]=React.useState({version:1,groups:[{id:'agent:restored',kind:'agent'}],tabs:Object.fromEntries(tabs.map(tab=>['agent:'+tab.id,'agent:restored'])),active:{'agent:restored':tabs[0].id},tree:{id:'agent:restored'}});
 const panel=<AgentPanel requestedNoticeTab={noticeTab} onNoticeHandled={()=>setNoticeTab(undefined)} project="test" workspacePath="/workspace" tree={[]} focusedFilePath={null} onOpenFile={()=>{}} onClose={()=>{}} />;
 return <><button id="outside" onClick={()=>window.outsideClicks++}>Outside panel</button><button id="fullscreen" onClick={()=>document.documentElement.requestFullscreen()}>Fullscreen</button><div style={{height:'calc(100% - 40px)',position:'relative',display:'flex'}}>{matchMedia('(min-width:768px)').matches?<DockWorkspace value={layout} onChange={setLayout} foreground="agent" apiRef={null} onEditorDrop={()=>'main'}>{panel}</DockWorkspace>:panel}</div></>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
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
    for (const width of [1100, 390]) for (const dark of [true, false]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } })
      page.setDefaultTimeout(4000)
      await page.addInitScript(`(() => {
        const open = indexedDB.open.bind(indexedDB);
        window.historyDatabaseOpens = 0;
        indexedDB.open = (name, ...args) => {
          if (name === 'mew-agent-history') window.historyDatabaseOpens++;
          return open(name, ...args);
        };
      })()`)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let fresh = false
      let releaseTabs!: () => void
      const tabsReady = new Promise<void>(resolve => { releaseTabs = resolve })
      await page.route('http://mew-connection.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: chunk.code })
        if (pathname === '/api/upload-into') return route.fulfill({ json: { relPath: '.mew/assets/startup.png' } })
        if (pathname === '/api/user-ui/agent-tabs') await tabsReady
        if (pathname === '/api/user-ui/agent-tabs') return route.fulfill({ json: { state: { tabs: (fresh ? ['fresh'] : ['first', 'second']).map(id => ({ id, label: id, renamed: true, runtime: 'codex', cwd: '/workspace', ...(!fresh ? { sessionIds: { [JSON.stringify(['codex', '/workspace'])]: id } } : {}) })), activeId: fresh ? 'fresh' : 'first' }, claims: [] } })
        if (pathname === '/api/agent-cwd') return route.fulfill({ json: { cwd: '/workspace' } })
        if (pathname === '/api/projects') return route.fulfill({ json: [] })
        if (pathname.startsWith('/api/')) return route.fulfill({ json: { settings: null, skills: [], jobs: [], commands: [], runtimes: [] } })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="${dark ? 'dark' : ''}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-connection.test/')
      await page.locator('[data-agent-restoring]:visible .agent-loading-bubbles').waitFor()
      assert.equal(await page.getByText('Cached text must not flash', { exact: true }).count(), 0)
      assert.deepEqual(await page.evaluate('Object.keys(window.sockets)'), [], 'no connection before the server tab ledger resolves')
      releaseTabs()
      const overlay = page.locator('[data-agent-loading]:visible')
      await overlay.waitFor().catch(error => { throw new Error(`${error.message}\n${JSON.stringify(errors)}`) })
      assert.equal(await overlay.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'loading overlay lets the panel background show through')
      assert.equal(await overlay.getByRole('status').getAttribute('aria-label'), '연결 중…')
      assert.equal(await overlay.locator('.agent-loading-bubbles__bubble').count(), 4)
      assert.equal(await overlay.locator('.animate-spin').count(), 0)
      assert.equal(await page.getByText('Cached text must not flash', { exact: true }).isVisible(), false)
      // The restored dock group has no input focus yet. Its visible loading must still move.
      const motion = await overlay.locator('.agent-loading-bubbles__bubble').first().evaluate(async element => {
        const view = element.ownerDocument.defaultView!
        const animation = element.getAnimations({ subtree: true })[0]
        const before = Number(animation.currentTime)
        const x = () => view.getComputedStyle(element, '::after').transform
        const initial = x()
        await new Promise<void>(resolve => view.setTimeout(resolve, 150))
        const advanced = Number(animation.currentTime) > before
        const moved = x() !== initial
        const sample = async (time: number) => {
          animation.currentTime = time
          await new Promise<void>(resolve => view.requestAnimationFrame(() => resolve()))
          return Number(x().split(',')[4])
        }
        const outwardStart = await sample(280), outwardEnd = await sample(1120)
        const returnStart = await sample(1680), returnEnd = await sample(2520)
        return { advanced, moved, outward: outwardEnd > outwardStart, returning: returnEnd < returnStart, state: animation.playState }
      })
      assert.deepEqual(motion, { advanced: true, moved: true, outward: true, returning: true, state: 'running' })
      // Check painted pixels, not just CSS coordinates: the band must stay visible and cross the bubble.
      const shimmer = overlay.locator('.agent-loading-bubbles__bubble').first()
      const paintedBand = async (time: number) => {
        await shimmer.evaluate((element, time) => {
          const animation = element.getAnimations({ subtree: true })[0]
          animation.pause()
          animation.currentTime = time
        }, time)
        const png = await shimmer.screenshot({ path: `/tmp/mew-shimmer-${width}-${dark ? 'dark' : 'light'}-${time}.png` })
        return page.evaluate<{ left: number; right: number; base: number; profiles: number[][] }>(`(async () => {
          const img = new Image(); img.src = 'data:image/png;base64,${png.toString('base64')}'; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          const sample = fraction => ctx.getImageData(Math.floor(img.width * fraction), Math.floor(img.height / 2), 1, 1).data[0];
          return { left: sample(.2), right: sample(.8), base: sample(.9),
            profiles: [.15, .5, .85].map(y => [.3, .4, .5, .6, .7].map(x =>
              ctx.getImageData(Math.floor(img.width * x), Math.floor(img.height * y), 1, 1).data[0])) };
        })()`)
      }
      const left = await paintedBand(0), right = await paintedBand(1400), returned = await paintedBand(2800)
      const polarity = dark ? 1 : -1
      assert.ok((left.left - left.right) * polarity >= 25, 'left band visibly contrasts with its surface')
      assert.ok((right.right - right.left) * polarity >= 25, 'right band visibly contrasts with its surface')
      assert.ok((returned.left - returned.right) * polarity >= 25, 'painted band returns to the left')
      const centered = await paintedBand(700)
      for (const row of centered.profiles) {
        const peak = (row[2] - centered.base) * polarity
        const expected = [0, .5, 1, .5, 0]
        row.forEach((pixel, index) => assert.ok(Math.abs((pixel - centered.base) * polarity / peak - expected[index]) < .07,
          'the painted gradient fades continuously through 0/50/100/50/0 at every height'))
      }
      await shimmer.evaluate(element => element.getAnimations({ subtree: true })[0].play())
      const session = page.locator('[data-agent-session]:visible')
      const draft = session.locator('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
      const send = session.getByRole('button', { name: '전송', exact: true })
      await draft.fill('Draft before first connection')
      assert.equal(await send.isDisabled(), true)
      await page.evaluate('window.sockets.first.open(false)')
      assert.equal(await overlay.isVisible(), true, 'socket open still waits for the conversation')
      await page.evaluate('window.sockets.first.open()')
      await overlay.waitFor({ state: 'hidden' })
      assert.equal(await composerValue(draft), 'Draft before first connection')
      await draft.fill('Keep this unsent draft')
      await session.getByText('Saved conversation', { exact: true }).waitFor()
      const clearCount = () => page.evaluate<number>('window.messages.filter(message=>message.type==="clear_session").length')
      const beforeClear = await clearCount()
      await draft.press('Control+r')
      await draft.press('Meta+r')
      assert.equal(await clearCount(), beforeClear + 2, 'both platform shortcuts clear the focused conversation')
      assert.equal(await composerValue(draft), 'Keep this unsent draft')
      const dispatchRefresh = (selector: string, options: Record<string, unknown>) => page.locator(selector).evaluate((element, options) => {
        const event = new element.ownerDocument.defaultView!.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'r', code: 'KeyR', ctrlKey: true, ...options })
        element.dispatchEvent(event)
        return event.defaultPrevented
      }, options)
      assert.equal(await dispatchRefresh('[data-agent-session]:visible [contenteditable="true"]', { repeat: true }), true)
      assert.equal(await clearCount(), beforeClear + 2, 'holding refresh does not enqueue repeated clears')
      for (const options of [{ shiftKey: true }, { altKey: true }, { isComposing: true }]) {
        assert.equal(await dispatchRefresh('[data-agent-session]:visible [contenteditable="true"]', options), false)
      }
      assert.equal(await dispatchRefresh('#outside', {}), false, 'refresh outside the conversation keeps its default behavior')
      assert.equal(await clearCount(), beforeClear + 2)
      const tabBar = page.locator('[data-agent-tab-bar]:visible')
      await tabBar.focus()
      await page.keyboard.press('Control+r')
      assert.equal(await clearCount(), beforeClear + 3, 'tab bar refresh clears its selected conversation')
      await page.locator('#fullscreen').click()
      await page.waitForFunction('!!document.fullscreenElement')
      await tabBar.focus()
      await page.keyboard.press('Meta+r')
      assert.equal(await clearCount(), beforeClear + 4, 'fullscreen tab bar refresh stays in the app')
      await page.keyboard.press('Control+r')
      assert.equal(await clearCount(), beforeClear + 5, 'fullscreen Control refresh stays in the app')
      await session.click({ position: { x: 2, y: 2 } })
      await page.evaluate('document.activeElement.blur()')
      assert.equal(await dispatchRefresh('body', {}), true, 'a panel click remains the target after DOM focus moves to body')
      await page.keyboard.press('Control+r')
      assert.equal(await clearCount(), beforeClear + 7)
      assert.deepEqual(await page.evaluate('window.clearTabs'), Array(7).fill('first'), 'background conversations receive no clear request')
      assert.equal(await composerValue(draft), 'Keep this unsent draft')
      const clearFeedback = session.locator('[data-agent-clear-feedback]')
      assert.equal(await page.evaluate('window.clearFeedbackAtSend'), 'clearing', 'feedback DOM exists before sending any clear request')
      await page.evaluate('window.holdClear=true')
      await session.getByRole('button', { name: '대화 비우기', exact: true }).click()
      assert.equal(await clearFeedback.getAttribute('data-agent-clear-feedback'), 'clearing')
      assert.equal(await clearFeedback.innerText(), '대화 비우는 중…')
      assert.equal(await session.getByRole('button', { name: '대화 비우기', exact: true }).isDisabled(), true)
      await page.evaluate("window.sockets.first.emit({type:'meta',meta:{sessionId:'first',busy:true,queued:Array(7).fill('/clear'),queuedKinds:Array(7).fill('clear')}})")
      assert.equal(await clearFeedback.getAttribute('data-agent-clear-feedback'), 'clearing', 'an unrelated meta update cannot acknowledge clear')
      await draft.press('Control+r')
      assert.equal(await clearCount(), beforeClear + 8, 'an unacknowledged request cannot be sent twice')
      assert.equal(await composerValue(draft), 'Keep this unsent draft')
      await page.screenshot({ path: `/tmp/mew-clear-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await clearFeedback.locator('span[aria-hidden]').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).animationName), 'none')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.evaluate("window.sockets.first.emit({type:'meta',meta:{sessionId:'first',busy:true,queued:Array(8).fill('/clear'),queuedKinds:Array(8).fill('clear')}})")
      await clearFeedback.filter({ hasText: '/clear를 대기열에 추가했습니다' }).waitFor()
      await clearFeedback.waitFor({ state: 'hidden' })
      await draft.fill('/clear')
      await send.click()
      assert.equal(await clearCount(), beforeClear + 9, '/clear uses the same feedback path')
      assert.equal(await composerValue(draft), '')
      await page.evaluate("window.sockets.first.emit({type:'reset'});window.sockets.first.open()")
      await clearFeedback.filter({ hasText: '대화를 비웠습니다' }).waitFor()
      await clearFeedback.waitFor({ state: 'hidden' })
      await session.getByRole('button', { name: '대화 비우기', exact: true }).click()
      await clearFeedback.filter({ hasText: '대화 비우는 중…' }).waitFor()
      await page.evaluate("window.sockets.first.emit({type:'error',message:'Clear failed'})")
      await clearFeedback.waitFor({ state: 'hidden' })
      await page.evaluate('window.holdClear=false;window.sockets.first.open()')
      await draft.fill('Keep this unsent draft')
      await page.evaluate('document.exitFullscreen()')
      await page.waitForFunction('!document.fullscreenElement')
      await page.locator('[role="tab"]', { hasText: 'second' }).click()
      // Approval events change both indicators without a new busy/meta snapshot.
      await page.evaluate(`window.sockets.first.emit({type:'meta',meta:{sessionId:'first',startedAt:new Date().toISOString(),turns:1,busy:true,queued:[],usage:null,canLoad:true,canList:true}});
        window.sockets.first.emit({type:'permission',id:'approval-one',toolCall:{title:'Run approved command'},options:[{optionId:'allow-once',name:'이번 작업 허용',kind:'allow_once'},{optionId:'deny',name:'거절',kind:'reject_once'}]});
        window.sockets.first.emit({type:'permission',id:'approval-two',toolCall:{title:'Run another command'},options:[]})`)
      const approvalTab = page.locator('[role="tab"]', { hasText: 'first' })
      const approvalHeader = session.locator('[data-agent-turn-header]').last()
      const assertApprovalDot = async (scope: Locator) => {
        const dot = scope.locator('span[aria-label="승인 대기"]')
        await dot.waitFor()
        assert.ok((await dot.getAttribute('class'))?.includes('bg-orange-500'))
        assert.equal(await dot.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).animationName), 'none')
      }
      await assertApprovalDot(approvalTab)
      assert.equal(await approvalTab.getAttribute('aria-selected'), 'true', 'new approval automatically selects its tab')
      await assertApprovalDot(approvalHeader)
      await page.locator('[role="tab"]', { hasText: 'second' }).click()
      await assertApprovalDot(approvalTab)
      await approvalTab.click()
      assert.equal(await approvalHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'true', 'new approval requests reveal their action buttons')
      await assertApprovalDot(approvalHeader)
      await page.screenshot({ path: `/tmp/mew-approval-${width}-${dark ? 'dark' : 'light'}.png` })
      await session.getByRole('button', { name: '이번 작업 허용', exact: true }).click()
      assert.deepEqual(await page.evaluate('window.messages.at(-1)'), { type: 'permission', id: 'approval-one', optionId: 'allow-once' })
      await approvalHeader.locator('button[aria-expanded]').click()
      await page.evaluate("window.sockets.first.emit({type:'update',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Still waiting for approval'}}})")
      await page.waitForTimeout(50)
      assert.equal(await approvalHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'false', 'streaming does not reopen the same pending request')
      await page.evaluate("window.sockets.first.emit({type:'permission',id:'approval-three',toolCall:{title:'New approval'},options:[]})")
      await session.getByText('New approval', { exact: true }).waitFor()
      assert.equal(await approvalHeader.locator('button[aria-expanded]').getAttribute('aria-expanded'), 'true', 'a new request reveals its actions again')
      await page.evaluate("window.sockets.first.emit({type:'permission_done',id:'approval-one'})")
      await assertApprovalDot(approvalTab)
      await page.evaluate("window.sockets.first.emit({type:'permission_done',id:'approval-three'});window.sockets.first.emit({type:'permission_done',id:'approval-two'})")
      await approvalTab.locator('span[aria-label="작업 중"]').waitFor()
      await approvalHeader.locator('span[aria-label="작업 중"]').waitFor()
      assert.ok((await approvalTab.locator('span[aria-label="작업 중"]').getAttribute('class'))?.includes('animate-pulse'))
      await page.evaluate("window.setNoticePreferences({autoOpenApproval:false})")
      const otherTab = page.locator('[role="tab"]', { hasText: 'second' })
      await otherTab.click()
      await page.evaluate("window.sockets.first.emit({type:'permission',id:'manual-approval',toolCall:{title:'Manual approval'},options:[]})")
      await assertApprovalDot(approvalTab)
      assert.equal(await otherTab.getAttribute('aria-selected'), 'true', 'disabled automatic switching preserves the current tab')
      await approvalTab.click()
      await page.evaluate('window.setNoticePreferences({autoOpenApproval:true});window.sockets.first.open();window.notices=[]')
      await page.evaluate('window.holdClear=true')
      await draft.press('Control+r')
      await clearFeedback.filter({ hasText: '대화 비우는 중…' }).waitFor()
      await page.clock.install()
      await page.clock.pauseAt(new Date(Date.now() + 1000))
      await page.evaluate('window.fail=true;window.sockets.first.close()')
      await overlay.waitFor()
      await clearFeedback.waitFor({ state: 'hidden' })
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
      assert.equal(await overlay.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'loading stays transparent after resizing the composer')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await overlay.locator('.agent-loading-bubbles__bubble').first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element, '::after').animationName), 'agent-bubble-breathe')
      const reduced = await shimmer.evaluate(element => {
        const view = element.ownerDocument.defaultView!
        const animation = element.getAnimations({ subtree: true })[0]
        animation.pause(); animation.currentTime = 0
        const from = view.getComputedStyle(element, '::after')
        const position = from.transform, opacity = Number(from.opacity)
        animation.currentTime = 2000
        const to = view.getComputedStyle(element, '::after')
        const result = { stationary: to.transform === position, brightnessChanged: Number(to.opacity) - opacity > .4 }
        animation.play()
        return result
      })
      assert.deepEqual(reduced, { stationary: true, brightnessChanged: true })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      assert.equal(await overlay.locator('.agent-loading-bubbles__bubble').first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element, '::after').animationName), 'agent-bubble-shimmer')
      assert.equal(await session.locator('[inert]').count(), 2)
      assert.equal(await draft.evaluate(element => element.closest('[inert]') === null), true)
      assert.equal(await send.isDisabled(), true)
      assert.equal(await session.getByRole('button', { name: '파일 첨부', exact: true }).isEnabled(), true)
      await draft.fill('Edited while connecting')
      const sentBefore = await page.evaluate('window.messages.length')
      await draft.press('Control+r')
      assert.equal(await page.evaluate('window.messages.length'), sentBefore, 'disconnected refresh does not send a clear')
      await draft.press('Control+Enter')
      assert.equal(await page.evaluate('window.messages.length'), sentBefore)
      assert.equal(await composerValue(draft), 'Edited while connecting')
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
      assert.equal(await composerValue(draft), 'Edited while connecting')
      assert.equal(await session.locator('[inert]').count(), 0)
      assert.equal(await send.isEnabled(), true)
      await send.click()
      assert.equal(await page.evaluate('window.messages.at(-1).text'), 'Edited while connecting')
      assert.equal(await composerValue(draft), '')
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
        assert.equal(await composerValue(draft), 'Draft while loading history')
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
      assert.equal(await composerValue(draft), 'Draft while loading history')
      await draft.fill('Typing after recovery')
      await page.evaluate("window.sockets.first.emit({type:'error',message:'Actual agent failure'})")
      assert.equal(await page.evaluate('window.notices.at(-1).kind'), 'error', 'actual agent errors still notify')
      await page.clock.resume()
      // New conversation clears immediately even when list/close/ready never reply.
      await page.evaluate("window.sockets.first.emit({type:'update',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Old conversation to clear'}}})")
      await session.getByText('Old conversation to clear', { exact: true }).waitFor()
      await session.getByRole('button', { name: '히스토리', exact: true }).click()
      await session.getByRole('button', { name: '새 대화', exact: true }).click()
      assert.equal(await session.getByText('Old conversation to clear', { exact: true }).count(), 0)
      assert.equal(await session.locator('[data-agent-loading]').count(), 0)
      assert.equal(await page.evaluate('window.messages.at(-1).type'), 'close_session')
      await page.evaluate('window.sockets.first.close()')
      assert.equal(await session.locator('[data-agent-loading]').count(), 0, 'reconnect must not cover the cleared UI')
      assert.equal(await send.isEnabled(), true, 'a newly cleared conversation can accept a prompt while its runtime reconnects')
      assert.equal(await composerValue(draft), 'Typing after recovery')
      // A fresh tab prepares the runtime without loading a saved conversation or its cache.
      fresh = true
      await page.goto('http://mew-connection.test/?fresh')
      await page.waitForFunction('!!window.sockets.fresh')
      const freshSession = page.locator('[data-agent-session]:visible')
      const freshDraft = freshSession.locator('[contenteditable="true"][aria-placeholder="텍스트 입력"]')
      const freshSend = freshSession.getByRole('button', { name: '전송', exact: true })
      await freshSession.getByText('채팅을 시작하세요', { exact: true }).waitFor()
      assert.equal(await freshSession.locator('[data-agent-loading]').count(), 0, 'a new tab has no conversation skeleton before the socket opens')
      assert.equal(await freshSession.locator('[data-agent-conversation]').getAttribute('aria-busy'), 'false')
      assert.equal(await page.evaluate('window.historyDatabaseOpens'), 0, 'a new tab skips saved conversation and queue cache reads')
      await freshDraft.fill('First question while the runtime starts')
      assert.equal(await composerValue(freshDraft), 'First question while the runtime starts')
      assert.equal(await freshSend.isEnabled(), true, 'a new tab accepts a prompt before its socket opens')
      await freshDraft.press('Control+Enter')
      const startupQueue = freshSession.locator('[data-agent-startup-queue]')
      const startupRows = startupQueue.locator('[data-startup-prompt]')
      await startupQueue.getByText('First question while the runtime starts', { exact: true }).waitFor()
      assert.equal(await freshSession.getByText('채팅을 시작하세요', { exact: true }).count(), 0, 'accepted startup work replaces the empty conversation hint')
      assert.equal(await composerValue(freshDraft), '', 'accepted startup prompts leave the composer immediately')
      assert.deepEqual(await page.evaluate('window.messages'), [])
      await freshDraft.fill('Cancel before startup')
      await freshSend.click()
      await startupRows.filter({ hasText: 'Cancel before startup' }).getByRole('button', { name: '대기 메시지 취소', exact: true }).click()
      assert.equal(await startupRows.count(), 1, 'cancelling an unsent startup prompt removes only that item')
      await page.locator('[data-agent-tab-bar]:visible').getByRole('button', { name: '탭 닫기', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      await page.getByRole('button', { name: '취소', exact: true }).click()
      assert.equal(await startupRows.count(), 1, 'closing a tab with accepted startup work asks before discarding it')
      await page.evaluate('window.sockets.fresh.open(false)')
      assert.equal(await freshSession.locator('[data-agent-loading]').count(), 0, 'runtime initialization never covers a new conversation')
      assert.equal(await freshSession.locator('[data-agent-conversation]').getAttribute('aria-busy'), 'false')
      await page.evaluate("window.sockets.fresh.emit({type:'ready',cwd:'/workspace'});window.sockets.fresh.emit({type:'meta',meta:{sessionId:'',busy:false,queued:[]}})")
      assert.deepEqual(await page.evaluate('window.messages.filter(message=>message.type==="prompt")'), [], 'socket open, ready and an empty session ID do not drain startup prompts')
      await page.evaluate(`window.sockets.fresh.emit({type:'models',models:{currentModelId:'alpha[high]',availableModels:[{modelId:'alpha[high]',name:'Alpha'},{modelId:'beta[low]',name:'Beta'}]}});
        window.sockets.fresh.emit({type:'thinking',thinking:{configId:'effort',currentValue:'high',options:[{id:'high',name:'High'},{id:'low',name:'Low'}]}});
        window.sockets.fresh.emit({type:'modes',modes:{currentModeId:'default',availableModes:[{id:'default',name:'Default'},{id:'bypassPermissions',name:'Bypass'}]}})`)
      await freshDraft.fill('Second question with an attachment')
      const attachmentPicker = page.waitForEvent('filechooser')
      await freshSession.getByRole('button', { name: '파일 첨부', exact: true }).click()
      const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
      await (await attachmentPicker).setFiles({ name: 'startup.png', mimeType: 'image/png', buffer: image })
      await freshSession.getByRole('button', { name: 'png 첨부 제거', exact: true }).waitFor()
      await freshSend.click()
      assert.equal(await composerValue(freshDraft), '')
      assert.equal(await startupRows.count(), 2)
      await page.evaluate(`window.sockets.fresh.emit({type:'models',models:{currentModelId:'beta[low]',availableModels:[{modelId:'alpha[high]',name:'Alpha'},{modelId:'beta[low]',name:'Beta'}]}});
        window.sockets.fresh.emit({type:'thinking',thinking:{configId:'effort',currentValue:'low',options:[{id:'high',name:'High'},{id:'low',name:'Low'}]}});
        window.sockets.fresh.emit({type:'modes',modes:{currentModeId:'bypassPermissions',availableModes:[{id:'default',name:'Default'},{id:'bypassPermissions',name:'Bypass'}]}})`)
      await page.screenshot({ path: `/tmp/mew-agent-startup-queue-${width}-${dark ? 'dark' : 'light'}.png` })
      const queueBounds = (await startupQueue.boundingBox())!
      assert.ok(queueBounds.x >= 0 && queueBounds.x + queueBounds.width <= width, 'startup queue stays within desktop and mobile viewports')
      await page.evaluate('window.previousFreshSocket=window.sockets.fresh;window.sockets.fresh.close()')
      assert.equal(await startupRows.count(), 2, 'unsubmitted startup prompts survive a connection close')
      await page.waitForFunction('window.sockets.fresh!==window.previousFreshSocket')
      await page.evaluate('window.sockets.fresh.open(false)')
      assert.deepEqual(await page.evaluate('window.messages.filter(message=>message.type==="prompt")'), [], 'reopening a socket still waits for initialization')
      await page.evaluate("window.sockets.fresh.emit({type:'error',message:'Fresh runtime startup failed'})")
      await freshSession.getByText('Fresh runtime startup failed', { exact: true }).waitFor()
      assert.equal(await freshSession.locator('[data-agent-loading]').count(), 0, 'startup errors remain visible')
      assert.equal(await startupRows.count(), 2, 'initialization errors do not discard accepted prompts')
      await page.evaluate("window.sockets.fresh.emit({type:'auth',methods:[{id:'login',name:'Fresh runtime login',kind:'agent'}],authenticating:false,error:null})")
      await freshSession.getByRole('button', { name: 'Fresh runtime login', exact: false }).waitFor()
      assert.equal(await freshSession.locator('[data-agent-loading]').count(), 0, 'the login panel remains visible during startup')
      assert.equal(await startupRows.count(), 2, 'authentication preserves startup prompts')
      await page.evaluate("window.sockets.fresh.emit({type:'meta',meta:{sessionId:'stale-before-auth',busy:false,queued:[]}})")
      assert.deepEqual(await page.evaluate('window.messages.filter(message=>message.type==="prompt")'), [], 'a late meta snapshot cannot bypass required authentication')
      await page.evaluate("window.sockets.fresh.emit({type:'auth_complete'})")
      await freshSession.getByRole('button', { name: 'Fresh runtime login', exact: false }).waitFor({ state: 'hidden' })
      assert.deepEqual(await page.evaluate('window.messages.filter(message=>message.type==="prompt")'), [], 'authentication completion alone does not confirm a prepared session')
      await page.evaluate("window.sockets.fresh.emit({type:'meta',meta:{sessionId:'fresh-ready',startedAt:new Date().toISOString(),turns:0,busy:false,queued:[],usage:null,canLoad:true,canList:true}})")
      await startupQueue.waitFor({ state: 'hidden' })
      const submitted = await page.evaluate<Array<{ text: string; displayText: string; images: Array<{ data: string; mimeType: string }>; imageRefs: unknown[]; attachments: unknown[]; settings: Record<string, unknown> }>>('window.messages.filter(message=>message.type==="prompt")')
      assert.equal(submitted.length, 2)
      assert.equal(submitted[0].text, 'First question while the runtime starts')
      assert.equal(submitted[0].settings.uiLocale, 'ko')
      assert.equal(submitted[0].settings.modelId, undefined, 'an unadvertised model keeps the server default instead of capturing a later draft selection')
      assert.equal(submitted[0].settings.thinkingId, undefined)
      assert.equal(submitted[0].settings.modeId, undefined)
      assert.match(submitted[1].text, /^Second question with an attachment\[\[\.workspace:\.mew\/assets\/startup\.png\]\]$/)
      assert.equal(submitted[1].displayText, submitted[1].text)
      assert.deepEqual(submitted[1].images, [{ data: image.toString('base64'), mimeType: 'image/png' }], 'startup submission keeps image bytes')
      assert.deepEqual(submitted[1].attachments, [{ project: '.workspace', path: '.mew/assets/startup.png', mimeType: 'image/png' }])
      assert.deepEqual(submitted[1].imageRefs, [{ path: '.mew/assets/startup.png', mimeType: 'image/png' }])
      assert.equal(submitted[1].settings.modelId, 'alpha[high]', 'later draft model changes do not rewrite the queued selection')
      assert.equal(submitted[1].settings.thinkingId, 'high')
      assert.equal(submitted[1].settings.thinkingConfigId, 'effort')
      assert.equal(submitted[1].settings.modeId, 'default')
      await page.evaluate("window.sockets.fresh.emit({type:'meta',meta:{sessionId:'fresh-ready',busy:true,queued:[],canLoad:true,canList:true}})")
      assert.equal(await page.evaluate('window.messages.filter(message=>message.type==="prompt").length'), 2, 'later meta snapshots do not submit accepted prompts again')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
