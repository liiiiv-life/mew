import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('sidebar moves animate refreshed rows and respect reduced motion', { skip: !domBrowserExecutable(), timeout: 30_000 }, async () => {
  const source = `import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {FileTree} from '${root}/src/components/FileTree.tsx';
import {I18nProvider} from '${root}/src/i18n.tsx';
const file=path=>({path,name:path.split('/').pop(),type:'file'});const noop=()=>{};
function Fixture(){const [moved,setMoved]=React.useState(false);window.reset=()=>setMoved(false);return <div style={{height:700,width:320}}><FileTree project=".workspace" tree={[...(!moved?[file('note.md')]:[]),file('other.md'),{path:'folder',name:'folder',type:'dir',children:[file('folder/child.md'),...(moved?[file('folder/note.md')]:[])]}]} selectedPath={null} readOnly={false} searchFocusSignal={0} newFileSignal={{n:0,parentPath:null}} revealSignal={0} presence={{}} onSelect={noop} onFileCreated={noop} onFolderCreated={noop} onRenamed={()=>{setTimeout(()=>setMoved(true),100)}} onDeleted={noop} onGuestAccessChanged={noop} onNotice={noop} registerSearchCancel={noop}/></div>}
createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Fixture/></I18nProvider></React.StrictMode>);`
  const bundle = await build({ input: 'virtual:sidebar-move.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:sidebar-move.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id) { if (id === 'virtual:sidebar-move.tsx') return source; if (id === 'virtual:style') return ''; if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8')) } }] })
  const chunk = bundle.output.find(item => item.type === 'chunk')!
  const content = (await Promise.all(['src/components/file-action-menu.tsx', 'src/components/FileTree.tsx', 'src/hooks/use-tree-touch-gesture.ts'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n')
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const css = compiler.build([...new Set((source + content).match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 844 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    const errors: string[] = []
    const writes: unknown[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.setDefaultTimeout(3000)
    await page.route('http://mew-touch.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/rename') {
        writes.push(route.request().postDataJSON())
        await route.fulfill({ json: { ok: true, hidden: false } }); return
      }
      if (url.pathname.startsWith('/api/')) { await route.fulfill({ json: {} }); return }
      await route.fulfill(url.pathname === '/app.js' ? { contentType: 'text/javascript', body: chunk.code } : { contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-touch.test/')
    const file = page.locator('button[data-path="note.md"]')
    const folder = page.locator('button[data-path="folder"]')
    await folder.click()
    await page.locator('button[data-path="folder/child.md"]').waitFor()
    await file.dragTo(folder)
    await page.waitForFunction("document.querySelector('[data-path=\"folder/note.md\"]')?.getAnimations().length")
    const motion = await page.locator('[data-path="folder/note.md"]').evaluate(el => {
      const animation = el.getAnimations()[0]
      animation.pause(); animation.currentTime = 90
      return { duration: animation.effect!.getTiming().duration, transform: el.ownerDocument.defaultView!.getComputedStyle(el).transform }
    })
    assert.equal(motion.duration, 180)
    assert.notEqual(motion.transform, 'none')
    assert.notEqual(motion.transform, 'matrix(1, 0, 0, 1, 0, 0)')
    assert.ok(await page.locator('[data-path="other.md"]').evaluate(el => el.getAnimations().length))
    await page.screenshot({path:'/tmp/mew-sidebar-move.png'})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.waitForFunction("Array.from(document.querySelectorAll('[data-path]')).every(el => el.getAnimations().length === 0)")
    await page.evaluate('window.reset()')
    await file.dragTo(folder)
    await page.locator('[data-path="folder/note.md"]').waitFor()
    assert.equal(await page.locator('[data-path]').evaluateAll(els => els.flatMap(el=>el.getAnimations()).length), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
