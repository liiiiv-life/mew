import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')
test('table and database context menus convert whole blocks with native and collaborative undo/redo', { skip: !domBrowserExecutable(), timeout: 120_000 }, async t => {
  const originalId = '123e4567-e89b-12d3-a456-426614174000'
  const markdown = `Before\n\n| Name | Note |\n| --- | --- |\n| **Same** | first<br>second |\n| Same | [link](./note.md) |\n\nAfter\n\n<div data-mew-db="${originalId}" data-mew-db-readonly="true"></div>`
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';import * as Y from 'yjs';import {Awareness} from 'y-protocols/awareness';
import {Editor} from '${root}/packages/editor/src/Editor.tsx';import {prepareDatabaseTable} from '${root}/shared/database-table.ts';
import {setUiLocale} from '${root}/packages/ui/src/i18n-core.ts';setUiLocale('ko');
const ydoc=new Y.Doc(),collab=location.search.includes('collab')?{ydoc,awareness:new Awareness(ydoc),synced:true}:undefined;
const views=new Map([['${originalId}',{id:'${originalId}',title:'Source DB',kind:'external',editable:false,columns:[{id:'name',name:'제목',type:'text'},{id:'count',name:'수',type:'number'},{id:'done',name:'체크',type:'checkbox'}],rows:[{id:'a',pos:0,cells:{name:'One',count:42,done:true}},{id:'b',pos:1,cells:{name:'Two',count:3,done:false}}]}]]);
window.calls=[];const db={subscribe(){return()=>{}},list:async()=>[...views.values()],
async create(title,table){window.calls.push({kind:'create',table});if(window.failCreate)throw Error('생성 실패');const data=prepareDatabaseTable(table),id='223e4567-e89b-42d3-a456-'+String(window.calls.filter(call=>call.kind==='create').length).padStart(12,'0'),columns=data.columns.map((name,index)=>({id:'c'+index,name,type:'text',primary:index===0}));const view={id,title,kind:'managed',editable:true,columns,rows:data.rows.map((row,pos)=>({id:'r'+pos,pos,cells:Object.fromEntries(columns.map((c,i)=>[c.id,row[i]]))}))};views.set(id,view);window.created=id;return structuredClone(view)},
async getView(id,options){window.calls.push({kind:'get',id,allRows:options?.allRows===true});const view=structuredClone(views.get(id));if(id==='${originalId}'&&!options?.allRows)view.rows=view.rows.slice(0,1);return view},
async remove(id){window.calls.push({kind:'remove',id});views.delete(id)},async rename(){},async updateCell(id,rowId,columnId,value){views.get(id).rows.find(r=>r.id===rowId).cells[columnId]=value;return value}};
function Fixture(){const [value,setValue]=React.useState(${JSON.stringify(markdown)}),[readOnly,setReadOnly]=React.useState(false);window.saved=value;return <><button onClick={()=>setReadOnly(v=>!v)}>Readonly</button><div style={{height:740}}><Editor value={value} onChange={setValue} api={{db,fetchFile:async()=>({content:''})}} path="conversion.md" readOnly={readOnly} collab={collab} showMobileKeyBar={false}/></div></>};
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:conversion.tsx', write: false, platform: 'browser', output: { format: 'esm' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'conversion-fixture', resolveId(id) { if (id === 'virtual:conversion.tsx') return id }, async load(id) {
    if (id === 'virtual:conversion.tsx') return source
    if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
    if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
  } }] })
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const collaborative of [false, true]) for (const width of [1100, 390]) for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 500, isMobile: width < 500 })
    page.setDefaultTimeout(6000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.route('http://mew-conversion.test/**', route => route.fulfill(route.request().url().endsWith('/app.js') ? { contentType: 'text/javascript', body: code } : { contentType: 'text/html', body: `<!doctype html><html class="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
    await page.goto(`http://mew-conversion.test/${collaborative ? '?collab' : ''}`)
    const tables = page.locator('.tiptap table:not(.mew-database-table)')
    const matrix = () => tables.first().locator('tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent?.replace(/\u200b/g, ''))))
    const original = [['Name', 'Note'], ['Same', 'firstsecond'], ['Same', 'link']]
    await tables.first().waitFor()
    await page.getByRole('button', { name: 'Readonly', exact: true }).click()
    await tables.first().getByText('Name', { exact: true }).click({ button: 'right' })
    assert.equal(await page.getByRole('menuitem', { name: '데이터베이스로 전환', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Readonly', exact: true }).click()
    await page.evaluate('window.failCreate=true')
    await tables.first().getByText('Name', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '데이터베이스로 전환', exact: true }).click()
    await page.getByText('생성 실패', { exact: true }).waitFor()
    assert.deepEqual(await matrix(), original, 'failed creation leaves the original table intact')
    await page.evaluate('window.failCreate=false')
    await tables.first().getByText('Name', { exact: true }).click({ button: 'right' })
    await page.screenshot({ path: `/tmp/mew-conversion-${width}-${theme}-${collaborative}-table-menu.png`, fullPage: true })
    await page.getByRole('menuitem', { name: '데이터베이스로 전환', exact: true }).click()
    await page.locator('.mew-database-table').first().getByRole('textbox', { name: 'Name', exact: true }).first().waitFor()
    assert.equal(await page.getByText('생성 실패', { exact: true }).count(), 0, 'retry clears the previous conversion error')
    const createdId = await page.evaluate('window.created')
    assert.equal(await tables.count(), 0)
    assert.equal(await page.evaluate("window.calls.filter(call=>call.kind==='create').length"), 2)
    await page.keyboard.press('Control+z')
    await tables.first().waitFor()
    assert.deepEqual(await matrix(), original)
    assert.equal(await tables.first().locator('strong').textContent(), 'Same', 'undo restores rich text')
    await page.keyboard.press('Control+Shift+z')
    await page.locator('.mew-database-table').first().getByRole('textbox', { name: 'Name', exact: true }).first().waitFor()
    assert.equal(await page.evaluate('window.created'), createdId)
    assert.equal(await page.evaluate("window.calls.filter(call=>call.kind==='create').length"), 2, 'redo makes no new database request')
    await page.locator('.mew-database-table').first().getByRole('textbox', { name: 'Name', exact: true }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: '표로 전환', exact: true }).waitFor()
    assert.ok(await page.getByRole('menuitemcheckbox').count() > 0, 'column type actions remain available')
    await page.screenshot({ path: `/tmp/mew-conversion-${width}-${theme}-${collaborative}-db-menu.png`, fullPage: true })
    await page.getByRole('menuitem', { name: '표로 전환', exact: true }).click()
    await tables.first().waitFor()
    assert.deepEqual(await matrix(), [['제목', 'Name', 'Note'], ['항목 1', 'Same', 'firstsecond'], ['항목 2', 'Same', 'link']])
    await page.keyboard.press('Control+z')
    await page.locator('.mew-database-table').first().getByRole('textbox', { name: 'Name', exact: true }).first().waitFor()
    await page.keyboard.press('Control+Shift+z')
    await tables.first().waitFor()
    const sourceDb = page.locator('[data-db-surface]').filter({ hasText: 'Source DB' })
    await sourceDb.getByText('Source DB', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '표로 전환', exact: true }).click()
    await page.waitForFunction('document.querySelectorAll(".tiptap table:not(.mew-database-table)").length===2')
    const sourceMatrix = await tables.nth(1).locator('tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent)))
    assert.deepEqual(sourceMatrix, [['제목', '수', '체크'], ['One', '42', 'true'], ['Two', '3', 'false']], 'conversion fetches all rows, including those beyond the normal view limit')
    await page.keyboard.press('Control+z')
    await sourceDb.waitFor()
    await page.waitForFunction(`window.saved.includes('data-mew-db="${originalId}"')&&window.saved.includes('data-mew-db-readonly="true"')`)
    assert.equal(await page.evaluate("window.calls.filter(call=>call.kind==='remove').length"), 0)
    assert.equal(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth), true)
    assert.deepEqual(errors, [])
    await page.close()
  }
})
