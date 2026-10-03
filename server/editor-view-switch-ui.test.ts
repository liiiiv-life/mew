import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('Hotview and Plain keep the visible source line across repeated switches', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const content = ['---', 'title: switch', '---', '', '', ...Array.from({ length: 200 }, (_, i) => `문단 ${i + 1}: 본문 **강조**와 내용\n`)].join('\n')
  const panePath = new URL('../src/components/EditorPane.tsx', import.meta.url).pathname
  const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {EditorPane} from ${JSON.stringify(panePath)};
import {I18nProvider} from ${JSON.stringify(new URL('../src/i18n.tsx', import.meta.url).pathname)};
const noop=()=>{};
const callbacks=Object.fromEntries(['registerHandle','registerElement','registerTabBar','onFocus','onActivate','onPin','onCloseTab','onReorder','onOpenLink','onOpenHistory','onSetTocOpen','onOpenSidebar','onTabDragMove','onTabDrop'].map(k=>[k,noop]));
function Fixture(){
  const [value,setValue]=React.useState(${JSON.stringify(content)});
  const [viewMode,setMode]=React.useState('hotview');
  window.value=value;
  return <div className="flex h-dvh flex-col"><EditorPane {...callbacks}
    pane={{id:'fixture',activePath:'fixture.md',tabs:[{path:'fixture.md',content:value,viewMode,editable:true,preview:false}]}}
    onChangeContent={(_,v)=>setValue(v)} onSetViewMode={(_,mode)=>setMode(mode)}
    role="guest" authEmail={null} project="docs" tree={[]} presence={{}} focused isGuest showSidebarButton={false} tocOpen={false} dropZone={null}/></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const styles: string[] = []
  const bundle = await build({
    input: 'virtual:switch.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'switch-fixture',
      resolveId(id) { if (id === 'virtual:switch.tsx') return id },
      async load(id) {
        if (id === 'virtual:switch.tsx') return source
        if (id.endsWith('.css')) { styles.push(await fs.readFile(id, 'utf8')); return { code: '', moduleType: 'js' } }
      },
    }],
  })
  const root = path.resolve(import.meta.dirname, '..')
  const compiler = await compile(await fs.readFile(path.join(root, 'src/index.css'), 'utf8'), { base: path.join(root, 'src'), onDependency() {} })
  const sources = await Promise.all(['src/components/EditorPane.tsx', 'src/components/TabBar.tsx', 'packages/editor/src/Editor.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))
  const css = compiler.build([...new Set((source + sources.join('\n')).match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + styles.join('\n')
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-switch.test/**', route => route.fulfill(route.request().url().includes('/api/')
        ? { contentType: 'application/json', body: '[]' }
        : route.request().url().endsWith('/app.js')
          ? { contentType: 'text/javascript', body: chunk.code }
          : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` }))
      await page.goto('http://mew-switch.test/')
      const target = page.locator('.editor-root [data-mew-line-numbers="180"]')
      await target.click()
      await page.evaluate(`() => {
        const el = document.querySelector('.editor-root [data-mew-line-numbers="180"]')
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(true)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
      }`)
      await page.locator('.editor-root [data-mew-line-numbers="180"].mew-line--focus').waitFor()
      // Keep a focused line around the middle of the viewport.
      await page.evaluate(`() => {
        const el = document.querySelector('.editor-root [data-mew-line-numbers="180"]')
        const root = document.querySelector('.editor-root')
        root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top - 160
      }`)
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: 'Plain', exact: true }).click()
        await page.waitForFunction(`() => {
          const line = Array.from(document.querySelectorAll('.cm-line')).find(el => el.textContent?.startsWith('문단 88:'))
          const root = document.querySelector('.cm-scroller')
          return line && root && Math.abs(line.getBoundingClientRect().top - root.getBoundingClientRect().top - 160) < 5
        }`, undefined, { timeout: 5000 })
        await page.getByRole('button', { name: 'Hotview', exact: true }).click()
        await page.waitForFunction(`() => {
          const line = document.querySelector('.editor-root [data-mew-line-numbers="180"]')
          const root = document.querySelector('.editor-root')
          return line && root && Math.abs(line.getBoundingClientRect().top - root.getBoundingClientRect().top - 160) < 5
        }`, undefined, { timeout: 5000 })
      }
      // Reading by scrolling leaves the old caret offscreen; preserve the visible block instead.
      await page.locator('.editor-root').dispatchEvent('wheel')
      await page.evaluate(`() => {
        const el = document.querySelector('.editor-root [data-mew-line-numbers="302"]')
        const root = document.querySelector('.editor-root')
        root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top
      }`)
      await page.getByRole('button', { name: 'Plain', exact: true }).click()
      await page.waitForFunction(`() => {
        const line = Array.from(document.querySelectorAll('.cm-line')).find(el => el.textContent?.startsWith('문단 149:'))
        const root = document.querySelector('.cm-scroller')
        return line && root && Math.abs(line.getBoundingClientRect().top - root.getBoundingClientRect().top) < 5
      }`, undefined, { timeout: 5000 })
      assert.equal(await page.evaluate('window.value'), content, 'switching must not edit or serialize the source')
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
