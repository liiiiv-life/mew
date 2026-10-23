import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const repo = new URL('..', import.meta.url).pathname

test('table context menu inserts after the clicked cell and preserves readonly copying', { skip: !domBrowserExecutable(), timeout: 60_000 }, async t => {
  const markdown = 'Outside\n\n| H1 | H2 | H3 |\n| --- | --- | --- |\n| A1 | A2 | A3 |\n| B1 | B2 | B3 |\n\nBetween\n\n| X | Y |\n| --- | --- |\n| C | D |\n'
  const source = `import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {Editor} from '${repo}packages/editor/src/Editor.tsx';
    function Fixture(){const [readonly,setReadonly]=React.useState(false);
      return <><button onClick={()=>setReadonly(v=>!v)}>Readonly</button>
        <Editor value={${JSON.stringify(markdown)}} onChange={()=>{}} readOnly={readonly}
          api={{db:{},fetchFile:async()=>({content:''})}} path="table.md"/></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`
  const candidates = [source], styles: string[] = []
  const bundle = await build({ input: 'virtual:table-menu.tsx', write: false, platform: 'browser',
    output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'table-menu-fixture', resolveId(id) { if (id === 'virtual:table-menu.tsx') return id },
      load(id) {
        if (id === 'virtual:table-menu.tsx') return source
        if (id.endsWith('.tsx')) candidates.push(fs.readFileSync(id, 'utf8'))
        if (id.endsWith('.css')) { styles.push(fs.readFileSync(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const compiler = await compile(fs.readFileSync(`${repo}src/index.css`, 'utf8'), { base: `${repo}src`, onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } })
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { localStorage.setItem('mew:ui-locale', 'ko') })
    await page.route('http://mew-table-menu.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      return route.fulfill(url.pathname === '/app.js'
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    const tables = page.locator('.tiptap table')
    const row = page.getByRole('menuitem', { name: '행 추가', exact: true })
    const column = page.getByRole('menuitem', { name: '열 추가', exact: true })
    const matrix = () => tables.first().locator('tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent)))
    await page.goto('http://mew-table-menu.test/')
    await tables.first().getByText('H1', { exact: true }).click()
    // A different active cell and table must not determine the insertion point.
    await tables.nth(1).getByText('D', { exact: true }).click()
    await tables.first().getByText('A2', { exact: true }).click({ button: 'right' })
    await row.waitFor()
    for (const name of [/^md로 복사/, /^csv로 복사$/, /^이미지로 복사$/]) assert.equal(await page.getByRole('menuitem', { name, exact: true }).count(), 1)
    await page.screenshot({ path: `/tmp/mew-table-menu-${width}.png` })
    await page.keyboard.press('Enter')
    assert.deepEqual(await matrix(), [['H1', 'H2', 'H3'], ['A1', 'A2', 'A3'], ['', '', ''], ['B1', 'B2', 'B3']])
    assert.equal(await tables.nth(1).locator('tr').count(), 2)
    await tables.first().getByText('H2', { exact: true }).click({ button: 'right' })
    await column.click()
    assert.deepEqual(await matrix(), [['H1', 'H2', '', 'H3'], ['A1', 'A2', '', 'A3'], ['', '', '', ''], ['B1', 'B2', '', 'B3']])
    await tables.first().getByText('B3', { exact: true }).click({ button: 'right' })
    await row.click()
    assert.equal(await tables.first().locator('tr').count(), 5)
    await tables.first().getByText('B3', { exact: true }).click({ button: 'right' })
    await column.click()
    assert.equal(await tables.first().locator('tr').first().locator('th,td').count(), 5)
    const before = await matrix()
    await tables.first().getByText('H1', { exact: true }).click({ button: 'right' })
    await row.waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('menu').count(), 0)
    assert.deepEqual(await matrix(), before)
    await page.getByRole('button', { name: 'Readonly', exact: true }).click()
    await tables.first().getByText('H1', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^md로 복사/ }).waitFor()
    assert.equal(await row.count(), 0)
    assert.equal(await column.count(), 0)
    assert.equal(await page.getByRole('menuitem').count(), 3)
    assert.deepEqual(await matrix(), before)
    assert.deepEqual(errors, [])
    await page.close()
  }
})
