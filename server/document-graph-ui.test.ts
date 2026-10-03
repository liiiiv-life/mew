import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'

const root = path.resolve(import.meta.dirname, '..')

test('real graph worker/canvas: desktop/mobile rendering, search, opening, zoom, errors and dismissal', { skip: !domBrowserExecutable(), timeout: 45_000 }, async t => {
  const component = await fs.readFile(`${root}/src/components/DocumentGraph.tsx`, 'utf8')
  const source = `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import {DocumentGraph} from '${root}/src/components/DocumentGraph.tsx';function App(){const [open,setOpen]=React.useState(false);const [path,setPath]=React.useState('');return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setOpen(true)},'Graph'),React.createElement('span',{'data-opened':true},path),open&&React.createElement(DocumentGraph,{revision:0,onClose:()=>setOpen(false),onOpen:path=>{setPath(path);setOpen(false)}}))}createRoot(document.getElementById('root')).render(React.createElement(App));`
  const plugin = { name: 'graph-fixture', resolveId(id: string) { if (id === 'virtual:graph') return id; if (id.endsWith('.css')) return 'virtual:style' }, async load(id: string) {
    if (id === 'virtual:graph') return source
    if (id === 'virtual:style') return ''
    if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(await fs.readFile(id.slice(0, -4), 'utf8'))
    if (id === `${root}/src/components/DocumentGraph.tsx`) return component.replace("new URL('../utils/document-graph-worker.ts', import.meta.url)", "'http://mew-graph.test/worker.js'")
  } }
  const bundle = await build({ input: 'virtual:graph', write: false, platform: 'browser', output: { format: 'iife' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [plugin] })
  const worker = await build({ input: `${root}/src/utils/document-graph-worker.ts`, write: false, platform: 'browser', output: { format: 'iife' } })
  const code = bundle.output.find(item => item.type === 'chunk')!.code, workerCode = worker.output.find(item => item.type === 'chunk')!.code
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const content = component + await fs.readFile(`${root}/packages/ui/src/dialog-frame.tsx`, 'utf8')
  const css = compiler.build([...new Set(content.match(/[A-Za-z0-9_@:/.[\]()%,-]+/g))])
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 760 }, hasTouch: true })
    page.setDefaultTimeout(5000)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    let fail = false, empty = false, restrict = false
    await page.addInitScript(() => localStorage.setItem('mew:locale', 'ko'))
    const nodes = Array.from({ length: 120 }, (_, i) => ({ path: `area-${i % 5}/doc-${i}.md`, title: i === 0 ? 'Document hub' : `Document ${i}`, group: `area-${i % 5}` }))
    const edges = nodes.slice(1).map((_, i) => [i + 1, Math.floor(i / 4)])
    await page.route('http://mew-graph.test/**', route => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/api/docs/graph') return fail ? route.fulfill({ status: 500, json: { error: 'Graph request failed' } }) : route.fulfill({ json: { nodes: empty ? [] : restrict ? nodes.slice(0, 1) : nodes, edges: empty || restrict ? [] : edges, skipped: 0 } })
      if (pathname === '/worker.js') return route.fulfill({ contentType: 'text/javascript', body: workerCode })
      if (pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: code })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html ${width === 1100 ? 'class="dark"' : ''}><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` })
    })
    await page.goto('http://mew-graph.test/')
    await page.getByRole('button', { name: 'Graph', exact: true }).click()
    const dialog = page.getByRole('dialog'), canvas = dialog.locator('canvas')
    await page.locator('canvas[data-graph-state="settled"]').waitFor()
    const bounds = (await canvas.boundingBox())!
    assert.ok(bounds.width > width * 0.75 && bounds.height > 400)
    const pixels = await canvas.evaluate(el => { const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data; let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++; return count })
    assert.ok(pixels > 1000, 'real worker positions are painted on canvas')
    await dialog.screenshot({ path: `/tmp/mew-document-graph-${width}.png` })
    await dialog.getByRole('button', { name: '확대', exact: true }).click()
    await dialog.getByRole('button', { name: '축소', exact: true }).click()
    await dialog.getByRole('button', { name: '전체 보기', exact: true }).click()
    await dialog.getByRole('searchbox', { name: '문서 검색' }).fill('Document 42')
    await dialog.getByRole('button', { name: 'Document 42 area-2/doc-42.md', exact: true }).click()
    await dialog.getByRole('searchbox', { name: '문서 검색' }).fill('')
    const focusedBounds = (await canvas.boundingBox())!
    const cx = focusedBounds.x + focusedBounds.width / 2, cy = focusedBounds.y + focusedBounds.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 45, cy + 25, { steps: 3 })
    await page.mouse.up()
    await page.locator('canvas[data-graph-state="settled"]').waitFor()
    if (width === 390) {
      const session = await page.context().newCDPSession(page)
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 30, y: cy, id: 0 }, { x: cx + 30, y: cy, id: 1 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 55, y: cy, id: 0 }, { x: cx + 55, y: cy, id: 1 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await session.detach()
    }
    await page.mouse.move(focusedBounds.x + 10, focusedBounds.y + 10)
    await page.mouse.down()
    await page.mouse.move(focusedBounds.x + 45, focusedBounds.y + 30)
    await page.mouse.up()
    await canvas.focus()
    await page.keyboard.press('+')
    await page.keyboard.press('ArrowRight')
    await dialog.getByRole('button', { name: '문서 열기', exact: true }).click()
    assert.equal(await page.locator('[data-opened]').textContent(), 'area-2/doc-42.md')
    await page.getByRole('button', { name: 'Graph', exact: true }).click()
    await page.locator('canvas[data-graph-state="settled"]').waitFor()
    fail = true
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByRole('alert').getByText('Graph request failed').waitFor()
    fail = false; empty = true
    await page.getByRole('button', { name: '새로고침', exact: true }).click()
    await page.getByText('표시할 문서가 없습니다', { exact: true }).waitFor()
    empty = false; restrict = true
    await dialog.evaluate(el => el.ownerDocument.defaultView!.dispatchEvent(new Event('mew:permissions-changed')))
    await page.getByText('1개 문서 · 0개 링크', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Graph', exact: true }).evaluate(el => el === el.ownerDocument.activeElement), true)
    assert.deepEqual(errors, [])
    await page.close()
  }
})
