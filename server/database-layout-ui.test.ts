import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('database cards, board and calendar share editing, search, persistence and read-only behavior', { skip: !domBrowserExecutable(), timeout: 90_000 }, async t => {
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {DatabaseCollection} from '${root}/packages/editor/src/database/DatabaseCollection.tsx';
import {useDatabaseView} from '${root}/packages/editor/src/database/useDatabaseView.ts';
import {setUiLocale} from '${root}/packages/ui/src/i18n-core.ts';
setUiLocale('ko');
const now=new Date(),year=now.getFullYear(),month=String(now.getMonth()+1).padStart(2,'0'),day=String(now.getDate()).padStart(2,'0');window.today=year+'-'+month+'-'+day;
const date=n=>year+'-'+month+'-'+String(n).padStart(2,'0');
let view={id:'layout-demo',title:'작은 팀의 다음 장',kind:'managed',editable:true,columns:[{id:'title',name:'제목',type:'page'},{id:'note',name:'메모',type:'text'},{id:'status',name:'상태',type:'select',options:['준비','진행','완료'],optionColors:{'준비':210,'진행':270,'완료':140}},{id:'date',name:'일정',type:'date'},{id:'hours',name:'시간',type:'number'}],rows:[
{id:'a',pos:0,pagePath:'People/a.md',cells:{title:'여름 북클럽',note:'서로의 밑줄에서 시작하는 작은 대화. 다음 모임에서 나눌 질문을 모아요.',status:'진행',date:window.today,hours:2}},
{id:'b',pos:1,cells:{title:'브랜드 리서치',note:'우리가 좋아하는 작업과 브랜드를 한곳에. 다음 프로젝트의 재료가 됩니다.',status:'준비',date:date(10),hours:5}},
{id:'c',pos:2,cells:{title:'독서 기록 정리',note:'이번 달 읽은 책의 핵심과 다음에 실천할 내용을 정리합니다.',status:null,date:null,hours:3}},
{id:'d',pos:3,cells:{title:'출시 체크리스트',note:'작게 만들어 빠르게 확인하는 첫 번째 릴리스.',status:'완료',date:date(18),hours:8}},
{id:'e',pos:4,cells:{title:'팀 회고',note:'잘한 점, 배운 점, 다음에 바꿀 점.',status:'준비',date:date(24),hours:1}},
{id:'f',pos:5,cells:{title:'다음 실험',note:'새로운 시도를 위한 가설과 관찰 기록.',status:'진행',date:date(28),hours:4}}]};
if(location.search.includes('narrow')){view.columns=[view.columns[0]];view.rows=[{id:'a',pos:0,cells:{title:'A'}}]}else{const saved=sessionStorage.getItem('fixture-columns');if(saved)view.columns=JSON.parse(saved)}
const clone=()=>structuredClone(view),listeners=new Set();window.calls=[];const emit=event=>listeners.forEach(fn=>fn(event));
const api={getView:async()=>clone(),subscribe(id,fn){listeners.add(fn);return()=>listeners.delete(fn)},
async insertRow(){const row={id:'new'+view.rows.length,pos:view.rows.length,cells:{title:'제목 없음'}};view.rows.push(row);window.calls.push({kind:'insert'});return structuredClone(row)},
async updateCell(id,rowId,columnId,value){if(window.failSave)throw Error('저장에 실패했습니다');view.rows.find(r=>r.id===rowId).cells[columnId]=value;window.calls.push({kind:'cell',rowId,columnId,value});emit({type:'row.update',rowId,columnId,value});return value},
async deleteRow(id,rowId){view.rows=view.rows.filter(r=>r.id!==rowId);window.calls.push({kind:'delete'});emit({type:'row.delete',rowId})},
async addColumn(id,name,type){if(window.failAdd)throw Error('열 추가 실패');if(window.holdAdd)await new Promise(resolve=>{window.finishAdd=()=>{window.holdAdd=false;resolve()}});const col={id:type+view.columns.length,name,type};view.columns.push(col);window.calls.push({kind:'column',...col});sessionStorage.setItem('fixture-columns',JSON.stringify(view.columns));emit({type:'schema',columns:clone().columns});return col},
async rename(id,title){view.title=title},async renameColumn(id,col,name){view.columns.find(c=>c.id===col).name=name;return clone().columns.find(c=>c.id===col)},
async updateColumnOptions(id,col,options){view.columns.find(c=>c.id===col).options=options;return clone().columns.find(c=>c.id===col)}};
window.setRowTitle=value=>api.updateCell('layout-demo','a','title',value);
function Fixture(){const [readonly,setReadonly]=React.useState(false);const ctrl=useDatabaseView(api,'layout-demo',readonly);return <main className="mx-auto max-w-6xl p-3 sm:p-6"><div className="mb-4 flex items-center justify-between"><span className="text-sm text-ink-muted">프로젝트 노트</span><button className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover" onClick={()=>setReadonly(v=>!v)}>읽기 전용 전환</button></div><DatabaseCollection ctrl={ctrl} onOpenPage={path=>window.openedPage=path}/></main>};
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source]
  const bundle = await build({ input: 'virtual:database-layout.tsx', write: false, platform: 'browser', output: { format: 'esm' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'database-layout-fixture', resolveId(id) { if (id === 'virtual:database-layout.tsx') return id; if (/\.css(?:\?inline)?$/.test(id)) return 'virtual:empty-css' }, async load(id) { if (id === 'virtual:database-layout.tsx') return source; if (id === 'virtual:empty-css') return 'export default ""'; if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8')) } }],
  })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const dateCss = (await Promise.all(['date-field.css', 'date-calendar.css'].map(name => fs.readFile(`${root}/packages/ui/src/${name}`, 'utf8')))).join('\n')
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g)), ...Array.from(dateCss.matchAll(/--color-([a-z-]+)/g), match => `bg-${match[1]}`)]) + await fs.readFile(`${root}/packages/editor/src/editor/editor.css`, 'utf8') + dateCss
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const width of [1100, 390]) for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: width < 500 })
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-layout.test/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: code } : { contentType: 'text/html', body: `<!doctype html><html class="${theme}" lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{font-family:system-ui,sans-serif}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
    await page.goto('http://mew-layout.test/')
    const tab = (name: string) => page.getByRole('tab', { name, exact: true })
    await page.locator('.mew-database-table').waitFor()
    const borders = await page.locator('[data-db-surface]').evaluate(element => {
      const win = element.ownerDocument.defaultView!
      return [element, element.firstElementChild!, element.querySelector('[role="tablist"]')!.parentElement!.parentElement!].map(node => win.getComputedStyle(node).borderWidth)
    })
    assert.deepEqual(borders, ['0px', '0px', '0px'], 'the collection, title and view controls have no borders')
    await page.screenshot({ path: `/tmp/mew-db-layout-${width}-${theme}-table.png`, fullPage: true })
    await tab('카드').click()
    await page.locator('[data-db-card="a"]').waitFor()
    assert.equal(await page.locator('[data-db-card]').count(), 6)
    await page.screenshot({ path: `/tmp/mew-db-layout-${width}-${theme}-cards.png`, fullPage: true })
    await page.locator('[data-db-card="a"]').getByRole('button', { name: '페이지 열기', exact: true }).click()
    assert.equal(await page.evaluate('window.openedPage'), 'People/a.md')
    await page.getByRole('button', { name: '항목 열기: 여름 북클럽', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '여름 북클럽', exact: true })
    await dialog.getByRole('textbox', { name: '메모', exact: true }).fill('새로운 모임 메모')
    await dialog.getByRole('textbox', { name: '메모', exact: true }).press('Tab')
    await page.keyboard.press('Escape')
    await page.locator('[data-db-card="a"]').getByText('새로운 모임 메모', { exact: true }).waitFor()
    if (width === 1100 && theme === 'dark') {
      await page.getByRole('button', { name: '항목 열기: 여름 북클럽', exact: true }).click()
      await page.screenshot({ path: '/tmp/mew-db-layout-detail-desktop.png', fullPage: true })
      await page.evaluate('window.failSave=true')
      await page.getByRole('dialog').getByRole('textbox', { name: '메모', exact: true }).fill('실패할 수정')
      await page.getByRole('dialog').getByRole('textbox', { name: '메모', exact: true }).press('Tab')
      await page.getByRole('dialog').getByRole('alert').getByText('저장에 실패했습니다', { exact: true }).waitFor()
      await page.evaluate('window.failSave=false')
      await page.keyboard.press('Escape')
    }
    await page.getByRole('button', { name: '검색', exact: true }).click()
    await page.getByRole('textbox', { name: '데이터베이스 검색', exact: true }).fill('리서치')
    assert.equal(await page.locator('[data-db-card]').count(), 1)
    await page.getByRole('button', { name: '검색', exact: true }).click()
    await tab('보드').click()
    await page.getByRole('combobox', { name: '그룹 기준', exact: true }).waitFor()
    assert.equal(await page.locator('[data-db-group]').count(), 4)
    if (width > 500) {
      await page.locator('[data-db-card="a"]').dragTo(page.locator('[data-db-group="\\"완료\\""]'))
      await page.waitForFunction('window.calls.some(call=>call.rowId==="a"&&call.columnId==="status"&&call.value==="완료")')
    }
    await page.screenshot({ path: `/tmp/mew-db-layout-${width}-${theme}-board.png`, fullPage: true })
    await tab('캘린더').click()
    await page.getByRole('combobox', { name: '종료일', exact: true }).waitFor()
    assert.equal(await page.locator('[data-db-day]').count(), 42)
    assert.equal(await page.locator('[data-db-day]').first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).borderWidth), '0px')
    await page.getByRole('region', { name: '날짜 없음', exact: true }).getByRole('button', { name: '항목 열기: 독서 기록 정리', exact: true }).waitFor()
    const today = await page.evaluate('window.today') as string
    const prefix = today.slice(0, 7)
    const eventOnDay = (day: string) => page.locator(`[data-db-day="${day}"]`).getByRole('button', { name: '항목 열기: 여름 북클럽', exact: true })
    await eventOnDay(today).click()
    assert.equal(await page.getByRole('dialog').locator('.task-range-summary[data-single]').count(), 1, 'one date column keeps single-date editing')
    await page.keyboard.press('Escape')
    const startField = page.getByRole('combobox', { name: '시작일', exact: true })
    if (width === 1100 && theme === 'dark') {
      await page.evaluate('window.failAdd=true')
      await startField.click()
      await page.getByRole('option', { name: '열 추가', exact: true }).click()
      await page.getByRole('alert').getByText('열 추가 실패', { exact: true }).waitFor()
      assert.match(await startField.innerText(), /날짜 없음/)
      await page.evaluate('window.failAdd=false')
      await page.evaluate('window.holdAdd=true')
    }
    await startField.click()
    await page.getByRole('option', { name: '열 추가', exact: true }).click()
    if (width === 1100 && theme === 'dark') {
      await page.waitForFunction("typeof window.finishAdd==='function'")
      await tab('표').click()
      await page.evaluate('window.finishAdd()')
      await page.waitForFunction("window.calls.some(call=>call.kind==='column'&&call.name==='시작일')")
      assert.equal(await tab('표').getAttribute('aria-selected'), 'true', 'a delayed column creation preserves newer view choices')
      await tab('캘린더').click()
    }
    await page.waitForFunction("window.calls.some(call=>call.kind==='column'&&call.name==='시작일')")
    const startColumn = await page.evaluate("window.calls.find(call=>call.kind==='column'&&call.name==='시작일').id") as string
    const fieldStyle = await startField.evaluate(element => {
      const win = element.ownerDocument.defaultView!, style = win.getComputedStyle(element)
      return { border: style.borderWidth, display: style.display, focusable: element.tabIndex === 0, minHeight: Number.parseFloat(style.minHeight) }
    })
    assert.equal(fieldStyle.border, '0px')
    assert.equal(fieldStyle.display, 'flex')
    assert.equal(fieldStyle.focusable, true)
    assert.ok(fieldStyle.minHeight >= (width < 500 ? 40 : 32), 'borderless date fields retain usable click and touch targets')
    await eventOnDay(today).click()
    const range = page.getByRole('dialog').locator('.task-range-calendar')
    const chooseDate = async (day: string) => {
      const button = range.locator(`[data-date="${day}"]`)
      if (width < 500) await button.tap()
      else await button.click()
    }
    await chooseDate(`${prefix}-05`)
    await chooseDate(`${prefix}-08`)
    assert.equal(await range.getByRole('textbox', { name: '시작일', exact: true }).inputValue(), `${prefix}-05`)
    assert.equal(await range.getByRole('textbox', { name: '종료일', exact: true }).inputValue(), `${prefix}-08`)
    await page.screenshot({ path: `/tmp/mew-db-layout-${width}-${theme}-period.png`, fullPage: true })
    await page.keyboard.press('Escape')
    for (const day of ['05', '06', '07', '08']) await eventOnDay(`${prefix}-${day}`).waitFor()
    assert.equal(await eventOnDay(`${prefix}-04`).count(), 0)
    assert.equal(await eventOnDay(`${prefix}-09`).count(), 0)
    await page.screenshot({ path: `/tmp/mew-db-layout-${width}-${theme}-calendar.png`, fullPage: true })
    await tab('간트').click()
    const gantt = page.getByRole('region', { name: '간트', exact: true })
    const bar = page.locator('[data-db-gantt-bar="a"]')
    assert.equal(await page.locator('[data-db-gantt-row]').count(), 6)
    assert.equal(await page.locator('[data-db-gantt-row="c"]').getByText('날짜 없음', { exact: true }).count(), 1)
    const beforeUndated = await page.evaluate('window.calls.length')
    await page.locator('[data-db-gantt-row="c"]').getByRole('button', { name: '날짜 없음', exact: true }).click()
    await page.getByRole('dialog', { name: '독서 기록 정리', exact: true }).waitFor()
    assert.equal(await page.evaluate('window.calls.length'), beforeUndated, 'opening an undated row does not draw or save a schedule')
    await page.keyboard.press('Escape')
    await bar.focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(`window.calls.some(call=>call.rowId==='a'&&call.columnId==='date'&&call.value==='${prefix}-09')`)
    await page.keyboard.press('Shift+ArrowRight')
    await page.waitForFunction(`window.calls.some(call=>call.rowId==='a'&&call.columnId==='date'&&call.value==='${prefix}-10')`)
    await bar.click()
    assert.equal(await range.getByRole('textbox', { name: '시작일', exact: true }).inputValue(), `${prefix}-06`)
    await page.keyboard.press('Escape')
    if (width === 1100 && theme === 'dark') {
      const handle = await bar.locator('[data-db-gantt-resize="end"]').boundingBox()
      assert.ok(handle)
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + handle.width / 2 + 48, handle.y + handle.height / 2, { steps: 4 })
      await page.mouse.up()
      await page.waitForFunction(`window.calls.some(call=>call.rowId==='a'&&call.columnId==='date'&&call.value==='${prefix}-12')`)
      const plot = await page.locator('[data-db-gantt-row="c"] > div').boundingBox()
      assert.ok(plot)
      await page.mouse.move(plot.x + 60, plot.y + 18)
      await page.mouse.down()
      await page.mouse.move(plot.x + 108, plot.y + 18, { steps: 4 })
      await page.mouse.up()
      await page.waitForFunction(`window.calls.some(call=>call.rowId==='c'&&call.columnId==='date'&&call.value==='${prefix}-05')`)
    }
    await gantt.getByRole('button', { name: '전체', exact: true }).click()
    assert.equal(await gantt.getByRole('button', { name: '전체', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.screenshot({ path: `/tmp/mew-db-layout-${width}-${theme}-gantt.png`, fullPage: true })
    await gantt.getByRole('button', { name: '오늘', exact: true }).click()
    await page.reload()
    await page.getByRole('tab', { name: '간트', exact: true, selected: true }).waitFor()
    await page.getByRole('button', { name: '읽기 전용 전환', exact: true }).click()
    const ganttCalls = await page.evaluate('window.calls.length')
    await bar.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.evaluate('window.calls.length'), ganttCalls, 'read-only Gantt never writes')
    assert.equal(await page.locator('[data-db-gantt-resize]').count(), 0)
    await page.getByRole('button', { name: '읽기 전용 전환', exact: true }).click()
    await tab('캘린더').click()
    await eventOnDay(today).click()
    await chooseDate(`${prefix}-05`)
    await chooseDate(`${prefix}-08`)
    await page.keyboard.press('Escape')
    await eventOnDay(`${prefix}-05`).click()
    await range.getByRole('button', { name: '일정 지우기', exact: true }).click()
    await page.waitForFunction(`window.calls.some(call=>call.rowId==='a'&&call.columnId==='${startColumn}'&&call.value===null)&&window.calls.some(call=>call.rowId==='a'&&call.columnId==='date'&&call.value===null)`)
    await page.keyboard.press('Escape')
    await page.getByRole('region', { name: '날짜 없음', exact: true }).getByRole('button', { name: '항목 열기: 여름 북클럽', exact: true }).click()
    await chooseDate(today)
    await chooseDate(today)
    await page.keyboard.press('Escape')
    const longTitle = '달력의 선택 날짜 목록에서 긴 제목도 생략 없이 읽을 수 있도록 줄바꿈합니다. '.repeat(6).trim()
    await page.locator('html').evaluate((element, title) => (element.ownerDocument.defaultView as unknown as { setRowTitle: (title: string) => void }).setRowTitle(title), longTitle)
    const agenda = page.locator('[data-db-agenda]').getByRole('button', { name: `항목 열기: ${longTitle}`, exact: true })
    await agenda.waitFor()
    const wrapping = await agenda.evaluate(element => ({ whiteSpace: element.ownerDocument.defaultView!.getComputedStyle(element).whiteSpace, fits: element.scrollWidth <= element.clientWidth }))
    assert.deepEqual(wrapping, { whiteSpace: 'normal', fits: true })
    const dayButton = page.locator(`[data-db-day="${today}"]`).getByRole('button', { name: /년|요일/ }).first()
    if (await dayButton.getAttribute('aria-pressed') !== 'true') await dayButton.click()
    await page.getByRole('button', { name: '행 추가', exact: true }).first().click()
    await page.getByRole('dialog', { name: '제목 없음', exact: true }).waitFor()
    assert.equal(await page.evaluate(`window.calls.some(call=>call.columnId==='date'&&call.value==='${today}')`), true)
    assert.equal(await page.evaluate(`window.calls.some(call=>call.rowId?.startsWith('new')&&call.columnId==='${startColumn}'&&call.value==='${today}')`), true, 'new events initialize both dates')
    await page.getByRole('dialog', { name: '제목 없음', exact: true }).getByRole('button', { name: '행 삭제', exact: true }).click()
    await page.getByRole('dialog', { name: '항목을 삭제할까요?', exact: true }).getByRole('button', { name: '삭제', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '다음 달', exact: true }).click()
    await page.getByRole('button', { name: '이전 달', exact: true }).click()
    await page.reload()
    await tab('캘린더').waitFor()
    assert.equal(await tab('캘린더').getAttribute('aria-selected'), 'true', 'popup layout survives reload')
    assert.match(await startField.innerText(), /시작일/, 'the selected start-date column survives reload')
    await page.getByRole('button', { name: '읽기 전용 전환', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '행 추가', exact: true }).count(), 0)
    await startField.click()
    assert.equal(await page.getByRole('option', { name: '열 추가', exact: true }).count(), 0, 'read-only calendars cannot create columns')
    await page.keyboard.press('Escape')
    await eventOnDay(today).click()
    assert.equal(await range.getByRole('textbox', { name: '시작일', exact: true }).getAttribute('readonly'), '')
    const before = await page.evaluate('window.calls.length')
    const readOnlyDay = range.locator(`[data-date="${prefix}-05"]`)
    assert.equal(await readOnlyDay.getAttribute('aria-disabled'), 'true')
    await readOnlyDay.click({ force: true })
    assert.equal(await page.evaluate('window.calls.length'), before, 'read-only date clicks do not write')
    await page.keyboard.press('Escape')
    await tab('카드').click()
    await page.getByRole('button', { name: '항목 열기: 여름 북클럽', exact: true }).click()
    assert.equal(await page.getByRole('dialog').getByRole('textbox').count(), 0)
    assert.equal(await page.getByRole('dialog').getByRole('button', { name: '행 삭제', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('select,datalist').count(), 0)
    const pageWidth = await page.locator('html').evaluate(element => element.scrollWidth)
    assert.ok(pageWidth <= width, `${width}px ${theme}: alternate views do not overflow the page`)
    assert.deepEqual(errors, [])
    await page.close()
  }
  const narrow = await browser.newPage({ viewport: { width: 320, height: 800 }, hasTouch: true, isMobile: true })
  await narrow.route('http://mew-layout.test/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: code } : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
  await narrow.goto('http://mew-layout.test/?narrow')
  await narrow.locator('.mew-database-table').waitFor()
  await narrow.getByRole('button', { name: '읽기 전용 전환', exact: true }).click()
  await narrow.getByRole('button', { name: '검색', exact: true }).click()
  await narrow.getByRole('textbox', { name: '데이터베이스 검색', exact: true }).fill('A')
  for (const name of ['카드', '표', '보드', '표', '캘린더', '간트', '표']) await narrow.getByRole('tab', { name, exact: true }).tap()
  const bounds = await narrow.locator('[data-db-surface]').evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))
  for (const button of await narrow.getByRole('tab').all()) {
    const rect = await button.boundingBox()
    assert.ok(rect && rect.x >= bounds.left && rect.x + rect.width <= bounds.right, 'all view tabs fit a one-column read-only table')
  }
  await narrow.screenshot({ path: '/tmp/mew-db-layout-320-narrow.png', fullPage: true })
  await narrow.getByRole('tab', { name: '표', exact: true }).focus()
  await narrow.keyboard.press('ArrowRight')
  assert.equal(await narrow.getByRole('tab', { name: '카드', exact: true }).getAttribute('aria-selected'), 'true')
  await narrow.getByRole('button', { name: '읽기 전용 전환', exact: true }).click()
  await narrow.getByRole('tab', { name: '보드', exact: true }).click()
  await narrow.getByRole('button', { name: '선택 열 추가', exact: true }).click()
  await narrow.getByRole('combobox', { name: '그룹 기준', exact: true }).waitFor()
  await narrow.getByRole('tab', { name: '캘린더', exact: true }).click()
  await narrow.getByRole('button', { name: '날짜 열 추가', exact: true }).click()
  assert.equal(await narrow.locator('[data-db-day]').count(), 42)
  await narrow.close()
})
