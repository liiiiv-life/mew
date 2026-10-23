import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('task sorting supports ordered rules, directions, removal, keyboard, touch and read-only without saving task order', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {TaskPanel} from '${root}/src/components/task-panel.tsx';import {I18nProvider} from '${root}/src/i18n.tsx';
localStorage.setItem('mew:locale','ko');
const initial=[{id:'one',text:'Z',tags:['b'],date:'2026-10-12',done:false},{id:'two',text:'B',tags:['a'],date:'2026-10-11',done:false},{id:'three',text:'A',tags:['a'],date:'2026-10-10',done:false},{id:'four',text:'A',tags:['a'],date:'2026-10-13',done:false},{id:'missing',text:'C',done:false},{id:'done',text:'Completed',tags:['a'],done:true}];
function Fixture(){const [tasks,setTasks]=useState(initial),[canEdit,setCanEdit]=useState(true),[draft,setDraft]=useState(''),[draftTags,setDraftTags]=useState([]),[draftAssignees,setDraftAssignees]=useState([]),[writes,setWrites]=useState(0),[workspace,setWorkspace]=useState('one');
const session={tasks,canEdit,draft,draftTags,draftAssignees,setDraft,setDraftTags,setDraftAssignees,tagColors:{},edit:next=>{setTasks(next);setWrites(n=>n+1)},flush:async()=>{},retry:async()=>{}};
return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}><div><button id='readonly' onClick={()=>setCanEdit(!canEdit)}>Read only</button><button id='workspace' onClick={()=>setWorkspace('two')}>Workspace</button><output hidden id='writes'>{writes}</output><output hidden id='stored'>{tasks.map(t=>t.id).join(',')}</output></div><div style={{flex:1,minHeight:0}}><TaskPanel workspace={workspace} session={session} onClose={()=>{}}/></div></div>}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture/></I18nProvider>);`
  const bundle = await build({ input: 'virtual:sort.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:sort.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:sort.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const files = ['src/components/task-panel.tsx', 'src/components/task-sort-picker.tsx', 'src/components/task-text.tsx', 'src/components/task-tag-filter.tsx', 'packages/ui/src/select-field.tsx', 'src/components/DockWorkspace.tsx']
  const ui = (await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + ui).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(`${root}/src/components/task-panel.css`, 'utf8') + await fs.readFile(`${root}/packages/ui/src/date-field.css`, 'utf8') + await fs.readFile(`${root}/packages/ui/src/date-calendar.css`, 'utf8')
  const app = express()
  app.get('/api/member-profiles', (_req, res) => res.json({ members: [] }))
  app.get('/app.js', (_req, res) => res.type('js').send(bundle.output.find(item => item.type === 'chunk')!.code))
  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`))
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const errors: string[] = []
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: { width: mobile ? 320 : 1100, height: 800 }, hasTouch: mobile, isMobile: mobile })
      await page.clock.install({ time: new Date('2026-10-07T12:00:00+09:00') })
      page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}`)
      if (!mobile) await page.locator('html').evaluate(el => el.classList.add('dark'))
      const panel = page.getByRole('region', { name: '태스크', exact: true })
      const order = () => panel.locator('[data-task-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-task-id')))
      const initial = await order()
      const trigger = panel.getByRole('button', { name: '목록 정렬', exact: true })
      const popup = page.getByRole('dialog', { name: '목록 정렬', exact: true })
      const press = async (locator: ReturnType<typeof page.getByRole>) => mobile ? locator.tap() : locator.click()
      assert.deepEqual(initial, ['three', 'two', 'four', 'one', 'missing'], 'default is tags then schedule proximity')
      assert.deepEqual(await panel.locator('.task-check').first().evaluate(el => {
        const style = el.ownerDocument.defaultView!.getComputedStyle(el)
        return [style.cursor, style.touchAction]
      }), ['pointer', 'manipulation'], 'sorted checkboxes retain tapping and touch scrolling')
      await press(trigger)
      assert.equal(await popup.getByRole('combobox', { name: '정렬 기준 1', exact: true }).textContent(), '태그')
      assert.equal(await popup.getByRole('combobox', { name: '정렬 기준 2', exact: true }).textContent(), '일정 우선순위')
      assert.equal(await popup.getByRole('button', { name: '기본값으로 되돌리기', exact: true }).isDisabled(), true)
      await press(popup.getByRole('combobox', { name: '정렬 기준 2', exact: true }))
      await press(popup.getByRole('option', { name: '제목', exact: true }))
      assert.deepEqual(await order(), ['three', 'four', 'two', 'one', 'missing'])
      await press(popup.getByRole('combobox', { name: '정렬 기준 1', exact: true }))
      assert.equal(await popup.getByRole('option', { name: '제목', exact: true }).getAttribute('aria-disabled'), 'true', 'duplicate fields are unavailable')
      await page.keyboard.press('Escape')
      assert.equal(await popup.isVisible(), true, 'Esc closes the nested choice first')
      await press(popup.getByRole('button', { name: '정렬 조건 추가', exact: true }))
      await press(popup.getByRole('combobox', { name: '정렬 기준 3', exact: true }))
      await press(popup.getByRole('option', { name: '마감일', exact: true }))
      await press(popup.getByRole('combobox', { name: '정렬 방향 3', exact: true }))
      await press(popup.getByRole('option', { name: '늦은 날짜순', exact: true }))
      assert.deepEqual(await order(), ['four', 'three', 'two', 'one', 'missing'], 'third rule breaks ties after tag and title')
      for (let i = 0; i < 3; i++) await press(popup.getByRole('button', { name: '정렬 조건 추가', exact: true }))
      assert.equal(await popup.getByRole('button', { name: '정렬 조건 추가', exact: true }).count(), 0)
      for (const index of [6, 5, 4]) await press(popup.getByRole('button', { name: `정렬 조건 ${index} 삭제`, exact: true }))
      assert.equal(await page.locator('select, datalist').count(), 0)
      assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      const bounds = (await popup.boundingBox())!
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (mobile ? 320 : 1100))
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 800)
      await fs.mkdir('/tmp/mew-task-sort', { recursive: true })
      await page.screenshot({ path: `/tmp/mew-task-sort/${mobile ? 'mobile-light' : 'desktop-dark'}.png` })
      await press(popup.getByRole('button', { name: '닫기', exact: true }))
      assert.equal(await trigger.evaluate(el => el === el.ownerDocument.activeElement), true)
      const check = panel.locator('[data-task-id=four] input[type=checkbox]')
      await check.focus(); await check.press('Alt+ArrowDown')
      assert.equal(await page.locator('#writes').textContent(), '0', 'manual reorder is suspended during sorting')
      await press(panel.getByRole('combobox', { name: '태그 필터', exact: true }))
      await press(page.getByRole('option', { name: 'a', exact: true }))
      await page.keyboard.press('Escape')
      assert.deepEqual(await order(), ['four', 'three', 'two'])
      await press(panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }))
      assert.deepEqual(await order(), ['four', 'three', 'two', 'done'])
      await press(panel.getByRole('button', { name: '모든 태그 필터 해제', exact: true }))
      await press(panel.getByRole('checkbox', { name: '완료된 항목 보기', exact: true }))
      await press(page.locator('#readonly'))
      await press(trigger)
      const direction = popup.getByRole('combobox', { name: '정렬 방향 1', exact: true })
      await direction.focus(); await direction.press('ArrowDown'); await direction.press('End'); await direction.press('Enter')
      assert.deepEqual(await order(), ['one', 'four', 'three', 'two', 'missing'], 'read-only supports keyboard sorting')
      await press(popup.getByRole('button', { name: '정렬 조건 1 삭제', exact: true }))
      assert.deepEqual(await order(), ['four', 'three', 'two', 'missing', 'one'], 'remaining rules retain their priority')
      await page.keyboard.press('Escape')
      await press(panel.getByRole('tab', { name: '간트', exact: true }))
      assert.equal(await trigger.count(), 0, 'sorting belongs to the list view')
      assert.deepEqual(await panel.locator('.task-gantt-label:not(.task-gantt-new) button').allTextContents(), ['Z', 'B', 'A', 'A', 'C'], 'Gantt retains stored order')
      await press(panel.getByRole('tab', { name: '목록', exact: true }))
      assert.deepEqual(await order(), ['four', 'three', 'two', 'missing', 'one'], 'view changes retain list sort rules')
      await press(trigger)
      await press(popup.getByRole('button', { name: '정렬 조건 2 삭제', exact: true }))
      await press(popup.getByRole('button', { name: '정렬 조건 1 삭제', exact: true }))
      assert.deepEqual(await order(), ['one', 'two', 'three', 'four', 'missing'], 'removing all rules restores legacy date-status ordering')
      assert.equal(await popup.getByText('날짜 상태순', { exact: true }).count(), 1)
      await press(popup.getByRole('button', { name: '정렬 조건 추가', exact: true }))
      await press(popup.getByRole('combobox', { name: '정렬 기준 1', exact: true }))
      await press(popup.getByRole('option', { name: '제목', exact: true }))
      assert.deepEqual(await order(), ['three', 'four', 'two', 'missing', 'one'])
      await press(popup.getByRole('button', { name: '닫기', exact: true }))
      await press(page.locator('#workspace'))
      await popup.waitFor({ state: 'hidden' })
      await panel.locator('[data-task-id="two"]:nth-child(2)').waitFor()
      assert.deepEqual(await order(), initial, 'workspace changes restore tags then schedule defaults')
      await press(trigger)
      await press(popup.getByRole('button', { name: '정렬 조건 2 삭제', exact: true }))
      await press(popup.getByRole('button', { name: '기본값으로 되돌리기', exact: true }))
      assert.deepEqual(await order(), initial, 'reset restores both default rules')
      assert.equal(await page.locator('#writes').textContent(), '0')
      assert.equal(await page.locator('#stored').textContent(), 'one,two,three,four,missing,done', 'all hidden tasks and stored order survive sorting')
      await page.close()
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
