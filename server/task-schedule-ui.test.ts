import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Page } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { taskChanges } from '../shared/task-list.ts'

test('calendar agenda and Gantt share persisted periods, edit by mouse/touch/keyboard and preserve read-only views', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-task-schedule-ui-'))
  process.env.MEW_DATA_DIR = directory
  const { createTaskListRouter } = await import('./task-list-routes.ts')
  const { changeTaskList, readTaskList } = await import('./task-list.ts')
  const { WORKSPACE_ROOT } = await import('./paths.ts')
  changeTaskList(WORKSPACE_ROOT, taskChanges([], [
    { id: 'parent', text: '출시 준비', done: false },
    { id: 'period', text: '개발', done: false, parentId: 'parent', startDate: '2026-10-02', date: '2026-10-06' },
    { id: 'legacy', text: '검토', done: true, date: '2026-10-04' },
    { id: 'undated', text: '나중에 할 일', done: false },
  ]))
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {TaskPanel} from '${root}/src/components/task-panel.tsx';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
import {useTaskList} from '${root}/src/hooks/use-task-list.ts';
import {DockWorkspace,DockPanel} from '${root}/src/components/DockWorkspace.tsx';
import {setUiLocale} from '${root}/packages/ui/src/i18n-core.ts';
import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
setUiLocale('ko');
function Fixture(){const session=useTaskList(${JSON.stringify(WORKSPACE_ROOT)},'one@example.test',true);const [dock,setDock]=useState(null),[next,setNext]=useState(0),[previous,setPrevious]=useState(0);
return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}><div><button onClick={()=>setUiLocale('en')}>English</button><button onClick={()=>setUiLocale('ko')}>한국어</button></div><MobileDock active='tasks' available={['editor','tasks']} hidden={false} onSelect={()=>{}} onNavigate={direction=>direction>0?setNext(value=>value+1):setPrevious(value=>value+1)}/><DockWorkspace value={dock} onChange={setDock} foreground='tasks' apiRef={null} onEditorDrop={()=>''}><DockPanel id='tasks' kind='tasks' tabs={['tasks']} mobileSelected onFocus={()=>{}}><TaskPanel session={session} nextTabSignal={next} previousTabSignal={previous} onClose={()=>{}}/></DockPanel></DockWorkspace></div>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:task-schedule.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'schedule-fixture', resolveId(id) { if (id === 'virtual:task-schedule.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:task-schedule.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const files = ['src/components/task-panel.tsx', 'src/components/task-calendar.tsx', 'src/components/task-gantt.tsx', 'src/components/DockWorkspace.tsx', 'src/components/mobile-dock.tsx']
  const ui = (await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const dateCss = await fs.readFile(`${root}/packages/ui/src/date-field.css`, 'utf8'), panelCss = await fs.readFile(`${root}/src/components/task-panel.css`, 'utf8')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g)), ...Array.from((dateCss + panelCss).matchAll(/--color-([a-z-]+)/g), match => `bg-${match[1]}`)]) + panelCss + dateCss
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: 'one@example.test', mustChangePassword: false }; next() })
  let patches = 0
  app.use('/api/task-list', (req, _res, next) => { if (req.method === 'PATCH') patches++; next() }, createTaskListRouter())
  app.get('/app.js', (_req, res) => res.type('js').send(chunk.code))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`))
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`, browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  const screenshots = '/tmp/mew-task-schedule'
  await fs.mkdir(screenshots, { recursive: true })
  try {
    const desktop = await browser.newPage({ viewport: { width: 1000, height: 720 }, timezoneId: 'Asia/Seoul' })
    const mobile = await browser.newPage({ viewport: { width: 320, height: 740 }, timezoneId: 'Asia/Seoul', hasTouch: true, isMobile: true })
    const errors: string[] = []
    for (const page of [desktop, mobile]) { page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); await page.clock.setFixedTime(new Date('2026-10-03T03:00:00Z')); await page.goto(base); await page.locator('[data-task-id=undated]').waitFor().catch(async error => { throw new Error(`${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`) }) }
    const panel = desktop.locator('.task-panel')
    assert.equal(await panel.locator('[data-task-id=period] .task-date-status').innerText(), 'D-3')
    await panel.locator('[data-task-id=period] .task-date-status').click()
    const dates = desktop.locator('.task-date-popover')
    assert.equal(await dates.getByRole('textbox', { name: '태스크 시작 날짜' }).inputValue(), '2026-10-02')
    assert.equal(await dates.getByRole('textbox', { name: '태스크 날짜', exact: true }).inputValue(), '2026-10-06')
    await dates.getByRole('button', { name: '달력 열기' }).first().click()
    await desktop.getByRole('dialog', { name: '날짜 선택' }).waitFor()
    await desktop.keyboard.press('Escape')
    assert.equal(await dates.isVisible(), true)
    await desktop.keyboard.press('Escape')
    await dates.waitFor({ state: 'hidden' })
    assert.equal(await panel.locator('header [role=tablist] [role=tab]').count(), 3, 'all view tabs are in the title bar')
    await panel.getByRole('tab', { name: '목록', exact: true }).focus()
    await panel.getByRole('tab', { name: '목록', exact: true }).press('ArrowRight')
    assert.equal(await panel.getByRole('tab', { name: '달력', exact: true }).getAttribute('aria-selected'), 'true')
    await panel.getByRole('tab', { name: '달력', exact: true }).press('Home')
    await desktop.screenshot({ path: `${screenshots}/desktop-list-dark.png` })
    await panel.getByRole('tab', { name: '달력', exact: true }).click()
    await panel.locator('.task-calendar-day[data-date="2026-10-04"]').click()
    assert.deepEqual(await panel.locator('[data-task-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-task-id'))), ['period', 'legacy'])
    assert.equal(await panel.locator('.task-calendar-day[data-date="2026-10-04"]').getAttribute('aria-label').then(label => label?.includes('2개 일정')), true)
    await panel.locator('.task-calendar-day[data-date="2026-10-04"]').press('ArrowRight')
    assert.equal(await panel.locator('.task-calendar-day[data-date="2026-10-05"]').getAttribute('data-selected'), 'true')
    assert.equal(await panel.locator('[data-task-id]').count(), 1)
    await panel.locator('.task-calendar-day[data-date="2026-10-05"]').press('ArrowLeft')
    const calendarContrast = await panel.locator('.task-calendar-day[data-selected] .task-calendar-number').evaluate(el => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el); return [style.color, style.backgroundColor]
    })
    assert.ok(contrast(calendarContrast[0], calendarContrast[1]) >= 4.5, 'dark selected dates have readable text')
    await desktop.screenshot({ path: `${screenshots}/desktop-calendar-dark.png` })
    await panel.locator('.task-calendar-day[data-date="2026-10-10"]').click()
    await panel.getByText('이 날짜에는 일정이 없습니다', { exact: true }).waitFor()
    const draft = panel.getByRole('textbox', { name: '새 태스크' })
    await draft.fill('당일 일정'); await draft.press('Enter')
    const stored = () => readTaskList(WORKSPACE_ROOT)
    await desktop.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && (await response.json()).tasks.some((task: { text: string }) => task.text === '당일 일정'))
    assert.equal(stored().find(task => task.text === '당일 일정')?.startDate, '2026-10-10')
    const pasted = desktop.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && (await response.json()).tasks.some((task: { text: string }) => task.text === '둘째 일정'))
    await draft.evaluate(el => {
      const event = el.ownerDocument.createEvent('Event'); event.initEvent('paste', true, true)
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => '첫째 일정\n둘째 일정' } }); el.dispatchEvent(event)
    })
    await pasted
    assert.deepEqual(stored().filter(task => ['첫째 일정', '둘째 일정'].includes(task.text)).map(task => [task.startDate, task.date]), [['2026-10-10', '2026-10-10'], ['2026-10-10', '2026-10-10']], 'pasted calendar tasks use the selected day and stay in the agenda')
    await panel.getByRole('tab', { name: '간트', exact: true }).click()
    await panel.locator('[data-gantt-summary]').waitFor()
    const bar = panel.locator('[data-gantt-bar=period]')
    await bar.scrollIntoViewIfNeeded()
    const before = stored().find(task => task.id === 'period')!, rect = (await bar.boundingBox())!
    await desktop.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await desktop.mouse.down(); await desktop.mouse.move(rect.x + rect.width / 2 + 48, rect.y + rect.height / 2, { steps: 4 })
    assert.equal(stored().find(task => task.id === 'period')?.startDate, before.startDate, 'drag preview never saves')
    const saved = desktop.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await desktop.mouse.up(); await saved
    assert.equal(stored().find(task => task.id === 'period')?.startDate, '2026-10-04')
    assert.equal(stored().find(task => task.id === 'period')?.date, '2026-10-08')
    const right = panel.locator('[data-gantt-task=period] [data-gantt-resize=end]'), handle = (await right.boundingBox())!
    await desktop.mouse.move(handle.x + 7, handle.y + 16); await desktop.mouse.down(); await desktop.mouse.move(handle.x + 31, handle.y + 16)
    const resized = desktop.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await desktop.mouse.up(); await resized
    assert.equal(stored().find(task => task.id === 'period')?.date, '2026-10-09')
    const rect2 = (await bar.boundingBox())!, cancelCount = patches
    await desktop.mouse.move(rect2.x + rect2.width / 2, rect2.y + 11); await desktop.mouse.down(); await desktop.mouse.move(rect2.x + rect2.width / 2 + 72, rect2.y + 11)
    await desktop.keyboard.press('Escape'); await desktop.mouse.up()
    assert.equal(patches, cancelCount)
    assert.equal(stored().find(task => task.id === 'period')?.date, '2026-10-09')
    await bar.focus(); const keyboardSaved = desktop.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok()); await bar.press('ArrowLeft'); await keyboardSaved
    assert.equal(stored().find(task => task.id === 'period')?.startDate, '2026-10-03')
    await bar.press('Enter')
    const inspector = desktop.getByRole('dialog', { name: '일정 편집' })
    assert.equal(await inspector.getByRole('button', { name: '닫기' }).evaluate(el => el.ownerDocument.activeElement === el), true, 'keyboard opens the inspector with focus inside on a non-input control')
    await inspector.getByRole('textbox', { name: '태스크 시작 날짜' }).fill('2026-10-02')
    const inspectorSaved = desktop.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok()); await inspector.getByRole('textbox', { name: '태스크 시작 날짜' }).press('Enter'); await inspectorSaved
    await inspector.getByRole('button', { name: '달력 열기' }).first().click()
    await desktop.getByRole('dialog', { name: '날짜 선택' }).waitFor()
    await desktop.keyboard.press('Escape')
    assert.equal(await inspector.isVisible(), true, 'calendar dismisses before the inspector')
    await desktop.keyboard.press('Escape'); await inspector.waitFor({ state: 'hidden' })
    assert.equal(await bar.evaluate(el => el.ownerDocument.activeElement === el), true, 'closing the keyboard inspector restores bar focus')
    await panel.getByRole('button', { name: '일정 그리기' }).click()
    const empty = panel.locator('[data-gantt-new]'); await empty.scrollIntoViewIfNeeded()
    const blank = (await empty.boundingBox())!, total = stored().length
    await desktop.mouse.move(blank.x + 360, blank.y + 20); await desktop.mouse.down(); await desktop.mouse.move(blank.x + 432, blank.y + 20, { steps: 4 })
    assert.equal(stored().length, total)
    const drawn = desktop.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok()); await desktop.mouse.up(); await drawn
    assert.equal(stored().length, total + 1)
    assert.ok(stored().at(-1)?.startDate && stored().at(-1)?.date)
    await panel.getByRole('button', { name: '선택', exact: true }).click()
    await panel.getByRole('button', { name: '전체 기간 보기' }).click()
    const widthBefore = await panel.locator('.task-gantt-header').getAttribute('width')
    await panel.getByRole('button', { name: '확대', exact: true }).click()
    assert.ok(Number(await panel.locator('.task-gantt-header').getAttribute('width')) > Number(widthBefore))
    const scrollBefore = await panel.locator('.task-gantt-scroller').evaluate(el => el.scrollLeft)
    const header = (await panel.locator('.task-gantt-header').boundingBox())!
    await desktop.mouse.move(450, header.y + 25); await desktop.mouse.down(); await desktop.mouse.move(480, header.y + 25); await desktop.mouse.up()
    assert.ok(await panel.locator('.task-gantt-scroller').evaluate(el => el.scrollLeft) < scrollBefore, 'horizontal header drag pans without waiting for a zoom render')
    const scaleBefore = Number(await panel.locator('.task-gantt-header').getAttribute('width'))
    await desktop.mouse.move(450, header.y + 25); await desktop.mouse.down(); await desktop.mouse.move(450, header.y + 50); await desktop.mouse.up()
    assert.ok(Number(await panel.locator('.task-gantt-header').getAttribute('width')) > scaleBefore)
    await desktop.screenshot({ path: `${screenshots}/desktop-gantt-dark.png` })
    const todayContrast = await panel.locator('[data-gantt-today]').evaluate(el => {
      const style = el.ownerDocument.defaultView!, text = el.querySelector('text')!, background = el.querySelector('rect')!
      return [style.getComputedStyle(text).fill, style.getComputedStyle(background).fill]
    })
    assert.ok(contrast(todayContrast[0], todayContrast[1]) >= 4.5, 'small today badge text meets contrast requirements')
    await desktop.getByRole('button', { name: 'English', exact: true }).click()
    await panel.getByRole('tab', { name: 'Gantt', exact: true }).waitFor()
    assert.equal(await panel.getByRole('button', { name: 'Draw schedule' }).count(), 1)
    await desktop.getByRole('button', { name: '한국어', exact: true }).click()
    await desktop.reload(); await desktop.locator('[data-task-id=period]').waitFor()
    await desktop.locator('[data-task-id=period] .task-date-status').click()
    assert.equal(await desktop.locator('.task-date-popover').getByRole('textbox', { name: '태스크 시작 날짜' }).inputValue(), '2026-10-02')
    await desktop.keyboard.press('Escape')
    await mobile.reload(); await mobile.locator('[data-task-id=period]').waitFor()
    await mobile.locator('html').evaluate(el => el.classList.remove('dark'))
    const status = mobile.locator('[data-task-id=period] .task-date-status')
    const statusBox = (await status.boundingBox())!
    const mobilePlus = (await mobile.locator('[data-task-id=period]').getByRole('button', { name: '하위 태스크 추가' }).boundingBox())!
    assert.ok(statusBox.x + statusBox.width <= mobilePlus.x)
    await status.tap()
    const mobileDates = mobile.locator('.task-date-popover')
    const dateBox = (await mobileDates.boundingBox())!
    assert.ok(dateBox.x >= 0 && dateBox.x + dateBox.width <= 320)
    assert.equal(await mobileDates.getByRole('textbox', { name: '태스크 시작 날짜' }).inputValue(), '2026-10-02')
    await mobileDates.getByRole('button', { name: '달력 열기' }).first().tap()
    await mobile.getByRole('dialog', { name: '날짜 선택' }).waitFor()
    await mobile.keyboard.press('Escape')
    assert.equal(await mobileDates.isVisible(), true)
    await mobile.keyboard.press('Escape')
    await mobileDates.waitFor({ state: 'hidden' })
    await mobile.screenshot({ path: `${screenshots}/mobile-list-light.png` })
    await mobile.getByRole('tab', { name: '달력', exact: true }).tap()
    await mobile.locator('.task-calendar-day[data-date="2026-10-04"]').tap()
    const lightContrast = await mobile.locator('.task-calendar-day[data-selected] .task-calendar-number').evaluate(el => {
      const style = el.ownerDocument.defaultView!.getComputedStyle(el); return [style.color, style.backgroundColor]
    })
    assert.ok(contrast(lightContrast[0], lightContrast[1]) >= 4.5, 'light selected dates have readable text')
    assert.equal(await mobile.locator('[data-task-id]').count(), 2)
    await mobile.screenshot({ path: `${screenshots}/mobile-calendar-light.png` })
    const dock = (await mobile.locator('.mobile-dock').boundingBox())!
    const dockX = dock.x + dock.width - 8, dockY = dock.y + dock.height / 2
    await touchDrag(mobile, dockX, dockY, dockX - 60, dockY)
    await mobile.locator('.task-gantt').waitFor()
    assert.equal(await mobile.getByRole('tab', { name: '간트', exact: true }).getAttribute('aria-selected'), 'true', 'left dock swipe chooses the next task view')
    await touchDrag(mobile, dockX - 60, dockY, dockX, dockY)
    await mobile.locator('.task-calendar').waitFor()
    assert.equal(await mobile.getByRole('tab', { name: '달력', exact: true }).getAttribute('aria-selected'), 'true', 'right dock swipe chooses the previous task view')
    await touchDrag(mobile, dockX, dockY, dockX - 60, dockY)
    await mobile.locator('.task-gantt').waitFor()
    await touchDrag(mobile, dockX, dockY, dockX - 60, dockY)
    await mobile.locator('[data-task-id=period]').waitFor()
    assert.equal(await mobile.getByRole('tab', { name: '목록', exact: true }).getAttribute('aria-selected'), 'true', 'task view navigation wraps and keeps the task panel open')
    await touchDrag(mobile, dockX - 60, dockY, dockX, dockY)
    await mobile.locator('.task-gantt').waitFor()
    assert.equal(await mobile.locator('.task-gantt-labels').evaluate(el => el.getBoundingClientRect().width), 132)
    await mobile.getByRole('button', { name: '오늘', exact: true }).tap()
    const mobileBar = mobile.locator('[data-gantt-bar=period]')
    await mobileBar.scrollIntoViewIfNeeded()
    const touchBar = (await mobileBar.boundingBox())!, labels = (await mobile.locator('.task-gantt-labels').boundingBox())!
    const touchX = Math.max(touchBar.x + Math.min(touchBar.width / 2, 40), labels.x + labels.width + 12), touchY = touchBar.y + 11
    await Promise.all([
      mobile.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok()),
      touchDrag(mobile, touchX, touchY, touchX + 24, touchY),
    ])
    assert.equal(stored().find(task => task.id === 'period')?.startDate, '2026-10-03')
    assert.equal(await mobile.locator('.task-panel').evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await mobile.screenshot({ path: `${screenshots}/mobile-gantt-light.png` })
    const readonly = await browser.newPage({ viewport: { width: 390, height: 740 } })
    await readonly.route('**/api/task-list?*', route => route.fulfill({ json: { tasks: stored(), canEdit: false } }))
    await readonly.goto(base); await readonly.locator('[data-task-id=period]').waitFor()
    await readonly.getByRole('tab', { name: '달력', exact: true }).click()
    await readonly.getByRole('tab', { name: '간트', exact: true }).click()
    assert.equal(await readonly.getByRole('button', { name: '일정 그리기' }).isDisabled(), true)
    assert.equal(await readonly.locator('[data-gantt-resize]').count(), 0)
    assert.equal(await readonly.locator('[data-gantt-grab]').count(), 1, 'only viewport gestures remain enabled')
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }) }
})

async function touchDrag(page: Page, x: number, y: number, endX: number, endY: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: endX, y: endY, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
      const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
    })
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}
