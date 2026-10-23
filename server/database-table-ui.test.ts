import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

async function databaseFixture(source: string) {
  const candidates = [source]
  const bundle = await build({ input: 'virtual:database.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'database-fixture', resolveId(id) {
      if (id === 'virtual:database.tsx') return id
      if (/\.css(?:\?inline)?$/.test(id)) return 'virtual:database-style'
    }, async load(id) {
      if (id === 'virtual:database.tsx') return source
      if (id === 'virtual:database-style') return 'export default ""'
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
    } }],
  })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  return {
    code: bundle.output.find(o => o.type === 'chunk')!.code,
    css: compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(path.join(root, 'packages/editor/src/editor/editor.css'), 'utf8'),
  }
}

test('document property option colors, rename and deletion persist in standalone and DB-bound fields', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {FrontmatterPanel} from ${JSON.stringify(path.join(root, 'packages/editor/src/editor/FrontmatterPanel.tsx'))};
import {splitFrontmatter,joinFrontmatter} from ${JSON.stringify(path.join(root, 'packages/editor/src/utils/frontmatter.ts'))};
import {editSelection} from ${JSON.stringify(path.join(root, 'shared/selection-options.ts'))};
const bound=location.search.includes('bound');
const columns=[{id:'status',name:'status',type:'select',options:['Draft','Done'],optionColors:{}},{id:'tags',name:'tags',type:'multi_select',options:['One','Two'],optionColors:{}}];
const db={getView:async()=>({columns:structuredClone(columns)}),async editColumnOption(id,columnId,option,edit){const col=columns.find(c=>c.id===columnId);if(window.failEdit)throw Error('Save failed');const next=editSelection(col.options,col.optionColors,option,edit);Object.assign(col,{options:next.options,optionColors:next.optionColors});return structuredClone(col)}};
const api={fetch:async key=>[...columns.find(c=>c.name===key).options],fetchColors:async key=>({...columns.find(c=>c.name===key).optionColors}),async update(key,change){if(window.failEdit)throw Error('Save failed');const col=columns.find(c=>c.name===key);col.options=[...new Set([...col.options,...change.add])].filter(v=>!change.remove.includes(v));col.optionColors={...col.optionColors,...change.optionColors};return [...col.options]}};
const initial={title:'Example',fields:[{key:'status',type:'select',value:'Draft',options:['Draft','Done']},{key:'tags',type:'multi-select',value:'["One","Two"]',options:['One','Two']},...(bound?[{key:'_mew_database',value:'db'},{key:'_mew_row',value:'row'}]:[])]};
function Fixture(){const [value,setValue]=React.useState(joinFrontmatter(initial,'Body'));const [key,setKey]=React.useState(0);window.saved=value;return <><button onClick={()=>setKey(k=>k+1)}>Reload</button><FrontmatterPanel key={key} data={splitFrontmatter(value).frontmatter} optionsApi={bound?undefined:api} databaseApi={db} onChange={next=>setValue(joinFrontmatter(next,'Body'))}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const { code, css } = await databaseFixture(source)
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) for (const bound of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 })
      page.setDefaultTimeout(4000)
      await page.route('http://mew-db.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: code }
        : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto(`http://mew-db.test/${bound ? '?bound' : ''}`)
      await page.getByRole('combobox', { name: 'status', exact: true }).click()
      const choices = page.getByRole('dialog', { name: 'status', exact: true })
      await choices.getByRole('button', { name: 'Draft 색상', exact: true }).click()
      await choices.getByRole('button', { name: '색상 12', exact: true }).click()
      await choices.getByRole('button', { name: 'Draft 항목 편집', exact: true }).click()
      await choices.getByRole('textbox', { name: '항목 이름', exact: true }).fill('In progress')
      await choices.getByRole('textbox', { name: '항목 이름', exact: true }).press('Enter')
      await choices.getByRole('option', { name: 'In progress', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Reload', exact: true }).click()
      const status = page.locator('.frontmatter-property').filter({ has: page.getByRole('combobox', { name: 'status', exact: true }) })
      assert.equal(await status.locator('.frontmatter-choice-tag').evaluate(el => el.style.getPropertyValue('--option-hue')), '210')
      await page.getByRole('combobox', { name: 'status', exact: true }).click()
      await choices.getByRole('button', { name: 'In progress 항목 삭제', exact: true }).click()
      await choices.getByRole('option', { name: 'In progress', exact: true }).waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('combobox', { name: 'status', exact: true }).textContent(), '선택')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'tags', exact: true }).click()
      const tags = page.getByRole('dialog', { name: 'tags', exact: true })
      await page.evaluate('window.failEdit = true')
      await tags.getByRole('button', { name: 'One 항목 삭제', exact: true }).click()
      await page.getByRole('alert').first().waitFor()
      assert.equal(await page.getByRole('button', { name: 'tags', exact: true }).textContent(), 'OneTwo')
      await page.evaluate('window.failEdit = false')
      await tags.getByRole('button', { name: 'One 항목 삭제', exact: true }).click()
      await tags.getByRole('option', { name: 'One', exact: true }).waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('button', { name: 'tags', exact: true }).textContent(), 'Two')
      await page.close()
    }
  } finally { await browser.close() }
})

