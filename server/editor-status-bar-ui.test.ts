import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

test('editor status retains size and height during typing and deferred measurement', { skip: !domBrowserExecutable(), timeout: 45_000 }, async () => {
  const content = 'hello'
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
  const [project,setProject]=React.useState('docs');
  const [filePath,setPath]=React.useState('fixture.md');
  window.fixture={setValue,setProject,setPath};
  window.value=value;
  return <div className="flex h-dvh flex-col"><EditorPane {...callbacks}
    pane={{id:'fixture',activePath:filePath,tabs:[{path:filePath,content:value,viewMode,editable:true,preview:false}]}}
    onChangeContent={(_,v)=>setValue(v)} onSetViewMode={(_,mode)=>setMode(mode)}
    role="guest" authEmail={null} project={project} tree={[]} presence={{}} focused isGuest showSidebarButton={false} tocOpen={false} dropZone={null}/></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const styles: string[] = []
  const bundle = await build({
    input: 'virtual:status.tsx', write: false, platform: 'browser', output: { format: 'esm', codeSplitting: false },
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } },
    plugins: [{
      name: 'status-fixture',
      resolveId(id) { if (id === 'virtual:status.tsx') return id },
      async load(id) {
        if (id === 'virtual:status.tsx') return source
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
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('http://mew-status.test/**', route => {
        const url = new URL(route.request().url())
        return route.fulfill(url.pathname.startsWith('/api/') ? { json: [] }
          : url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code }
          : { contentType: 'text/html', body: `<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script></html>` })
      })
      await page.goto('http://mew-status.test/')
      const status = page.locator('[data-editor-status-bar]')
      for (const mode of ['Hotview', 'Plain']) {
        await page.getByRole('button', { name: mode, exact: true }).click()
        await page.waitForFunction('document.querySelector("[data-editor-status-bar]")?.textContent.includes(" B")')
        const height = (await status.boundingBox())!.height
        // Hold animation frames to inspect the render before deferred size measurement.
        await page.evaluate(`(() => {
          window.nativeRaf=requestAnimationFrame;
          window.heldFrames=new Map();let id=-1;
          window.requestAnimationFrame=callback=>{const key=id--;window.heldFrames.set(key,callback);return key};
          window.nativeCancel=cancelAnimationFrame;
          window.cancelAnimationFrame=id=>{window.heldFrames.delete(id);window.nativeCancel(id)};
        })()`)
        const before = await status.textContent()
        const editor = page.locator(mode === 'Hotview' ? '.ProseMirror' : '.cm-content')
        await editor.click()
        await page.keyboard.press('ControlOrMeta+End')
        for (const char of ['a', 'b', '한']) {
          await page.keyboard.insertText(char)
          assert.equal(await status.textContent(), before, 'retain the previous size while typing')
          assert.equal((await status.boundingBox())!.height, height, 'typing does not resize the footer')
        }
        await page.evaluate(`(() => {
          window.requestAnimationFrame=window.nativeRaf;
          window.cancelAnimationFrame=window.nativeCancel;
          for(const callback of window.heldFrames.values())requestAnimationFrame(callback);
          window.heldFrames.clear();
        })()`)
        await page.waitForFunction('document.querySelector("[data-editor-status-bar]").textContent.trim() === new TextEncoder().encode(window.value).length + " B"')
        assert.equal((await status.boundingBox())!.height, height)
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
