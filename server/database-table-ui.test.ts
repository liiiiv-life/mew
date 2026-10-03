import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('database table retains compact styling inside the editor and standalone panel', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const source = `import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {DatabaseTable} from ${JSON.stringify(path.join(root, 'packages/editor/src/database/DatabaseTable.tsx'))};
const ctrl={view:{title:'Tasks',kind:'managed',columns:[{id:'name',name:'Name',type:'text'}],rows:[{id:'a',cells:{name:'Review'}}]},editable:true,loading:false,error:null,addRow(){},setTitleDraft(){},renameTitle(){},localCell(){},commitCell(){}};
createRoot(document.getElementById('root')).render(<><div className="tiptap"><DatabaseTable ctrl={ctrl}/><div className="tableWrapper"><table><thead><tr><th>Markdown</th></tr></thead><tbody><tr><td>Body</td></tr></tbody></table></div></div><div id="panel"><DatabaseTable ctrl={ctrl}/></div></>);`
  const candidates = [source]
  const bundle = await build({ input: 'virtual:database.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{ name: 'database-fixture', resolveId(id) { if (id === 'virtual:database.tsx') return id }, async load(id) {
      if (id === 'virtual:database.tsx') return source
      if (id.endsWith('.tsx')) candidates.push(await fs.readFile(id, 'utf8'))
    } }],
  })
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set(candidates.join('\n').match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + await fs.readFile(path.join(root, 'packages/editor/src/editor/editor.css'), 'utf8')
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const width of [390, 1100]) for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, isMobile: width < 500, hasTouch: width < 500 })
      await page.route('http://mew-db.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: bundle.output.find(o => o.type === 'chunk')!.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-db.test/')
      await page.locator('.mew-database-table').first().waitFor()
      const measure = (selector: string) => page.locator(selector).evaluate(table => {
        const win = table.ownerDocument.defaultView!
        const cell = win.getComputedStyle(table.querySelector('td')!)
        const head = win.getComputedStyle(table.querySelector('th')!)
        const container = win.getComputedStyle(table.parentElement!.parentElement!)
        return { padding: cell.padding, background: head.backgroundColor, fillsContainer: Math.abs(table.getBoundingClientRect().width - table.parentElement!.getBoundingClientRect().width) < 1, radius: container.borderRadius, surface: container.backgroundColor }
      })
      const editor = await measure('.tiptap .mew-database-table')
      const panel = await measure('#panel .mew-database-table')
      assert.deepEqual(editor, panel, `${width}px ${theme}: editor and standalone table styles match`)
      assert.equal(editor.fillsContainer, true)
      assert.equal(editor.padding, '0px')
      assert.equal(editor.background, 'rgba(0, 0, 0, 0)')
      assert.equal(editor.radius, '2px')
      const markdown = await measure('.tableWrapper table')
      assert.notEqual(markdown.padding, editor.padding, 'Markdown table keeps its own cell spacing')
      assert.notEqual(markdown.background, editor.background, 'Markdown table keeps its header surface')
      await page.close()
    }
  } finally { await browser.close() }
})
