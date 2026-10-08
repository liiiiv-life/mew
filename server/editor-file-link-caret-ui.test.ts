import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('file link arrow navigation keeps a visible caret after selectionchange on desktop and mobile', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const content = '[문서홈](./home.md)\n\n앞 [문서홈](./home.md) 뒤\n\n[첫 문서](./one.md)[둘째 문서](./two.md)'
  const source = `
import React from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {Editor} from ${JSON.stringify(new URL('../packages/editor/src/Editor.tsx', import.meta.url).pathname)};
const api={db:{},fetchFile:async()=>({content:''}),fetchLinkPreview:async()=>({title:null,description:null})};
function Fixture(){
  const [value,setValue]=React.useState(${JSON.stringify(content)});
  window.value=value;
  return <><button onClick={()=>setValue(${JSON.stringify(content)})}>Reset</button>
    <div style={{height:600}}><Editor value={value} onChange={setValue} api={api} path="fixture.md"/></div></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const styles: string[] = []
  const bundle = await build({
    input: 'virtual:caret.tsx', write: false, platform: 'browser', output: { format: 'esm' },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'caret-fixture',
      resolveId(id) { if (id === 'virtual:caret.tsx') return id },
      async load(id) {
        if (id === 'virtual:caret.tsx') return source
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-caret.test/**', route => route.fulfill(route.request().url().endsWith('/app.js')
        ? { contentType: 'text/javascript', body: chunk.code }
        : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.join('\n')}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-caret.test/')
      for (const index of [0, 1, 2, 3]) {
        for (const direction of ['left', 'right']) {
          await page.getByRole('button', { name: 'Reset', exact: true }).click()
          await page.waitForFunction(`window.value === ${JSON.stringify(content)} && document.querySelectorAll('.tiptap a[data-file-link]').length === 4`)
          const link = page.locator('.tiptap a[data-file-link]').nth(index)
          await link.evaluate(async (el, direction) => {
            const doc = el.ownerDocument
            ;(el.closest('.tiptap') as typeof el).focus()
            const range = doc.createRange()
            if (direction === 'left') range.setStartAfter(el)
            else range.setStartBefore(el)
            range.collapse(true)
            const selection = doc.getSelection()!
            selection.removeAllRanges(); selection.addRange(range)
            await new Promise(resolve => doc.defaultView!.requestAnimationFrame(() => doc.defaultView!.requestAnimationFrame(resolve)))
          }, direction)
          // Cross, return and cross again to exercise both directions without refocusing.
          const forwardKey = direction === 'left' ? 'ArrowLeft' : 'ArrowRight'
          for (const key of [forwardKey, direction === 'left' ? 'ArrowRight' : 'ArrowLeft', forwardKey]) {
            await page.keyboard.press(key)
            await link.evaluate(el => new Promise(resolve => el.ownerDocument.defaultView!.requestAnimationFrame(() => el.ownerDocument.defaultView!.requestAnimationFrame(resolve))))
            const caret = await link.evaluate(el => {
              const selection = el.ownerDocument.getSelection()!
              const node = selection.focusNode!
              const parent = node.nodeType === 3 ? node.parentElement : node as typeof el
              const rect = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
              const linkRect = el.getBoundingClientRect()
              return { collapsed: selection.isCollapsed, insideLink: !!parent?.closest('a[data-file-link]'),
                height: rect?.height ?? 0, x: rect?.x ?? 0, left: linkRect.left, right: linkRect.right }
            })
            assert.equal(caret.collapsed, true)
            assert.equal(caret.insideLink, false, `${viewport.width}px link ${index} after ${key}`)
            assert.ok(caret.height > 0, `visible caret after ${key}`)
            assert.ok(key === 'ArrowLeft' ? caret.x <= caret.left : caret.x >= caret.right, `caret crosses the whole link after ${key}`)
          }
          const label = await link.textContent()
          const href = await link.getAttribute('href')
          await page.keyboard.insertText('Z한')
          await page.waitForFunction(`({label, href, direction}) => window.value.includes(direction === 'left' ? 'Z한['+label+']' : '['+label+']('+href+')Z한')`, { label, href, direction })
          assert.equal(await link.textContent(), label)
          assert.doesNotMatch(await page.evaluate('window.value') as string, /\u200b|mew-file-link-caret/)
        }
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