test('database table retains compact styling inside the editor and standalone panel', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {DatabaseTable} from ${JSON.stringify(path.join(root, 'packages/editor/src/database/DatabaseTable.tsx'))};
function Fixture(){const [name,setName]=React.useState('Review');const [editable,setEditable]=React.useState(true);const [title,setTitle]=React.useState('Tasks');
const ctrl={view:{title,kind:'managed',columns:[{id:'name',name:'Name',type:'text'},{id:'age',name:'Age',type:'number'}],rows:[{id:'a',cells:{name,age:7}},{id:'b',cells:{name:'Hi',age:8}}]},editable,loading:false,error:null,addRow(){},setTitleDraft:setTitle,renameTitle(){},localCell(row,col,value){if(col==='name')setName(value)},commitCell(){}};
return <><button onClick={()=>setEditable(false)}>Read only</button><div className="tiptap"><DatabaseTable ctrl={ctrl}/><div className="tableWrapper"><table><thead><tr><th>Markdown</th></tr></thead><tbody><tr><td>Body</td></tr></tbody></table></div></div><div id="panel"><DatabaseTable ctrl={ctrl}/></div></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const { code, css } = await databaseFixture(source)
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [390, 1100]) for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, isMobile: width < 500, hasTouch: width < 500 })
      await page.route('http://mew-db.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: code }
        : { contentType: 'text/html', body: `<!doctype html><html class="${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-db.test/')
      await page.locator('.mew-database-table').first().waitFor()
      const measure = (selector: string) => page.locator(selector).evaluate(table => {
        const win = table.ownerDocument.defaultView!
        const cell = win.getComputedStyle(table.querySelector('td')!)
        const head = win.getComputedStyle(table.querySelector('th')!)
        const container = win.getComputedStyle(table.parentElement!.parentElement!)
        const title = win.getComputedStyle(table.parentElement!.parentElement!.firstElementChild!)
        const grid = win.getComputedStyle(table.parentElement!)
        const header = win.getComputedStyle(table.querySelector('thead')!)
        return { padding: cell.padding, background: head.backgroundColor, headerSurface: header.backgroundColor, titleSurface: title.backgroundColor,
          cellBorder: cell.borderRightColor, border: container.borderWidth, titleBorder: title.borderWidth, gridBorder: grid.borderColor,
          fillsHost: Math.abs(table.parentElement!.parentElement!.getBoundingClientRect().width - table.parentElement!.parentElement!.parentElement!.getBoundingClientRect().width) < 1,
          fillsContainer: Math.abs(table.getBoundingClientRect().width - table.parentElement!.clientWidth) < 1, radius: grid.borderRadius, surface: container.backgroundColor }
      })
      const editor = await measure('.tiptap .mew-database-table')
      const panel = await measure('#panel .mew-database-table')
      assert.deepEqual(editor, panel, `${width}px ${theme}: editor and standalone table styles match`)
      assert.equal(editor.fillsContainer, true, 'the database container hugs the table without unused space')
      assert.equal(editor.fillsHost, false, 'short database blocks do not fill the editor width')
      assert.equal(editor.padding, '0px')
      assert.equal(editor.background, 'rgba(0, 0, 0, 0)')
      assert.equal(editor.radius, '6px')
      const markdown = await measure('.tableWrapper table')
      assert.notEqual(markdown.padding, editor.padding, 'Markdown table keeps its own cell spacing')
      assert.notEqual(markdown.background, editor.background, 'Markdown table keeps its header surface')
      assert.match(editor.headerSurface, /(?:\/ |, )0\.2\)$/, 'column headers use a 20% surface tint')
      assert.equal(editor.titleSurface, 'rgba(0, 0, 0, 0)', 'the title blends into the document')
      assert.equal(editor.cellBorder, markdown.cellBorder, 'database grid lines match the Markdown table borders')
      assert.equal(editor.gridBorder, markdown.cellBorder, 'only the table grid has an outer border')
      assert.equal(editor.border, '0px', 'the database block has no border')
      assert.equal(editor.titleBorder, '0px', 'the title has no border')
      const sortedTable = page.locator('.tiptap .mew-database-table')
      const names = async () => Promise.all((await sortedTable.locator('tbody tr td:first-child input').all()).map(input => input.inputValue()))
      const sortClick = async (label: string) => {
        const button = sortedTable.getByRole('button', { name: label, exact: true })
        if (width < 500) await button.tap()
        else await button.click()
      }
      await sortClick('Name 오름차순 정렬')
      assert.deepEqual(await names(), ['Hi', 'Review'])
      assert.equal(await sortedTable.locator('th').first().getAttribute('aria-sort'), 'ascending')
      assert.equal(await page.locator('#panel .mew-database-table th').first().getAttribute('aria-sort'), 'none', 'each displayed table owns its sorting')
      await sortClick('Name 내림차순 정렬')
      assert.deepEqual(await names(), ['Review', 'Hi'])
      await sortClick('Name 정렬 해제')
      assert.equal(await sortedTable.locator('th').first().getAttribute('aria-sort'), 'none')
      await sortClick('Age 오름차순 정렬')
      await sortedTable.getByRole('button', { name: 'Age 내림차순 정렬', exact: true }).focus()
      await page.keyboard.press('Enter')
      assert.deepEqual(await names(), ['Hi', 'Review'])
      await sortClick('Age 정렬 해제')
      assert.deepEqual(await names(), ['Review', 'Hi'])
      await page.screenshot({ path: `/tmp/mew-db-sort-${width}-${theme}.png` })
      await page.locator('.tiptap').getByRole('textbox').first().fill('A database title much longer than its table '.repeat(8))
      const longTitle = await measure('.tiptap .mew-database-table')
      assert.equal(longTitle.fillsContainer, true, 'a long title does not stretch the database beyond the table')
      assert.equal(longTitle.fillsHost, false, 'a long title does not force full editor width')
      const table = page.locator('.tiptap .mew-database-table')
      const longValue = '내용에 맞춰 가로로 늘어나는 데이터베이스 열 '.repeat(12)
      await table.getByRole('textbox', { name: 'Name', exact: true }).first().fill(longValue)
      const assertScroll = async () => {
        for (const selector of ['.tiptap .mew-database-table', '#panel .mew-database-table']) {
          const bounds = await page.locator(selector).evaluate(table => {
            const scroller = table.parentElement!, win = table.ownerDocument.defaultView!
            const cells = table.querySelectorAll('tbody tr:first-child td')
            scroller.scrollLeft = scroller.scrollWidth
            return { width: table.getBoundingClientRect().width, overflow: scroller.scrollWidth > scroller.clientWidth,
              scrollLeft: scroller.scrollLeft, overflowX: win.getComputedStyle(scroller).overflowX,
              nameWidth: cells[0].getBoundingClientRect().width, ageWidth: cells[1].getBoundingClientRect().width,
              pageWidth: table.ownerDocument.documentElement.scrollWidth }
          })
          assert.ok(bounds.width > width, `${selector}: long values expand the table beyond the viewport`)
          assert.ok(bounds.nameWidth > bounds.ageWidth * 3, 'each column follows its own content width')
          assert.equal(bounds.overflowX, 'auto')
          assert.equal(bounds.overflow, true)
          assert.ok(bounds.scrollLeft > 0, 'overflow is scrollable inside the database')
          assert.ok(bounds.pageWidth <= width, 'the document itself does not overflow')
        }
      }
      await assertScroll()
      await page.getByRole('button', { name: 'Read only', exact: true }).click()
      await assertScroll()
      await sortClick('Name 오름차순 정렬')
      assert.equal(await sortedTable.locator('th').first().getAttribute('aria-sort'), 'ascending', 'read-only tables also allow local sorting')
      await page.close()
    }
  } finally { await browser.close() }
})

test('database column types, creatable choices, page links and failed edits work on desktop and touch layouts', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {DatabaseTable} from ${JSON.stringify(path.join(root, 'packages/editor/src/database/DatabaseTable.tsx'))};
import {useDatabaseView} from ${JSON.stringify(path.join(root, 'packages/editor/src/database/useDatabaseView.ts'))};
import {editSelection} from ${JSON.stringify(path.join(root, 'shared/selection-options.ts'))};
let view={id:'db',title:'People',kind:'managed',editable:true,columns:[{id:'name',name:'제목',type:'text',primary:true},{id:'status',name:'상태',type:'text'},{id:'tags',name:'태그',type:'multi_select',options:['개발','문서']}],rows:[{id:'a',pos:0,cells:{name:'송상훈',status:'초안',tags:['개발']}}]};
const clone=()=>structuredClone(view), listeners=new Set();
const api={getView:async()=>clone(),subscribe(id,fn){listeners.add(fn);return()=>listeners.delete(fn)},
async changeColumnType(id,columnId,type){view.columns=view.columns.map(c=>c.id===columnId?{...c,type,options:type==='select'?['초안']:c.options}:c);if(type==='page')view.rows[0].pagePath='People/송상훈.md';listeners.forEach(fn=>fn({type:'schema',columns:clone().columns}));return clone().columns.find(c=>c.id===columnId)},
async updateColumnOptions(id,columnId,options){view.columns=view.columns.map(c=>c.id===columnId?{...c,options}:c);return clone().columns.find(c=>c.id===columnId)},
async editColumnOption(id,columnId,option,edit){const column=view.columns.find(c=>c.id===columnId);const next=editSelection(column.options??[],column.optionColors??{},option,edit);Object.assign(column,{options:next.options,optionColors:next.optionColors});for(const row of view.rows){const value=row.cells[columnId];row.cells[columnId]=Array.isArray(value)?value.flatMap(v=>v===option?edit.remove?[]:[next.name]:[v]):value===option?edit.remove?null:next.name:value;}listeners.forEach(fn=>fn({type:'schema',columns:clone().columns}));return clone().columns.find(c=>c.id===columnId)},
async updateCell(id,rowId,columnId,value){if(columnId==='name'&&!String(value).trim())throw Error('대표열 값은 필수입니다');view.rows[0].cells[columnId]=value;return value},
async addColumn(id,name,type){if(view.columns.some(c=>c.name===name))throw Error('열 이름 중복');const col={id:'new'+view.columns.length,name,type};view.columns.push(col);return col}};
function Fixture(){const ctrl=useDatabaseView(api,'db');return <DatabaseTable ctrl={ctrl} onOpenPage={path=>window.openedPage=path}/>}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const { code, css } = await databaseFixture(source)
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, isMobile: width < 500, hasTouch: width < 500 })
      page.setDefaultTimeout(4000)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-db.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: code }
        : { contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-db.test/')
      const title = page.getByRole('textbox', { name: '제목', exact: true })
      await title.waitFor()
      assert.equal(await title.getAttribute('required'), '')
      assert.equal(await page.locator('thead th').first().getByRole('button', { name: '열 삭제', exact: true }).count(), 0)
      await title.focus()
      await page.keyboard.press('Shift+F10')
      const menu = page.getByRole('menu', { name: '열 타입 변경', exact: true })
      assert.deepEqual(await menu.getByRole('menuitemcheckbox').allTextContents(), ['텍스트', '페이지'])
      await page.keyboard.press('Escape')
      assert.equal(await title.evaluate(el => el === el.ownerDocument.activeElement), true)

      await page.getByRole('textbox', { name: '상태', exact: true }).click({ button: 'right' })
      assert.equal(await menu.getByRole('menuitemcheckbox', { name: '페이지', exact: true }).count(), 0)
      await menu.getByRole('menuitemcheckbox', { name: '단일선택', exact: true }).click()
      await page.getByRole('combobox', { name: '상태', exact: true }).click()
      assert.equal(await page.getByRole('option').first().evaluate(el => el.getBoundingClientRect().height), width < 500 ? 24 : 20, 'single-select options use compact desktop and touch spacing')
      await page.getByRole('combobox', { name: '검색 또는 새 항목', exact: true }).fill('진행')
      await page.getByRole('option', { name: '“진행” 추가', exact: true }).click()
      assert.equal(await page.getByRole('combobox', { name: '상태', exact: true }).textContent(), '진행')
      await page.getByRole('combobox', { name: '상태', exact: true }).click()
      assert.equal(await page.getByRole('option', { name: '진행', exact: true }).getAttribute('aria-selected'), 'true')
      await page.keyboard.press('Escape')

      await page.locator('tbody').getByRole('button', { name: '태그', exact: true }).click()
      assert.equal(await page.getByRole('option').first().evaluate(el => el.getBoundingClientRect().height), width < 500 ? 24 : 20, 'multi-select options use the same compact spacing')
      await page.getByRole('option', { name: '문서', exact: true }).click()
      assert.equal(await page.getByRole('option', { name: '문서', exact: true }).getAttribute('aria-selected'), 'true')
      await page.getByRole('option', { name: '개발', exact: true }).click()
      assert.equal(await page.getByRole('option', { name: '개발', exact: true }).getAttribute('aria-selected'), 'false')
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('tbody').getByRole('button', { name: '태그', exact: true }).textContent(), '문서')

      await page.locator('tbody').getByRole('button', { name: '태그', exact: true }).click()
      await page.getByRole('button', { name: '문서 색상', exact: true }).click()
      await page.getByRole('button', { name: '색상 12', exact: true }).click()
      await page.getByRole('button', { name: '문서 항목 편집', exact: true }).click()
      await page.getByRole('textbox', { name: '항목 이름', exact: true }).fill('문서화')
      await page.getByRole('textbox', { name: '항목 이름', exact: true }).press('Enter')
      await page.getByRole('option', { name: '문서화', exact: true }).waitFor()
      assert.equal(await page.locator('tbody .frontmatter-choice-tag').filter({ hasText: '문서화' }).evaluate(el => el.style.getPropertyValue('--option-hue')), '210')
      await page.getByRole('button', { name: '문서화 항목 삭제', exact: true }).click()
      await page.getByRole('option', { name: '문서화', exact: true }).waitFor({ state: 'detached' })
      assert.equal(await page.locator('tbody').getByRole('button', { name: '태그', exact: true }).textContent(), '선택')
      await page.keyboard.press('Escape')
      await page.getByRole('combobox', { name: '상태', exact: true }).click()
      await page.getByRole('button', { name: '진행 항목 편집', exact: true }).click()
      await page.getByRole('textbox', { name: '항목 이름', exact: true }).fill('진행 중')
      await page.getByRole('textbox', { name: '항목 이름', exact: true }).press('Enter')
      await page.getByRole('option', { name: '진행 중', exact: true }).waitFor()
      assert.equal(await page.getByRole('combobox', { name: '상태', exact: true }).textContent(), '진행 중')
      await page.getByRole('button', { name: '진행 중 항목 삭제', exact: true }).click()
      await page.getByRole('option', { name: '진행 중', exact: true }).waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('combobox', { name: '상태', exact: true }).textContent(), '선택')
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: '제목 열 타입 변경', exact: true }).click()
      await menu.getByRole('menuitemcheckbox', { name: '페이지', exact: true }).click()
      await page.getByRole('button', { name: '송상훈 페이지 열기', exact: true }).click()
      assert.equal(await page.locator('body').evaluate(el => Reflect.get(el.ownerDocument.defaultView!, 'openedPage')), 'People/송상훈.md')
      assert.equal(await title.evaluate(input => {
        const cell = input.closest('td')!.getBoundingClientRect(), bounds = input.getBoundingClientRect()
        return bounds.left >= cell.left && bounds.right <= cell.right
      }), true, 'the page title input stays inside its own column')
      const pageButton = page.getByRole('button', { name: '송상훈 페이지 열기', exact: true })
      await pageButton.locator('svg path').click({ button: 'right' })
      await menu.waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await pageButton.evaluate(el => el === el.ownerDocument.activeElement), true, 'SVG context menus restore the enclosing button')
      await title.fill('')
      await title.press('Tab')
      await page.getByRole('alert').filter({ hasText: '대표열 값은 필수입니다' }).waitFor()
      assert.equal(await title.inputValue(), '송상훈', 'rejected edit reloads the saved primary value')
      assert.equal(await page.locator('.mew-database-table').count(), 1, 'failed edits keep the table available')
      await page.getByRole('button', { name: '제목 열 타입 변경', exact: true }).click()
      const bounds = await menu.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'type menu fits the viewport')
      await page.keyboard.press('Escape')
      for (const name of ['텍스트', '텍스트 2']) {
        await page.getByRole('button', { name: '열 추가', exact: true }).click()
        await page.getByRole('menu', { name: '열 추가', exact: true }).getByRole('menuitem', { name: '텍스트', exact: true }).click()
        await page.locator('thead').getByRole('button', { name, exact: true }).waitFor()
      }
      assert.equal(await page.locator('select, datalist').count(), 0)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
