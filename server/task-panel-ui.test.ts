import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

function tagContrast(color: string, background: string): number {
  const luminance = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(number => {
    const channel = number / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
  const a = luminance(color), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

async function assertInlineTagAlignment(row: Locator): Promise<void> {
  const metrics = await row.locator('.task-text').evaluate(el => {
    const input = el.querySelector('textarea')!, style = el.ownerDocument.defaultView!.getComputedStyle(input)
    const lineHeight = parseFloat(style.lineHeight)
    const center = input.getBoundingClientRect().top + parseFloat(style.paddingTop) + lineHeight / 2
    return [...el.querySelectorAll('.task-tag')].map(tag => { const rect = tag.getBoundingClientRect(); return { delta: Math.abs(rect.top + rect.height / 2 - center), height: rect.height, lineHeight } })
  })
  assert.ok(metrics.length > 0)
  assert.ok(metrics.every(tag => tag.delta <= 1), 'tag centers align with the first text line, including wrapped text and read-only chips')
  assert.ok(metrics.every(tag => tag.height <= tag.lineHeight), 'tag backgrounds stay within the text line height')
}

test('task panel supports continuous typing, independent objects, autosave, retry, docking and mobile', { skip: !domBrowserExecutable(), timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-task-ui-'))
  process.env.MEW_DATA_DIR = directory
  process.env.MEW_WORKSPACE = path.join(directory, 'workspace')
  await fs.mkdir(process.env.MEW_WORKSPACE)
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
<DockPanel id='tasks' kind='tasks' visible={open} tabs={['tasks']} mobileSelected onFocus={()=>setFront('tasks')}><TaskPanel workspace='fixture' onOpenFile={path=>{window.openedTaskFile=path}} session={session} onClose={close}/></DockPanel>
</DockWorkspace></div>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:task.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'task-fixture', resolveId(id) {
    if (id === 'virtual:task.tsx') return id
    if (id.endsWith('.css')) return 'virtual:style'
  }, load(id) { if (id === 'virtual:task.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const ui = (await Promise.all(['src/components/task-panel.tsx', 'src/components/task-text.tsx', 'src/components/task-tag-filter.tsx', 'packages/ui/src/select-field.tsx', 'src/components/DockWorkspace.tsx', 'src/components/mobile-dock.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const dateCss = await fs.readFile(`${root}/packages/ui/src/date-field.css`, 'utf8')
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g)), ...Array.from(dateCss.matchAll(/--color-([a-z-]+)/g), match => `bg-${match[1]}`)]) + await fs.readFile(path.join(root, 'src/components/task-panel.css'), 'utf8') + dateCss + await fs.readFile(`${root}/packages/ui/src/date-calendar.css`, 'utf8')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: 'one@example.test', mustChangePassword: false }; next() })
  let failures = 0
  app.use('/api/task-list', (req, res, next) => { if (req.method === 'PATCH' && failures > 0) { failures--; res.status(500).json({ error: '태스크를 저장하지 못했습니다' }); return } next() }, createTaskListRouter())
  app.get('/api/tree', (_req, res) => res.json([{type:'file',name:'Reference.md',path:'docs/Reference.md'},{type:'file',name:'Reference.md',path:'nested/Reference.md'},{type:'file',name:'Space (draft).md',path:'docs/Space (draft).md'}]))
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
    await rows.first().getByRole('checkbox').click()
    assert.equal(await panel.locator(`[data-task-id="${firstId}"]`).count(), 0, 'completed tasks hide immediately by default')
    await panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
    await two.locator('[data-dock-item=tasks]').tap()
    const mobile = two.getByRole('region', { name: '태스크', exact: true })
    await mobile.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
    await mobile.locator('[data-task-id]').nth(3).waitFor()
    await mobile.locator('[data-task-id]').first().locator('input:checked').waitFor()
    assert.equal(await mobile.locator('[data-task-id]').first().getByRole('checkbox').isChecked(), true)
    await mobile.locator('[data-task-id]').last().getByRole('textbox', { name: '태스크 내용', exact: true }).fill('모바일에서 수정')
    await one.waitForFunction("Array.from(document.querySelectorAll('.task-panel textarea')).some(el=>el.value==='모바일에서 수정')")
    failures = 1
    const transientFailure = one.waitForResponse(response => response.url().includes('/api/task-list') && response.status() === 500)
    await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).fill('자동 복구')
    await transientFailure
    assert.equal(await panel.getByRole('alert').count(), 0)
    const recovered = one.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await recovered
    assert.equal(await panel.getByRole('alert').count(), 0)
    assert.ok(readTaskList(WORKSPACE_ROOT).some(task => task.text === '자동 복구'))
    failures = 3
    await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).fill('실패해도 유지')
    await panel.getByRole('alert').waitFor()
    assert.equal(await rows.nth(1).getByRole('textbox', { name: '태스크 내용', exact: true }).inputValue(), '실패해도 유지')
    await panel.getByRole('button', { name: '다시 저장' }).click()
    await panel.getByRole('alert').waitFor({ state: 'hidden' })
    await draft.fill('아직 작성 중')
    await one.getByRole('button', { name: 'Remount panels' }).click()
    assert.equal(await panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).isChecked(), false, 'remount resets completion filter')
    await panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
    await mobile.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
    rows = panel.locator('[data-task-id]')
    assert.equal(await rows.count(), 5, 'focus leaving a draft commits it before a panel remount')
    await one.locator('[data-dock-item=tasks]').click(); await panel.waitFor({ state: 'hidden' })
    await one.locator('[data-dock-item=tasks]').click(); await panel.waitFor()
    await panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
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
    await panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
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
    await panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
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
    assert.equal(await panel.getByRole('button', { name: '하위 태스크 추가' }).count(), 0)
    assert.equal(await panel.locator('.task-disclosure').count(), 0)
    await draft.fill('분류 작업 @Ref #그대로'); await draft.press('Enter')
    const tagged = panel.locator('[data-task-id]').last()
    const taggedId = await tagged.getAttribute('data-task-id')
    const input = tagged.getByRole('textbox', { name: '태스크 내용', exact: true })
    assert.equal(await input.inputValue(), '분류 작업 @Ref #그대로', 'title preserves literal @ and #')
    assert.equal(await one.getByRole('listbox', { name: '파일명 검색' }).count(), 0)
    const addTags = async (row: Locator, page: typeof one, names: string[]) => {
      await row.locator('.task-tag-picker [aria-haspopup="dialog"]').first().click()
      const picker = page.locator('.task-tag-picker-menu')
      for (const tag of names) {
        await picker.getByRole('textbox', { name: '검색', exact: true }).fill(tag)
        await picker.getByRole('option', { name: tag, exact: true }).click()
      }
      assert.equal(await picker.isVisible(), true, 'multiple choices keep the picker open')
      await page.keyboard.press('Escape')
    }
    assert.equal(await tagged.locator('.task-tag-placeholder').textContent(), '태그')
    assert.equal(await tagged.locator('.task-tag-add').count(), 0)
    await addTags(tagged, one, ['abc'])
    await tagged.getByRole('button', { name: '태그: abc', exact: true }).click()
    await one.locator('.task-tag-picker-menu').getByRole('option', { name: 'abc', exact: true }).click()
    assert.equal(await tagged.locator('.task-tag-placeholder').textContent(), '태그', 'removing the final tag restores the neutral chip')
    await one.keyboard.press('Escape')
    assert.equal(await tagged.getByRole('button', { name: '태그', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true, 'removed trigger restores focus to the placeholder')
    await addTags(tagged, one, ['abc', 'abcde', 'bsas'])
    assert.equal(await tagged.locator('.task-tag-placeholder').count(), 0)
    assert.equal(await tagged.locator('.task-tag-name[aria-haspopup="dialog"]').count(), 3)
    await assertInlineTagAlignment(tagged)
    const darkPairs = await tagged.locator('.task-tag').evaluateAll(elements => elements.map(el => { const style = el.ownerDocument.defaultView!.getComputedStyle(el); return [style.color, style.backgroundColor] }))
    assert.ok(darkPairs.every(([color, background]) => tagContrast(color, background) >= 4.5))
    await tagged.getByRole('button', { name: '태그: bsas', exact: true }).click()
    const picker = one.locator('.task-tag-picker-menu')
    const selectedBeforeColor = await picker.getByRole('option', { name: 'abc', exact: true }).getAttribute('aria-selected')
    await picker.getByRole('button', { name: '태그 색상: abc', exact: true }).click()
    const palette = one.getByRole('dialog', { name: '태그 색상: abc', exact: true })
    assert.equal(await palette.getByRole('button').count(), 16)
    await one.screenshot({ path: '/tmp/mew-task-panel/desktop-tag-colors-dark.png' })
    await one.keyboard.press('Escape')
    assert.equal(await palette.count(), 0)
    assert.equal(await picker.isVisible(), true, 'Escape closes only the color palette')
    await picker.getByRole('button', { name: '태그 색상: abc', exact: true }).click()
    const savedColor = one.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await one.getByRole('button', { name: '색상 13', exact: true }).click()
    await savedColor
    assert.equal(await picker.getByRole('option', { name: 'abc', exact: true }).getAttribute('aria-selected'), selectedBeforeColor, 'color changes do not toggle tag selection')
    assert.equal(await tagged.locator('.task-tag').filter({ hasText: 'abc' }).first().evaluate(el => el.style.getPropertyValue('--task-tag-hue')), '225')
    assert.equal(await picker.getByRole('button', { name: '태그 색상: abc', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
    assert.equal(await picker.getByRole('textbox', { name: '검색', exact: true }).getAttribute('placeholder'), '태그 검색')
    await picker.getByRole('textbox', { name: '검색', exact: true }).fill('abc')
    assert.deepEqual(await picker.locator('.task-tag-result').allTextContents(), ['abc', 'abcde'])
    await one.screenshot({ path: '/tmp/mew-task-panel/desktop-tags-dark.png' })
    await picker.getByRole('textbox', { name: '검색', exact: true }).press('ArrowDown')
    await picker.getByRole('textbox', { name: '검색', exact: true }).press('Enter')
    assert.deepEqual(await tagged.locator('.task-tag-name').allTextContents(), ['abc', 'bsas'])
    await one.keyboard.press('Escape')
    assert.equal(await panel.isVisible(), true)
    await panel.getByRole('combobox', { name: '태그 필터', exact: true }).click()
    const filterMenu = one.getByRole('listbox', { name: '태그 필터', exact: true })
    await filterMenu.getByRole('option', { name: 'abc', exact: true }).click()
    assert.equal(await panel.locator('.task-filter-chip').filter({ hasText: 'abc' }).evaluate(el => el.style.getPropertyValue('--task-tag-hue')), '225', 'filter chips use the saved tag color')
    await filterMenu.getByRole('option', { name: 'bsas', exact: true }).click()
    assert.equal(await panel.locator('[data-task-id]').count(), 1, 'OR filter does not duplicate a shared task')
    await one.keyboard.press('Escape')
    const showCompleted = panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true })
    await showCompleted.uncheck()
    await tagged.getByRole('checkbox').click()
    await tagged.waitFor({ state: 'detached' })
    assert.equal(await panel.locator('[data-task-id]').count(), 0, 'completion and tag filters combine')
    await showCompleted.check()
    await tagged.waitFor()
    assert.equal(await panel.locator('[data-task-id]').count(), 1, 'show completed retains tag filtering')
    await tagged.getByRole('checkbox').uncheck()
    await panel.getByRole('button', { name: '모든 태그 필터 해제', exact: true }).click()
    await tagged.getByRole('button', { name: '파일 열기', exact: true }).waitFor()
    await tagged.getByRole('button', { name: '파일 열기', exact: true }).click()
    const stored = readTaskList(WORKSPACE_ROOT).find(task => task.id === taggedId)!
    assert.equal(await tagged.evaluate(el => (el.ownerDocument.defaultView as unknown as { openedTaskFile: string }).openedTaskFile), stored.path)
    let file = path.join(WORKSPACE_ROOT, stored.path!)
    assert.equal(stored.path, 'docs/tasks/분류 작업 @Ref #그대로.md')
    await fs.writeFile(file, `---\nid: ${stored.id}\ntitle: 외부에서 수정\ndone: true\ntags: [abc, 외부]\nstartDate: 2026-10-01\ndate: 2026-10-18\ncustom: keep\n---\n문서 본문\n`)
    await one.waitForFunction("Array.from(document.querySelectorAll('.task-panel textarea')).some(el=>el.value==='외부에서 수정')", null, { timeout: 2000 })
    await two.reload(); await two.locator('[data-dock-item=tasks]').tap()
    await mobile.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
    await two.setViewportSize({ width: 320, height: 844 })
    await two.locator('html').evaluate(el => el.classList.remove('dark'))
    const mobileRow = mobile.locator(`[data-task-id="${taggedId}"]`)
    await mobileRow.waitFor()
    await addTags(mobileRow, two, ['한글'])
    await mobileRow.locator('.task-tag-picker [aria-haspopup="dialog"]').first().tap()
    const mobilePicker = two.locator('.task-tag-picker-menu')
    assert.equal(await mobileRow.locator('.task-tag').filter({ hasText: 'abc' }).first().evaluate(el => el.style.getPropertyValue('--task-tag-hue')), '225', 'saved color survives reload in another window')
    await mobilePicker.getByRole('button', { name: '태그 색상: abc', exact: true }).tap()
    const mobilePalette = two.getByRole('dialog', { name: '태그 색상: abc', exact: true })
    const paletteBounds = (await mobilePalette.boundingBox())!
    assert.ok(paletteBounds.x >= 0 && paletteBounds.x + paletteBounds.width <= 320 && paletteBounds.y >= 0 && paletteBounds.y + paletteBounds.height <= 844)
    await two.screenshot({ path: '/tmp/mew-task-panel/mobile-tag-colors-light.png' })
    await two.keyboard.press('End')
    await two.keyboard.press('Enter')
    assert.equal(await mobilePalette.count(), 0)
    assert.equal(await mobileRow.locator('.task-tag').filter({ hasText: 'abc' }).first().evaluate(el => el.style.getPropertyValue('--task-tag-hue')), '325')
    assert.equal(await mobilePicker.getByRole('textbox', { name: '검색', exact: true }).getAttribute('placeholder'), '태그 검색')
    const searchColors = await mobilePicker.locator('.task-tag-picker-search').evaluate(el => {
      const view = el.ownerDocument.defaultView!
      return [view.getComputedStyle(el.querySelector('input')!, '::placeholder').color, view.getComputedStyle(el).backgroundColor]
    })
    assert.ok(tagContrast(searchColors[0], searchColors[1]) >= 4.5, 'unfocused mobile search placeholder remains readable')
    const box = (await mobilePicker.boundingBox())!
    assert.ok(box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 844)
    assert.equal(await mobile.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    await assertInlineTagAlignment(mobileRow)
    const lightPairs = await mobileRow.locator('.task-tag').evaluateAll(elements => elements.map(el => { const style = el.ownerDocument.defaultView!.getComputedStyle(el); return [style.color, style.backgroundColor] }))
    assert.ok(lightPairs.every(([color, background]) => tagContrast(color, background) >= 4.5))
    await two.screenshot({ path: '/tmp/mew-task-panel/mobile-tags-light.png' })
    await two.keyboard.press('Escape')
    await mobileRow.getByRole('textbox', { name: '태스크 내용', exact: true }).fill('제목 변경')
    await two.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    const oldFile = file
    const renamedTask = readTaskList(WORKSPACE_ROOT).find(task => task.id === taggedId)!
    assert.equal(renamedTask.path, 'docs/tasks/제목 변경.md')
    file = path.join(WORKSPACE_ROOT, renamedTask.path!)
    await assert.rejects(fs.stat(oldFile), /ENOENT/)
    await mobileRow.getByRole('button', { name: '파일 열기', exact: true }).tap()
    assert.equal(await mobileRow.evaluate(el => (el.ownerDocument.defaultView as unknown as { openedTaskFile: string }).openedTaskFile), renamedTask.path)
    const raw = await fs.readFile(file, 'utf8')
    assert.ok(!/^id:/m.test(raw), 'task documents do not expose internal IDs')
    assert.ok(raw.includes('title: 제목 변경') && raw.includes('custom: keep') && raw.endsWith('문서 본문\n'))
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
    await mobile.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
    await mobile.locator(`[data-task-id="${datedId}"] .task-date-status`).click()
    await two.getByRole('textbox', { name: '종료일', exact: true }).evaluate(el => new Promise<void>(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => resolve())))
    assert.equal(await two.getByRole('textbox', { name: '종료일', exact: true }).inputValue(), '2026-10-18')
    await two.keyboard.press('Escape')
    const firstTask = mobile.locator(`[data-task-id][data-done="false"]:not([data-task-id="${taggedId}"])`).first()
    await addTags(firstTask, two, ['cleanup'])
    const cleanupSaved = two.waitForResponse(async response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok() && (await response.json()).tasks.filter((task: { tags?: string[] }) => task.tags?.includes('cleanup')).length === 2)
    await addTags(mobile.locator(`[data-task-id="${taggedId}"]`), two, ['cleanup'])
    await cleanupSaved
    await mobile.getByRole('combobox', { name: '태그 필터', exact: true }).click()
    await two.getByRole('listbox', { name: '태그 필터', exact: true }).getByRole('option', { name: 'cleanup', exact: true }).click()
    await two.keyboard.press('Escape')
    await mobile.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).uncheck()
    assert.equal(await mobile.locator(`[data-task-id="${taggedId}"]`).count(), 0, 'completed tagged task is hidden before deletion')
    await mobile.locator('[data-task-id]').first().locator('.task-tag-picker [aria-haspopup="dialog"]').first().tap()
    const globalPicker = two.locator('.task-tag-picker-menu')
    const deleteSaved = two.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await globalPicker.getByRole('button', { name: '태그 전체 삭제: cleanup', exact: true }).tap()
    await deleteSaved
    assert.equal(readTaskList(WORKSPACE_ROOT).some(task => task.tags?.includes('cleanup')), false, 'delete removes the tag from every persisted task, including hidden completion')
    assert.equal(await mobile.locator('.task-filter-chip').filter({ hasText: 'cleanup' }).count(), 0, 'deleted filter is cleared')
    assert.equal(await globalPicker.getByRole('option', { name: 'cleanup', exact: true }).count(), 0)
    assert.ok(await mobile.locator('[data-task-id]').count() > 1, 'deleting an active filter keeps the task list usable')
    await two.screenshot({ path: '/tmp/mew-task-panel/mobile-delete-tag.png' })
    if (await globalPicker.count()) await two.keyboard.press('Escape')
    await mobile.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }).check()
    const readOnly = await browser.newPage()
    await readOnly.route('**/api/task-list?*', route => route.fulfill({ json: { tasks: readTaskList(WORKSPACE_ROOT), canEdit: false } }))
    await readOnly.goto(base); await readOnly.locator('[data-dock-item=tasks]').click()
    const readOnlyPanel = readOnly.getByRole('region', { name: '태스크', exact: true })
    const completionFilter = readOnlyPanel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true })
    assert.equal(await completionFilter.isDisabled(), false, 'read-only users can change visibility')
    await completionFilter.check()
    await readOnlyPanel.locator('[data-task-id]').nth(4).waitFor()
    assert.equal(await readOnlyPanel.getByRole('textbox', { name: '새 태스크' }).count(), 0)
    assert.equal(await readOnlyPanel.locator('[data-task-id]').first().getByRole('checkbox').isDisabled(), true)
    assert.equal(await readOnlyPanel.getByRole('textbox', { name: '태스크 내용', exact: true }).first().getAttribute('readonly'), '')
    assert.equal(await readOnlyPanel.getByRole('button', { name: '태스크 삭제' }).count(), 0)
    assert.equal(await readOnlyPanel.locator('.task-tag-remove').count(), 0)
    assert.equal(await readOnlyPanel.locator('.task-tag-delete').count(), 0)
    await assertInlineTagAlignment(readOnlyPanel.locator(`[data-task-id="${taggedId}"]`))
    assert.equal(await readOnlyPanel.locator('.task-tag-picker [aria-haspopup="dialog"]').first().count(), 0)
    await readOnlyPanel.locator(`[data-task-id="${taggedId}"]`).getByRole('button', { name: '파일 열기', exact: true }).click()
    assert.equal(await readOnlyPanel.evaluate(el => (el.ownerDocument.defaultView as unknown as { openedTaskFile: string }).openedTaskFile), renamedTask.path)
    await mobileRow.locator('textarea').press('Alt+Delete')
    await mobileRow.getByRole('button', { name: '태스크 삭제', exact: true }).tap()
    await two.waitForResponse(response => response.url().includes('/api/task-list') && response.request().method() === 'PATCH' && response.ok())
    await assert.rejects(fs.stat(file), /ENOENT/)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }) }
})
