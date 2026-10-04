import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('task panel supports continuous typing, independent objects, autosave, retry, docking and mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-task-ui-'))
  process.env.MEW_DATA_DIR = directory
  const { createTaskListRouter } = await import('./task-list-routes.ts')
  const { readTaskList } = await import('./task-list.ts')
  const { WORKSPACE_ROOT } = await import('./paths.ts')
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {I18nProvider} from '${root}/src/i18n.tsx';
import {TaskPanel} from '${root}/src/components/task-panel.tsx';
import {useTaskList} from '${root}/src/hooks/use-task-list.ts';
import {DockWorkspace,DockPanel} from '${root}/src/components/DockWorkspace.tsx';
import {MobileDock} from '${root}/src/components/mobile-dock.tsx';
import {useOverlayDismiss} from '@mew/ui';
localStorage.setItem('mew:locale','ko');
function Fixture(){const [open,setOpen]=useState(false),[front,setFront]=useState('editor'),[dock,setDock]=useState(null),[key,setKey]=useState(0);
const session=useTaskList(${JSON.stringify(WORKSPACE_ROOT)},'one@example.test',open);
const close=()=>{setOpen(false);setFront('editor')};useOverlayDismiss(open&&front==='tasks'?close:false,{escapePhase:'bubble'});
return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}><button onClick={()=>setKey(key+1)}>Remount panels</button>
<MobileDock active={front} openPanels={open?['editor','tasks']:['editor']} available={['editor','tasks']} hidden={false} onSelect={id=>{if(id==='tasks'){if(innerWidth>=768&&open&&front==='tasks')close();else{setOpen(true);setFront('tasks')}}else setFront('editor')}} onNavigate={()=>{}}/>
<DockWorkspace key={key} value={dock} onChange={setDock} foreground={front} apiRef={null} onEditorDrop={()=>''}>
<DockPanel id='editor' kind='editor' tabs={['editor']} mobileSelected onFocus={()=>setFront('editor')}><input aria-label='Outside'/></DockPanel>
<DockPanel id='tasks' kind='tasks' visible={open} tabs={['tasks']} mobileSelected onFocus={()=>setFront('tasks')}><TaskPanel session={session} onClose={close}/></DockPanel>
</DockWorkspace></div>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:task.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'task-fixture', resolveId(id) {
    if (id === 'virtual:task.tsx') return id
    if (id.endsWith('.css')) return 'virtual:style'
  }, load(id) { if (id === 'virtual:task.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const ui = (await Promise.all(['src/components/task-panel.tsx', 'src/components/DockWorkspace.tsx', 'src/components/mobile-dock.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const dateCss = await fs.readFile(`${root}/packages/ui/src/date-field.css`, 'utf8')
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g)), ...Array.from(dateCss.matchAll(/--color-([a-z-]+)/g), match => `bg-${match[1]}`)]) + await fs.readFile(path.join(root, 'src/components/task-panel.css'), 'utf8') + dateCss + await fs.readFile(`${root}/packages/ui/src/date-calendar.css`, 'utf8')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: 'one@example.test', mustChangePassword: false }; next() })
  let failNext = false
  app.use('/api/task-list', (req, res, next) => { if (req.method === 'PATCH' && failNext) { failNext = false; res.status(500).json({ error: '태스크를 저장하지 못했습니다' }); return } next() }, createTaskListRouter())
  app.get('/app.js', (_req, res) => res.type('js').send(chunk.code))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const one = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    const two = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const errors: string[] = []
    for (const page of [one, two]) { page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message)); await page.goto(base) }
    await one.locator('[data-dock-item=tasks]').click()
    const panel = one.getByRole('region', { name: '태스크', exact: true })
    const draft = panel.getByRole('textbox', { name: '새 태스크' })
    await draft.fill('계획 정리'); await draft.press('Enter')
    await draft.fill('검토하기'); await draft.press('Enter')
    let rows = panel.locator('[data-task-id]')
    assert.equal(await rows.count(), 2)
    const firstId = await rows.first().getAttribute('data-task-id')
    await draft.evaluate(el => {
      const event = el.ownerDocument.createEvent('Event')
      event.initEvent('keydown', true, true)
      Object.defineProperties(event, { key: { value: 'Enter' }, keyCode: { value: 229 }, isComposing: { value: true } })
      el.dispatchEvent(event)
    })
    assert.equal(await rows.count(), 2, 'IME confirmation does not create a separate object')
    await rows.first().getByRole('textbox', { name: '태스크 내용', exact: true }).focus(); await one.keyboard.press('Home'); await one.keyboard.press('ArrowRight'); await one.keyboard.press('ArrowRight'); await one.keyboard.press('Enter')
    assert.equal(await rows.count(), 3)
    assert.equal(await rows.first().getAttribute('data-task-id'), firstId, 'splitting retains the original object identity')
    assert.equal(await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).inputValue(), ' 정리')
    await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())))
    await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).fill('')
    await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).press('Backspace')
    assert.equal(await rows.count(), 2)
    await draft.evaluate((el, text) => {
      const event = el.ownerDocument.createEvent('Event')
      event.initEvent('paste', true, true)
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
      el.dispatchEvent(event)
    }, '연락하기\n출시 확인')
    await rows.nth(3).waitFor()
    assert.equal(await rows.count(), 4)
    const ids = await rows.evaluateAll(elements => elements.map(el => el.getAttribute('data-task-id')))
    assert.equal(new Set(ids).size, 4, 'each line is an independent object')
    await rows.first().getByRole('checkbox').check()
    await two.locator('[data-dock-item=tasks]').tap()
    const mobile = two.getByRole('region', { name: '태스크', exact: true })
    await mobile.locator('[data-task-id]').nth(3).waitFor()
    await mobile.locator('[data-task-id]').first().locator('input:checked').waitFor()
    assert.equal(await mobile.locator('[data-task-id]').first().getByRole('checkbox').isChecked(), true)
    await mobile.locator('[data-task-id]').last().getByRole('textbox', { name: '태스크 내용', exact: true }).fill('모바일에서 수정')
    await one.waitForFunction("Array.from(document.querySelectorAll('.task-panel textarea')).some(el=>el.value==='모바일에서 수정')")
    failNext = true
    await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).fill('실패해도 유지')
    await panel.getByRole('alert').waitFor()
    assert.equal(await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).inputValue(), '실패해도 유지')
    await panel.getByRole('button', { name: '다시 저장' }).click()
    await panel.getByRole('alert').waitFor({ state: 'hidden' })
    await draft.fill('아직 작성 중')
    await one.getByRole('button', { name: 'Remount panels' }).click()
    rows = panel.locator('[data-task-id]')
    assert.equal(await rows.count(), 5, 'focus leaving a draft commits it before a panel remount')
    await one.locator('[data-dock-item=tasks]').click(); await panel.waitFor({ state: 'hidden' })
    await one.locator('[data-dock-item=tasks]').click(); await panel.waitFor()
    assert.equal(await rows.count(), 5)
    await panel.getByRole('tab', { name: '태스크' }).dblclick()
    await one.locator('[data-dock-panel=tasks][data-dock-expanded]').waitFor()
    await one.keyboard.press('Escape')
    assert.equal(await one.locator('[data-dock-expanded]').count(), 0)
    assert.equal(await panel.isVisible(), true)
    await two.evaluate("document.documentElement.classList.remove('dark')")
    assert.equal(await mobile.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await fs.mkdir('/tmp/mew-task-panel', { recursive: true })
    await one.screenshot({ path: '/tmp/mew-task-panel/desktop-dark.png' })
    await two.screenshot({ path: '/tmp/mew-task-panel/mobile-light.png' })
    await one.reload(); await one.locator('[data-dock-item=tasks]').click()
    await panel.locator('[data-task-id]').nth(4).waitFor()
    assert.equal(await panel.locator('[data-task-id]').first().getAttribute('data-task-id'), firstId)
    if (readTaskList(WORKSPACE_ROOT).length !== 5) await one.waitForResponse(async response => {
      if (!response.url().includes('/api/task-list') || !response.ok()) return false
      return (await response.json() as { tasks: unknown[] }).tasks.length === 5
    })
    assert.equal(readTaskList(WORKSPACE_ROOT).length, 5)
    const order = () => panel.locator('[data-task-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-task-id')))
    const initialOrder = await order()
    const start = (await panel.locator('[data-task-id]').first().locator('.task-check').boundingBox())!
    const end = (await panel.locator('[data-task-id]').last().boundingBox())!
    await one.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await one.mouse.down(); await one.mouse.move(start.x + 12, end.y + end.height + 4, { steps: 8 })
    await one.locator('[data-task-drag-preview]').waitFor()
    const liveOrder = [...initialOrder.slice(1), initialOrder[0]]
    assert.deepEqual(await order(), liveOrder, 'order updates before dropping')
    await one.waitForTimeout(400)
    assert.deepEqual(readTaskList(WORKSPACE_ROOT).map(item => item.id), initialOrder, 'live preview does not save before dropping')
    await one.screenshot({ path: '/tmp/mew-task-panel/desktop-drag.png' })
    await one.mouse.up()
    const movedOrder = [...initialOrder.slice(1), initialOrder[0]]
    assert.deepEqual(await order(), movedOrder)
    assert.equal(await panel.locator(`[data-task-id="${firstId}"]`).getByRole('checkbox').isChecked(), true, 'drag does not toggle completion')
    await mobile.locator(`[data-task-id="${firstId}"]`).waitFor()
    await mobile.locator(`[data-task-id]:nth-child(5)[data-task-id="${firstId}"]`).waitFor()
    const mobileFirst = (await mobile.locator('[data-task-id]').first().locator('.task-check').boundingBox())!
    const mobileLast = (await mobile.locator('[data-task-id]').last().boundingBox())!
    const touch = await two.context().newCDPSession(two)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mobileFirst.x + 12, y: mobileFirst.y + 14 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mobileFirst.x + 12, y: mobileLast.y + mobileLast.height + 3 }] })
    await two.locator('[data-task-drag-preview]').waitFor()
    assert.equal(await mobile.locator('[data-task-id]').evaluateAll(elements => elements.some(el => el.getAnimations().some((animation: { effect?: { getTiming(): { duration: number | string } } }) => animation.effect?.getTiming().duration === 180))), true, 'live reorder uses the shared 180ms animation')
    assert.deepEqual(await mobile.locator('[data-task-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-task-id'))), [...movedOrder.slice(1), movedOrder[0]], 'touch order updates before releasing')
    await two.screenshot({ path: '/tmp/mew-task-panel/mobile-drag.png' })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const touchOrder = [...movedOrder.slice(1), movedOrder[0]]
    assert.deepEqual(await mobile.locator('[data-task-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-task-id'))), touchOrder)
    await one.waitForResponse(async response => response.url().includes('/api/task-list') && response.ok() && (await response.json() as { tasks: { id: string }[] }).tasks.map(item => item.id).join() === touchOrder.join())
    assert.deepEqual(readTaskList(WORKSPACE_ROOT).map(item => item.id), touchOrder)
    await one.reload(); await one.locator('[data-dock-item=tasks]').click()
    await panel.locator('[data-task-id]').nth(4).waitFor()
    assert.deepEqual(await order(), touchOrder, 'dragged order survives reload')
    const cancelStart = (await panel.locator('[data-task-id]').first().locator('.task-check').boundingBox())!
    const cancelTarget = (await panel.locator('[data-task-id]').nth(1).boundingBox())!
    await one.mouse.move(cancelStart.x + 12, cancelStart.y + 14); await one.mouse.down(); await one.mouse.move(cancelStart.x + 12, cancelTarget.y + cancelTarget.height / 2 + 8)
    assert.notDeepEqual(await order(), touchOrder, 'canceled drag had already changed visual order')
    await one.keyboard.press('Escape'); await one.mouse.up()
    assert.equal(await panel.isVisible(), true, 'drag Escape does not close the panel')
    assert.deepEqual(await order(), touchOrder, 'cancel leaves persisted order unchanged')
    const keyboardCheckbox = panel.locator('[data-task-id]').last().getByRole('checkbox')
    const wasChecked = await keyboardCheckbox.isChecked()
    await keyboardCheckbox.press('Alt+ArrowUp')
    const keyboardOrder = [...touchOrder.slice(0, 3), touchOrder[4], touchOrder[3]]
    assert.deepEqual(await order(), keyboardOrder)
    assert.equal(await panel.locator(`[data-task-id="${touchOrder[4]}"]`).getByRole('checkbox').isChecked(), wasChecked)
    const cancelTouch = (await mobile.locator('[data-task-id]').first().locator('.task-check').boundingBox())!
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cancelTouch.x + 12, y: cancelTouch.y + 14 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cancelTouch.x + 12, y: cancelTouch.y + 80 }] })
    await two.locator('[data-task-drag-preview]').waitFor()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await two.locator('[data-task-drag-preview]').waitFor({ state: 'hidden' })
    const parentRow = panel.locator('[data-task-id]').first()
    const parentId = await parentRow.getAttribute('data-task-id')
    await parentRow.hover(); await parentRow.getByRole('button', { name: '하위 태스크 추가' }).click()
    const childRow = panel.locator('[data-task-id]').nth(1)
    const childId = await childRow.getAttribute('data-task-id')
    assert.equal(await childRow.getByRole('textbox', { name: '태스크 내용', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
    await childRow.getByRole('textbox', { name: '태스크 내용', exact: true }).fill('하위 항목')
    await childRow.getByRole('textbox', { name: '태스크 내용', exact: true }).press('Enter')
    await panel.locator('[data-task-id]').nth(2).getByRole('textbox', { name: '태스크 내용', exact: true }).fill('같은 단계')
    await Promise.all([one.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && (await response.json()).tasks.some((item: { text: string }) => item.text === '같은 단계')), panel.locator('[data-task-id]').nth(2).getByRole('textbox', { name: '태스크 내용', exact: true }).press('Tab')])
    assert.equal(readTaskList(WORKSPACE_ROOT).find(item => item.id === childId)?.parentId, parentId)
    assert.equal(readTaskList(WORKSPACE_ROOT)[2].parentId, parentId)
    await one.screenshot({ path: '/tmp/mew-task-panel/desktop-subtasks.png' })
    await one.reload(); await one.locator('[data-dock-item=tasks]').click()
    await panel.locator(`[data-task-id="${childId}"]`).waitFor()
    assert.equal(await panel.locator(`[data-task-id="${childId}"]`).evaluate(el => el.style.paddingLeft), '16px')
    const foldedParent = panel.locator(`[data-task-id="${parentId}"]`)
    await foldedParent.getByRole('button', { name: '접기', exact: true }).click()
    const movedFolded = one.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await foldedParent.getByRole('checkbox').press('Alt+ArrowDown'); await movedFolded
    const foldedOrder = readTaskList(WORKSPACE_ROOT).map(item => item.id)
    assert.equal(foldedOrder.indexOf(childId!), foldedOrder.indexOf(parentId!) + 1, 'hidden descendants remain in a keyboard subtree move')
    const restoredFolded = one.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await foldedParent.getByRole('checkbox').press('Alt+ArrowUp'); await restoredFolded
    await foldedParent.getByRole('button', { name: '펼치기', exact: true }).click()
    const originalTree = await order()
    const parentHandle = (await panel.locator(`[data-task-id="${parentId}"]`).locator('.task-check').boundingBox())!
    const treeEnd = (await panel.locator('[data-task-id]').last().boundingBox())!
    await one.mouse.move(parentHandle.x + 12, parentHandle.y + 14)
    await one.mouse.down(); await one.mouse.move(parentHandle.x + 12, treeEnd.y + treeEnd.height + 4, { steps: 5 })
    const liveTree = await order()
    assert.notDeepEqual(liveTree, originalTree)
    assert.deepEqual(liveTree.slice(liveTree.indexOf(parentId!)), originalTree.slice(0, 3), 'parent and descendants move together during drag')
    await one.keyboard.press('Escape'); await one.mouse.up()
    assert.deepEqual(await order(), originalTree)
    await parentRow.getByRole('checkbox').press('Alt+ArrowDown')
    const treeOrder = await order()
    assert.equal(treeOrder.indexOf(childId!), treeOrder.indexOf(parentId!) + 1)
    await panel.locator(`[data-task-id="${parentId}"]`).hover()
    await Promise.all([one.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && !(await response.json()).tasks.some((item: { id: string }) => item.id === parentId)), panel.locator(`[data-task-id="${parentId}"]`).getByRole('button', { name: '태스크 삭제' }).click()])
    assert.equal(readTaskList(WORKSPACE_ROOT).find(item => item.id === childId)?.parentId ?? null, null)
    await two.reload(); await two.locator('[data-dock-item=tasks]').click()
    await mobile.locator(`[data-task-id="${childId}"]`).waitFor()
    await mobile.locator(`[data-task-id="${childId}"]`).getByRole('button', { name: '하위 태스크 추가' }).click()
    await mobile.locator('[data-task-id]').evaluateAll(elements => {
      const focused = elements.find(el => el.contains(el.ownerDocument.activeElement))
      if (!focused || !focused.getAttribute('style')?.includes('padding-left: 16px')) throw new Error('mobile child is not focused/indented')
    })
    await two.keyboard.type('모바일 하위 항목')
    await Promise.all([two.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && (await response.json()).tasks.some((item: { text: string }) => item.text === '모바일 하위 항목')), two.keyboard.press('Tab')])
    assert.equal(readTaskList(WORKSPACE_ROOT).find(item => item.text === '모바일 하위 항목')?.parentId, childId)
    await two.screenshot({ path: '/tmp/mew-task-panel/mobile-subtasks.png' })
    const datedRow = mobile.locator('[data-task-id]').first()
    const datedId = await datedRow.getAttribute('data-task-id')
    await datedRow.locator('.task-date-status').click()
    const calendar = two.locator('.task-date-popover')
    await calendar.getByRole('textbox', { name: '연도' }).fill('2026')
    await calendar.getByRole('textbox', { name: '연도' }).press('Enter')
    await calendar.getByRole('textbox', { name: '월', exact: true }).fill('10')
    await calendar.getByRole('textbox', { name: '월', exact: true }).press('Enter')
    await calendar.locator('[data-date="2026-10-15"]').click()
    await Promise.all([two.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && (await response.json()).tasks.some((item: { id: string; date?: string }) => item.id === datedId && item.date === '2026-10-18')), calendar.locator('[data-date="2026-10-18"]').click()])
    await two.screenshot({ animations: 'disabled', path: '/tmp/mew-task-panel/mobile-calendar.png' })
    await two.keyboard.press('Escape')
    await two.reload(); await two.locator('[data-dock-item=tasks]').click()
    await mobile.locator(`[data-task-id="${datedId}"] .task-date-status`).click()
    assert.match(await two.locator('.task-range-summary').innerText(), /2026-10-18/)
    await two.keyboard.press('Escape')
    const addToFolded = panel.locator(`[data-task-id="${childId}"]`)
    await addToFolded.getByRole('button', { name: '접기', exact: true }).click()
    await addToFolded.getByRole('button', { name: '하위 태스크 추가' }).click()
    assert.equal(await addToFolded.getByRole('button', { name: '접기', exact: true }).getAttribute('aria-expanded'), 'true')
    await panel.locator('[data-task-id] textarea:focus').waitFor()
    const focusedId = await panel.locator('[data-task-id]').evaluateAll(elements => elements.find(el => el.contains(el.ownerDocument.activeElement))?.getAttribute('data-task-id'))
    assert.ok(focusedId && focusedId !== childId)
    await panel.locator(`[data-task-id="${focusedId}"]`).getByRole('textbox', { name: '태스크 내용', exact: true }).fill('접힌 부모의 새 하위 항목')
    const foldedChildSaved = one.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && (await response.json()).tasks.some((item: { text: string }) => item.text === '접힌 부모의 새 하위 항목'))
    await panel.locator(`[data-task-id="${focusedId}"]`).getByRole('textbox', { name: '태스크 내용', exact: true }).press('Tab'); await foldedChildSaved
    const readOnly = await browser.newPage()
    await readOnly.route('**/api/task-list?*', route => route.fulfill({ json: { tasks: readTaskList(WORKSPACE_ROOT), canEdit: false } }))
    await readOnly.goto(base); await readOnly.locator('[data-dock-item=tasks]').click()
    const readOnlyPanel = readOnly.getByRole('region', { name: '태스크', exact: true })
    await readOnlyPanel.locator('[data-task-id]').nth(4).waitFor()
    assert.equal(await readOnlyPanel.getByRole('textbox', { name: '새 태스크' }).count(), 0)
    assert.equal(await readOnlyPanel.getByRole('checkbox').first().isDisabled(), true)
    assert.equal(await readOnlyPanel.getByRole('textbox', { name: '태스크 내용', exact: true }).first().getAttribute('readonly'), '')
    assert.equal(await readOnlyPanel.getByRole('button', { name: '태스크 삭제' }).count(), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }) }
})
