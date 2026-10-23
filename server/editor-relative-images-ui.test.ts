import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const repo = path.resolve(import.meta.dirname, '..')

test('Hotview loads README and Documents images without rewriting Markdown, updates identical images on document switch, and resizes images with their gutter', { skip: !domBrowserExecutable(), timeout: 40_000 }, async () => {
  const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8')
  const overview = fs.readFileSync(path.join(repo, 'docs/guides/overview.md'), 'utf8')
  const source = `import React,{useState,useMemo} from ${JSON.stringify(import.meta.resolve('react'))};
import {createRoot} from ${JSON.stringify(import.meta.resolve('react-dom/client'))};
import {Editor} from ${JSON.stringify(path.join(repo, 'packages/editor/src/Editor.tsx'))};
import {editorImageUrl} from ${JSON.stringify(path.join(repo, 'src/utils/editor-image-url.ts'))};
const workspace={path:'/projects/mew',docsPath:'/projects/mew/docs'};
function Fixture(){
 const [doc,setDoc]=useState({path:'README.md',project:'.workspace',content:${JSON.stringify(readme)}});window.setDoc=next=>{window.saved=null;setDoc(next)};
 const api=useMemo(()=>({db:{},fetchFile:async()=>({content:''}),resolveImageUrl:(src,from)=>editorImageUrl(src,from,doc.project,workspace)}),[doc.project]);
 return <Editor value={doc.content} path={doc.path} api={api} onChange={value=>{window.saved=value}}/>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`
  const bundle = await build({ input: 'virtual:images.tsx', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'image-fixture', resolveId(id) { if (id === 'virtual:images.tsx') return id; if (id.endsWith('.css')) return 'virtual:style' }, load(id) { if (id === 'virtual:images.tsx') return source; if (id === 'virtual:style') return '' } }] })
  const compiler = await compile(fs.readFileSync(path.join(repo, 'src/index.css'), 'utf8'), { base: path.join(repo, 'src'), onDependency() {} })
  const candidates = ['packages/editor/src/Editor.tsx', 'packages/editor/src/ResizableImage.tsx'].map(file => fs.readFileSync(path.join(repo, file), 'utf8')).join('\n')
  const css = compiler.build([...new Set(candidates.match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))]) + fs.readFileSync(path.join(repo, 'packages/editor/src/editor/editor.css'), 'utf8')
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = [], requests: { project: string | null; path: string }[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('http://mew-relative-images.test/**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/raw') {
        const file = url.searchParams.get('path')!, project = url.searchParams.get('project')
        requests.push({ project, path: file })
        const image = /^(a|b)\/photo.png$/.test(file) ? 'docs/assets/screenshots/desktop.png' : project === 'docs' ? `docs/${file}` : file
        if (!image.startsWith('docs/assets/screenshots/')) return route.fulfill({ status: 404, body: 'missing example image' })
        return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(repo, image)) })
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] })
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: code })
      if (url.pathname !== '/') return route.fulfill({ status: 404, body: 'not a browser-relative asset' })
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>` })
    })
    const setDoc = async (doc: { path: string; project: string; content: string }) => page.locator('#root').evaluate((el, doc) => {
      const host = el.ownerDocument.defaultView as unknown as { setDoc: (doc: unknown) => void }
      host.setDoc(doc)
    }, doc)
    const loaded = async (count: number) => {
      await page.locator('.ProseMirror').evaluate((el, count) => new Promise<void>((resolve, reject) => {
        const started = Date.now()
        const check = () => {
          const imgs = Array.from(el.querySelectorAll('img')) as { complete: boolean; naturalWidth: number; getAttribute: (name: string) => string | null }[]
          if (imgs.length === count && imgs.every(img => img.complete && img.naturalWidth > 0)) return resolve()
          if (Date.now() - started > 4500) return reject(new Error(JSON.stringify({images: imgs.map(img => ({src:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth}))})))
          el.ownerDocument.defaultView!.requestAnimationFrame(check)
        }
        check()
      }), count)
    }
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('http://mew-relative-images.test/')
      await page.waitForTimeout(250)
      assert.deepEqual(errors, [])
      await loaded(2)
      await setDoc({ path: 'guides/overview.md', project: 'docs', content: overview })
      await loaded(4)
      const shared = '![Scope](./photo.png)\n\nExample'
      await setDoc({ path: 'a/note.md', project: 'docs', content: shared })
      await loaded(1)
      await setDoc({ path: 'b/note.md', project: 'docs', content: shared })
      await page.locator('.ProseMirror img[src*="b%2Fphoto.png"]').waitFor()
      await loaded(1)
      await page.locator('.ProseMirror p').last().click()
      await page.keyboard.press('End')
      await page.keyboard.type(' changed')
      await page.waitForFunction(() => (globalThis as unknown as { saved?: string }).saved?.includes('changed'))
      const saved = await page.locator('#root').evaluate(el => (el.ownerDocument.defaultView as unknown as { saved: string }).saved)
      assert.ok(saved.includes('![Scope](./photo.png)'), saved)
      assert.ok(!saved.includes('/api/raw'), saved)
    }
    for (const image of ['![Scope](./photo.png)', '<img src="./photo.png" alt="Scope" width="900">']) {
      await setDoc({ path: 'a/note.md', project: 'docs', content: `Before\n\n${image}\n\nAfter` })
      await loaded(1)
      const measurements = []
      for (const width of [1200, 390, 1200]) {
        await page.setViewportSize({ width, height: 844 })
        const geometry = await page.locator('.ProseMirror').evaluate(async el => {
          const win = el.ownerDocument.defaultView!
          await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())))
          const img = el.querySelector('img')!
          const box = img.getBoundingClientRect()
          const wrapper = img.closest('[data-node-view-wrapper]')!
          const after = el.querySelector('p:last-child')!
          const afterBox = after.getBoundingClientRect()
          const number = win.getComputedStyle(after, '::before')
          return {
            width: box.width, height: box.height, ratio: img.naturalWidth / img.naturalHeight,
            wrapperHeight: wrapper.getBoundingClientRect().height,
            afterTop: afterBox.top,
            numberTop: afterBox.top + parseFloat(number.top),
            number: after.getAttribute('data-mew-line-numbers'), numberContent: number.content,
          }
        })
        assert.ok(Math.abs(geometry.width / geometry.height - geometry.ratio) < 0.01, `image keeps its ratio: ${JSON.stringify(geometry)}`)
        assert.ok(Math.abs(geometry.wrapperHeight - geometry.height) < 1, 'container fits the image without vertical blank space')
        assert.equal(geometry.number, '5')
        assert.equal(geometry.numberContent, '"5"')
        assert.ok(Math.abs(geometry.numberTop - geometry.afterTop) < 1, 'line number stays aligned with the following paragraph')
        measurements.push(geometry)
      }
      assert.ok(measurements[1].height < measurements[0].height, 'image height shrinks with the available width')
      assert.ok(measurements[1].numberTop < measurements[0].numberTop, 'following line number moves up with the image')
      assert.ok(Math.abs(measurements[2].height - measurements[0].height) < 1, 'expanding restores image height')
      assert.equal(await page.locator('#root').evaluate(el => (el.ownerDocument.defaultView as unknown as { saved: string | null }).saved), null, 'resizing does not rewrite Markdown')
    }
    assert.ok(requests.some(item => item.project === '.workspace' && item.path === 'docs/assets/screenshots/split.png'))
    for (const name of ['split', 'desktop', 'git', 'mobile']) assert.ok(requests.some(item => item.project === 'docs' && item.path === `assets/screenshots/${name}.png`))
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
