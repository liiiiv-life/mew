import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { sessionHistoryXlsx } from './session-history-xlsx.ts'
import { parseXlsx } from '../src/utils/xlsx.ts'
import type { MewSessionRecord } from '../shared/active-sessions.ts'

const root = path.resolve(import.meta.dirname, '..')

test('total session count and session popup stay live across mobile layout and reconnects', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const source = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {ActiveSessionsButton} from '${root}/src/components/active-sessions-button.tsx';
import {usePresence} from '${root}/src/hooks/usePresence.ts';
import {I18nProvider} from '${root}/src/i18n.tsx';
class Socket {static OPEN=1; readyState=1; sent=[]; constructor(){window.socket=this;setTimeout(()=>this.onopen?.(),0)} send(raw){this.sent.push(JSON.parse(raw))} close(){this.readyState=3;this.onclose?.()} receive(activeSessions){this.onmessage?.({data:JSON.stringify({type:'participants',participants:{'work:readme.md':['#abcdef']},activeSessions})})}}
window.WebSocket=Socket;localStorage.setItem('mew:locale','ko');
const nativeInterval=window.setInterval.bind(window);window.setInterval=(callback,delay,...args)=>{if(delay===30000)window.activityTick=callback;return nativeInterval(callback,delay,...args)};
const base={email:'saens@example.test',displayName:'Saens',browser:'Chrome',device:'Mac',connectedAt:1789522800000,workspaceLabel:'mew',project:'work',path:'src/components/active-sessions-button.tsx',visible:true,agents:{running:2,reportedAt:Date.now()}};
window.roster={selfId:'one',sessions:[{...base,id:'one'},{...base,id:'two',browser:'Safari',device:'iPhone',visible:false,path:null,agents:{running:0,reportedAt:Date.now()}},{...base,id:'three',email:'collaborator-with-a-long-address@example.test',displayName:'Collaborator',path:'docs/'+('very-long-file-name-'.repeat(8))+'.md',agents:null},{...base,id:'four',email:null,displayName:null,workspaceLabel:'Public docs',path:'welcome.md',agents:undefined}]};
window.avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=';
function Fixture(){const [profile,setProfile]=useState({email:'saens@example.test',displayName:'Saens',avatarDataUrl:window.avatar});window.setProfile=setProfile;const [running,setRunning]=useState(2);window.setRunning=setRunning;const [screen,setScreen]=useState({project:'work',file:'readme.md',label:'mew'});window.setScreen=setScreen;const {activeSessions}=usePresence(screen.project,screen.file,'saens@example.test',()=>{},undefined,screen.label,running);return <header className="flex h-10 items-center gap-1.5 px-3 md:h-12"><span className="min-w-0 flex-1 truncate">mew</span><ActiveSessionsButton presence={activeSessions} profile={profile}/><button aria-label="메뉴" className="h-8 w-8">☰</button></header>};
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:sessions.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:sessions.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:sessions.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/active-sessions-button.tsx', 'src/components/header-control.ts', 'src/components/session-history.tsx', 'packages/ui/src/dialog-frame.tsx', 'packages/ui/src/select-field.tsx', 'packages/ui/src/HoverTipLayer.tsx'].map(file => fs.readFile(`${root}/${file}`, 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, hasTouch: true })
    const historyRequests: URL[] = []
    let historyFails = false
    await context.route('http://mew-sessions.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/presence/history')) {
        historyRequests.push(url)
        if (historyFails) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
        const day = Number(url.searchParams.get('dayFrom')), from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'))
        const person = url.searchParams.get('person')
        const people = [{ email: 'saens@example.test', displayName: 'Saens' }, { email: 'colleague@example.test', displayName: 'Colleague' }]
        const records = (day < Date.now() - 86400_000 * 2 ? [] : [[9, 11, 0], [10, 12, 0], [14, 16, 1]]).map(([start, end, who], index) => ({
          id: String(index), recordId: index, ...people[who], connectedAt: day + start * 3600_000, startedAt: Math.max(from, day + start * 3600_000), endedAt: Math.min(to, day + end * 3600_000),
          disconnectedAt: day + end * 3600_000, browser: 'Chrome', device: index === 1 ? 'iPhone' : 'Mac', workspaceLabel: 'mew', project: '.workspace', path: 'src/components/active-sessions-button.tsx', visible: index !== 1, agents: null,
        })).filter(record => record.startedAt < record.endedAt && (!person || record.email === person)) satisfies MewSessionRecord[]
        if (url.pathname.endsWith('/export')) return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: sessionHistoryXlsx(records) })
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ records, people, recordedSince: Date.now(), generatedAt: Date.now() }) })
      }
      return route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://mew-sessions.test/')
    const trigger = page.locator('[data-active-sessions]')
    await trigger.waitFor()
    const count = trigger.locator('[data-active-sessions-count]')
    await count.getByText('1', { exact: true }).waitFor()
    assert.equal(await trigger.getAttribute('aria-label'), '활성 세션 1개', 'the current browser is counted while the roster connects')
    assert.equal(await trigger.locator('img, [data-profile-avatar], [data-other-people]').count(), 0)
    await page.waitForFunction('window.socket?.sent.length === 1')
    assert.deepEqual(await page.evaluate('window.socket.sent[0]'), { type: 'focus', path: 'work:readme.md', project: 'work', workspaceLabel: 'mew', color: await page.evaluate('window.socket.sent[0].color'), visible: true, runningAgents: 2 })
    await page.evaluate('window.setRunning(1)')
    await page.waitForFunction('window.socket.sent.at(-1).runningAgents === 1')
    await page.evaluate('window.activityTick()')
    assert.equal(await page.evaluate('window.socket.sent.at(-1).runningAgents'), 1)
    await page.evaluate('window.setRunning(0)')
    await page.waitForFunction('window.socket.sent.at(-1).runningAgents === 0')
    await page.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
    assert.equal(await page.evaluate('window.socket.sent.at(-1).runningAgents'), 0)
    await page.evaluate('window.socket.receive(window.roster)')
    await count.getByText('4', { exact: true }).waitFor()
    await page.evaluate('window.socket.receive({...window.roster,sessions:window.roster.sessions.slice(0,2)})')
    await count.getByText('2', { exact: true }).waitFor()
    assert.equal(await trigger.getAttribute('aria-label'), '활성 세션 2개', 'same-account devices each count as a session')
    await page.evaluate('window.socket.receive({...window.roster,sessions:[...window.roster.sessions.slice(0,3),{...window.roster.sessions[2],id:"duplicate",email:window.roster.sessions[2].email.toUpperCase()}]})')
    await count.getByText('4', { exact: true }).waitFor()
    await page.evaluate('window.socket.receive({...window.roster,sessions:[...window.roster.sessions,{...window.roster.sessions[2],id:"other-person",email:"someone-else@example.test"},{...window.roster.sessions[3],id:"other-guest"}]})')
    await count.getByText('6', { exact: true }).waitFor()
    await page.evaluate('window.setProfile({email:"saens@example.test",displayName:"Updated name",avatarDataUrl:null})')
    assert.equal(await trigger.getAttribute('aria-label'), '활성 세션 6개')
    await page.evaluate('window.setProfile({email:"saens@example.test",displayName:"Updated name",avatarDataUrl:"/broken-avatar.png"})')
    assert.equal(await trigger.locator('img').count(), 0, 'profile changes do not render an avatar')
    await page.evaluate('window.setProfile({email:null,displayName:null,avatarDataUrl:null})')
    assert.equal(await count.innerText(), '6')
    await page.evaluate('window.socket.receive({...window.roster,sessions:Array.from({length:105},(_,index)=>({...window.roster.sessions[0],id:String(index)}))})')
    await count.getByText('99+', { exact: true }).waitFor()
    assert.equal(await trigger.getAttribute('aria-label'), '활성 세션 105개')
    assert.equal(await trigger.getAttribute('data-tip'), '활성 세션 105개', 'the tooltip preserves the full count')
    await page.evaluate('window.setProfile({email:"saens@example.test",displayName:"Saens",avatarDataUrl:window.avatar});window.socket.receive(window.roster)')
    await count.getByText('4', { exact: true }).waitFor()
    for (const width of [390, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 })
      for (const fontSize of [14, 16, 20]) {
        await page.locator('html').evaluate((el, size) => { el.style.fontSize = `${size}px` }, fontSize)
        const buttonBox = (await trigger.boundingBox())!
        const iconBox = (await trigger.locator('[data-active-sessions-icon]').boundingBox())!
        const numberBox = (await count.boundingBox())!
        assert.equal(buttonBox.width, buttonBox.height, 'the session trigger uses a square header control')
        assert.equal(iconBox.width, 16)
        assert.equal(iconBox.height, 16)
        assert.ok(Math.abs(iconBox.y + iconBox.height / 2 - buttonBox.y - buttonBox.height / 2) < 0.1,
          `session icon stays vertically centered at ${width}px / ${fontSize}px font`)
        assert.ok(numberBox.x >= iconBox.x && numberBox.x + numberBox.width <= iconBox.x + iconBox.width,
          'the count remains inside the icon outline')
        assert.ok(numberBox.y >= iconBox.y && numberBox.y + numberBox.height <= iconBox.y + iconBox.height)
      }
    }
    await page.locator('html').evaluate(el => { el.style.removeProperty('font-size') })
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
      assert.equal(await dialog.getByText('작업 중 에이전트 2개', { exact: true }).count(), 1)
      assert.equal(await dialog.getByText('작업 중 에이전트 0개', { exact: true }).count(), 1)
      assert.equal(await dialog.getByText('작업 중 에이전트 —개', { exact: true }).count(), 2)
      assert.equal(await dialog.getByText(/JS 메모리/).count(), 0)
      const box = await dialog.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width)
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      const email = dialog.getByText('saens@example.test', { exact: true })
      assert.equal(await email.evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'text')
      assert.equal(await dialog.getByRole('heading', { name: 'Saens', exact: true }).evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).userSelect), 'none')
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('tab', { name: '지금 접속', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
      await page.screenshot({ path: `/tmp/mew-active-sessions-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await trigger.evaluate(el => el === el.ownerDocument.activeElement), true)
    }
    await trigger.click()
    await page.evaluate('window.socket.receive({...window.roster,sessions:window.roster.sessions.slice(0,2)})')
    await count.getByText('2', { exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog').locator('li').count(), 2)
    await page.evaluate('window.socket.receive({...window.roster,sessions:[]})')
    await count.getByText('0', { exact: true }).waitFor()
    assert.equal(await trigger.getAttribute('aria-label'), '활성 세션 0개')
    assert.equal(await page.getByRole('dialog').locator('li').count(), 0)
    await page.getByRole('dialog').getByText('접속 중인 세션이 없습니다.', { exact: true }).waitFor()
    await page.evaluate('window.socket.close()')
    await page.getByRole('status').getByText('접속 정보 연결 중…').waitFor()
    assert.equal(await page.getByRole('dialog').locator('li').count(), 0)
    assert.equal(await count.innerText(), '1')
    assert.equal(await trigger.getAttribute('aria-label'), '활성 세션 1개')
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
    await trigger.click()
    await page.getByRole('tab', { name: '기록', exact: true }).click()
    await page.getByText('3개 세션 · 2명 · 관측 6시간 0분', { exact: true }).waitFor()
    const timeline = page.getByRole('region', { name: '사람별 타임라인', exact: true })
    assert.equal(await timeline.getByRole('group').count(), 2)
    const saensTimeline = timeline.getByRole('group', { name: 'Saens', exact: true })
    const macInterval = saensTimeline.getByRole('img', { name: /Chrome · Mac/ })
    const phoneInterval = saensTimeline.getByRole('img', { name: /Chrome · iPhone/ })
    assert.equal(await saensTimeline.getByRole('img').count(), 2)
    for (const [width, dark] of [[1200, false], [320, false], [1200, true], [390, true]] as const) {
      await page.setViewportSize({ width, height: 800 })
      await page.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`)
      const dialog = page.getByRole('dialog')
      const box = await dialog.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width)
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      const macBox = await macInterval.boundingBox(), phoneBox = await phoneInterval.boundingBox()
      assert.ok(macBox && phoneBox)
      assert.equal(macBox.y, phoneBox.y)
      assert.equal(macBox.height, phoneBox.height)
      // Foreground remains reachable where two sessions overlap.
      await page.mouse.move(macBox.x + macBox.width * 0.75, macBox.y + macBox.height / 2)
      const tip = page.getByRole('tooltip')
      await tip.waitFor()
      assert.match(await tip.innerText(), /Saens · 09:00–11:00/)
      assert.match(await tip.innerText(), /Chrome · Mac/)
      assert.match(await tip.innerText(), /화면 활성/)
      assert.match(await tip.innerText(), /mew · src\/components\/active-sessions-button.tsx/)
      assert.match(await tip.innerText(), /작업 중 에이전트 —개/)
      assert.equal(await tip.evaluate(el => Boolean(el.closest('[role="dialog"]'))), true)
      const tipBox = await tip.boundingBox()
      assert.ok(tipBox && tipBox.x >= 0 && tipBox.x + tipBox.width <= width, JSON.stringify({ width, tipBox }))
      await page.screenshot({ path: `/tmp/mew-session-history-hover-${width}-${dark ? 'dark' : 'light'}.png` })
      await page.mouse.move(phoneBox.x + phoneBox.width * 0.75, phoneBox.y + phoneBox.height / 2)
      await page.getByRole('tooltip').getByText(/Chrome · iPhone/).waitFor()
      assert.match(await page.getByRole('tooltip').innerText(), /백그라운드/)
      await page.mouse.move(2, 2)
      await tip.waitFor({ state: 'detached' })
      await page.screenshot({ path: `/tmp/mew-session-history-${width}-${dark ? 'dark' : 'light'}.png` })
    }
    const person = page.getByRole('combobox', { name: '사람', exact: true })
    await person.click()
    await page.getByRole('option', { name: 'Colleague · colleague@example.test', exact: true }).click()
    await page.getByText('1개 세션 · 1명 · 관측 2시간 0분', { exact: true }).waitFor()
    assert.equal(historyRequests.at(-1)!.searchParams.get('person'), 'colleague@example.test')
    // Escape first closes the custom person dropdown, then the containing dialog.
    await person.click(); await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('listbox').count(), 0)
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.getByRole('button', { name: '14:00 · 1개 세션', exact: true }).click()
    await page.getByText('1개 세션 · 1명 · 관측 1시간 0분', { exact: true }).waitFor()
    const latest = historyRequests.at(-1)!
    assert.equal(Number(latest.searchParams.get('to')) - Number(latest.searchParams.get('from')), 3600_000)
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: '엑셀 다운로드', exact: true }).click()
    const download = await downloadEvent
    const downloadPath = await download.path()
    assert.ok(downloadPath)
    const bytes = await fs.readFile(downloadPath)
    const [sheet] = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    assert.equal(sheet.rows.length, 2)
    assert.equal(sheet.rows[1][1], 'colleague@example.test')
    assert.equal(sheet.rows[1][7], '60')
    assert.equal(historyRequests.at(-1)!.search, latest.search)
    await page.getByText('상세 기록 1개', { exact: true }).click()
    assert.equal(await page.getByRole('tabpanel').locator('li').count(), 1)
    await page.getByLabel('날짜', { exact: true }).fill('2020-01-01')
    await page.getByText('이 범위에 세션 기록이 없습니다.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '엑셀 다운로드', exact: true }).isDisabled(), true)
    historyFails = true
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByRole('alert').waitFor()
    historyFails = false
    await page.getByRole('alert').getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByText('이 범위에 세션 기록이 없습니다.', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await trigger.evaluate(el => el === el.ownerDocument.activeElement), true)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
