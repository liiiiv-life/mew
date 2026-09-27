import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('Hotview gutter follows typing, trailing paragraphs and frontmatter on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const initial = '---\ntitle: test\nupdated: 2026-09-27\n---\n\n첫 문단\n\n마지막 문단'
  const codeContent = '---\ntitle: test\n---\n\n# 제목\n\n```txt\n코드\n```'
  const tableContent = '앞 문단\n\n| 이름 | 설명 |\n| --- | --- |\n| 항목 | 내용 |\n\n뒤 문단'
  const editorPath = new URL('../packages/editor/src/Editor.tsx', import.meta.url).pathname
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {Editor} from ${JSON.stringify(editorPath)};
const api={db:{},fetchFile:async()=>({content:''}),fetchLinkPreview:async()=>({title:null,description:null})};
function Fixture(){
  const [value,setValue]=React.useState(${JSON.stringify(initial)});
  window.value=value;
  return <><button onClick={()=>setValue(v=>v.replace('title: test','title: test\\nextra: field'))}>Add property</button>
    <button onClick={()=>setValue(${JSON.stringify(codeContent)})}>Load code</button>
    <button onClick={()=>setValue(${JSON.stringify(tableContent)})}>Load table</button>
    <div style={{height:600}}><Editor value={value} onChange={setValue} api={api} path="fixture.md"/></div></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const styles: string[] = []
  const bundle = await build({
    input: 'virtual:gutter.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'gutter-fixture',
      resolveId(id) { if (id === 'virtual:gutter.tsx') return id },
      async load(id) {
        if (id === 'virtual:gutter.tsx') return source
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const root = path.resolve(import.meta.dirname, '..')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const css = compiler.build([...new Set((source + await fs.readFile(editorPath, 'utf8')).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-gutter.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-gutter.test/')
      const expectNumbers = async (expected: string[]) => {
        await page.waitForFunction(`expected => JSON.stringify(Array.from(document.querySelectorAll('.tiptap [data-mew-line-numbers]'), el => el.getAttribute('data-mew-line-numbers'))) === JSON.stringify(expected)`, expected, { timeout: 5000 })
        const numbers = await page.locator('.tiptap [data-mew-line-numbers]').evaluateAll(elements => elements.map(el => ({
          number: el.getAttribute('data-mew-line-numbers'), content: el.ownerDocument.defaultView!.getComputedStyle(el, '::before').content,
        })))
        assert.ok(numbers.every(({ number, content }) => content === `"${number}"`), 'CSS displays the mapped Markdown numbers')
      }
      await expectNumbers(['6', '8'])
      await page.getByRole('button', { name: 'Add property', exact: true }).click()
      await expectNumbers(['7', '9'])
      const paragraphs = page.locator('.tiptap > p')
      await paragraphs.first().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('middle')
      await expectNumbers(['7', '9', '11'])
      await page.keyboard.press('Home')
      await page.keyboard.press('Backspace')
      await expectNumbers(['7', '9'])
      await page.keyboard.press('ControlOrMeta+z')
      await expectNumbers(['7', '9', '11'])
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expectNumbers(['7', '9'])
      await paragraphs.last().click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await expectNumbers(['7', '9', '11'])
      await page.keyboard.type('tail')
      await expectNumbers(['7', '9', '11'])
      await page.getByRole('button', { name: 'Load code', exact: true }).click()
      await expectNumbers(['5', '7', '11'])
      await paragraphs.last().click()
      await page.keyboard.type('after code')
      await expectNumbers(['5', '7', '11'])
      if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/line-numbers-${viewport.width}.png` })
      await page.getByRole('button', { name: 'Load table', exact: true }).click()
      await expectNumbers(['1', '3', '7'])
      const wrapper = page.locator('.tiptap > .tableWrapper')
      const geometry = await wrapper.evaluate(el => {
        const win = el.ownerDocument.defaultView!
        const editor = el.parentElement!
        const number = win.getComputedStyle(el, '::before')
        const rect = el.getBoundingClientRect()
        return {
          left: rect.left,
          tableLeft: el.querySelector('table')!.getBoundingClientRect().left,
          textLeft: editor.querySelector('p')!.getBoundingClientRect().left,
          numberRight: editor.getBoundingClientRect().left + parseFloat(number.left) + parseFloat(number.width),
        }
      })
      assert.ok(Math.abs(geometry.left - geometry.textLeft) < 1, 'table container starts at the body column')
      assert.ok(Math.abs(geometry.tableLeft - geometry.left) < 1, 'no padding before the table')
      assert.ok(geometry.left > geometry.numberRight, 'the line number stays outside the table container')
      // Force an overflowing table even on desktop, then verify only its contents move.
      await wrapper.locator('table').evaluate(el => { el.style.minWidth = '1800px' })
      await wrapper.evaluate(el => { el.scrollLeft = 160 })
      assert.equal(await wrapper.evaluate(el => el.scrollLeft), 160)
      assert.equal((await wrapper.boundingBox())!.x, geometry.left)
      assert.ok((await wrapper.locator('table').boundingBox())!.x < geometry.left)
      await expectNumbers(['1', '3', '7'])
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > window.innerWidth'), false)
      if (process.env.MEW_EDITOR_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MEW_EDITOR_SCREENSHOT_DIR}/table-gutter-${viewport.width}.png` })
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
