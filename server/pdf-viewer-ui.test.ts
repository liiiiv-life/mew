import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import express from 'express'
import { build } from 'rolldown'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFDict, PDFName, degrees } from 'pdf-lib'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { registerPdfRoutes } from './pdf.ts'

const root = path.resolve(import.meta.dirname, '..')

test('PDF viewer renders under production CSP, virtualizes pages, retains ink and writes portable PDF annotations', { skip: !domBrowserExecutable(), timeout: 60_000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-pdf-ui-'))
  const file = path.join(dir, 'fixture.pdf')
  const document = await PDFDocument.create()
  for (let index = 0; index < 500; index++) {
    const page = document.addPage(index === 1 ? [840, 600] : [600, 800])
    page.drawText(`PDF page ${index + 1}`, { x: 55, y: 720 > page.getHeight() ? 500 : 720, size: 24 })
    page.drawText('Selectable document text. Write a note in the margin.', { x: 55, y: 420, size: 15 })
    if (index === 1) { page.setRotation(degrees(90)); page.setCropBox(20, 25, 760, 550) }
  }
  await fs.writeFile(file, await document.save())
  const fixture = `import React,{useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {I18nProvider} from '${root}/src/i18n.tsx';
import PdfViewer from '${root}/src/components/pdf-viewer.tsx';
function Fixture(){const [open,setOpen]=useState(true);return <I18nProvider><div style={{height:'100%',display:'flex',flexDirection:'column'}}><button id="toggle" onClick={()=>setOpen(!open)}>Toggle PDF</button><div style={{flex:1,minHeight:0}}>{open&&<PdfViewer src="/api/raw?path=fixture.pdf" download="/api/pdf?path=fixture.pdf" name="fixture.pdf" identity="test-user"/>}</div></div></I18nProvider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`
  const bundle = await build({ input: { app: 'virtual:pdf-fixture.tsx', 'pdf-save-worker': `${root}/src/utils/pdf-save-worker.ts` }, write: false, platform: 'browser', output: { format: 'esm', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' }, transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('test') } }, plugins: [{ name: 'pdf-fixture', resolveId(id) { if (id === 'virtual:pdf-fixture.tsx') return id; if (id.endsWith('.css')) return 'virtual:css' }, load(id) { if (id === 'virtual:pdf-fixture.tsx') return fixture; if (id === 'virtual:css') return '' } }] })
  const chunks = new Map(bundle.output.filter(item => item.type === 'chunk').map(item => [item.fileName, item.code]))
  const compiler = await compile(await fs.readFile(`${root}/src/index.css`, 'utf8') + '\n' + await fs.readFile(`${root}/src/components/pdf-viewer.css`, 'utf8'), { base: `${root}/src`, onDependency() {} })
  const selectSource = await fs.readFile(`${root}/packages/ui/src/select-field.tsx`, 'utf8')
  const css = compiler.build([...new Set(selectSource.match(/[A-Za-z0-9_@!:/.[\]()%,-]+/g))])
  const serve = await fs.readFile(`${root}/server/serve.ts`, 'utf8')
  const csp = /res.setHeader\('Content-Security-Policy', "([^"]+)"\)/.exec(serve)![1]
  const app = express()
  app.use((_req, res, next) => { res.setHeader('Content-Security-Policy', csp); next() })
  const pdfRoutes = express()
  let conflict = false, readonly = false
  app.post('/test/conflict', (_req, res) => { conflict = true; res.end() })
  app.post('/test/readonly', (_req, res) => { readonly = true; res.end() })
  pdfRoutes.use((req, res, next) => { if (req.method === 'PUT' && conflict) { res.status(409).end(); return }; next() })
  registerPdfRoutes(pdfRoutes, () => ({ file, editable: !readonly }))
  app.use('/api', pdfRoutes)
  const pdfPackage = JSON.parse(await fs.readFile(`${root}/node_modules/pdfjs-dist/package.json`, 'utf8'))
  app.get(`/pdf-assets/${pdfPackage.version}/pdf.worker.mjs`, (_req, res) => { res.sendFile(`${root}/node_modules/pdfjs-dist/build/pdf.worker.mjs`) })
  app.use(`/pdf-assets/${pdfPackage.version}`, express.static(`${root}/node_modules/pdfjs-dist`))
  app.use((req, res) => {
    const chunk = chunks.get(req.path.slice(1).replace('pdf-save-worker.ts', 'pdf-save-worker.js'))
    if (chunk) { res.type('js').send(chunk); return }
    if (req.path === '/style.css') { res.type('css').send(css); return }
    res.type('html').send('<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(dir, { recursive: true, force: true }) })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  page.setDefaultTimeout(8000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('status of 409')) errors.push(message.text()) })
  page.on('dialog', dialog => { void dialog.accept() })
  await page.addInitScript("localStorage.setItem('mew:locale','en')")
  const started = Date.now()
  await page.goto(origin)
  await page.locator('.pdf-page[data-page="1"] .pdf-paper canvas').waitFor()
  t.diagnostic(`First page visible: ${Date.now() - started} ms; fixture: 500 pages`)
  await page.locator('.pdf-text-layer').filter({ hasText: 'Selectable document text' }).first().waitFor()
  assert.equal(await page.locator('select, datalist').count(), 0)
  assert.ok(await page.locator('.pdf-page').count() < 6, 'only viewport and adjacent pages are mounted')
  await page.getByRole('textbox', { name: 'Page', exact: true }).fill('250')
  await page.getByRole('textbox', { name: 'Page', exact: true }).press('Enter')
  await page.locator('.pdf-page[data-page="250"] .pdf-paper canvas').waitFor()
  assert.equal(await page.locator('.pdf-page[data-page="1"]').count(), 0)
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).click()
  await page.getByRole('option', { name: '100%', exact: true }).click()
  await page.locator('.pdf-page[data-page="250"] .pdf-paper canvas[width="600"]').waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Page', exact: true }).inputValue(), '250', 'zoom retains the reading page')
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).click()
  await page.getByRole('option', { name: 'Fit width', exact: true }).click()
  await page.getByRole('textbox', { name: 'Page', exact: true }).fill('1')
  await page.getByRole('textbox', { name: 'Page', exact: true }).press('Enter')
  await page.locator('.pdf-page[data-page="1"] .pdf-paper canvas').waitFor()
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  let box = (await page.locator('.pdf-page[data-page="1"] .pdf-live').boundingBox())!
  await page.mouse.move(box.x + 90, box.y + 170); await page.mouse.down(); await page.mouse.move(box.x + 250, box.y + 210, { steps: 25 }); await page.mouse.up()
  await page.getByText('Unsaved annotations', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Undo annotation', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Save PDF', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Redo annotation', exact: true }).click()
  await page.getByRole('button', { name: 'Erase new strokes', exact: true }).click()
  await page.mouse.move(box.x + 170, box.y + 190); await page.mouse.down(); await page.mouse.up()
  assert.equal(await page.getByRole('button', { name: 'Save PDF', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Undo annotation', exact: true }).click()
  const workerBeforeFullscreen = page.workers()[0]
  await page.getByRole('button', { name: 'PDF fullscreen', exact: true }).click()
  await page.locator('.pdf-viewer:fullscreen').waitFor()
  const zoomField = page.getByRole('combobox', { name: 'Zoom', exact: true })
  await zoomField.click()
  await page.getByRole('option', { name: '100%', exact: true }).click()
  await zoomField.click(); await zoomField.press('Escape')
  assert.equal(await page.getByRole('listbox').count(), 0)
  assert.equal(await page.locator('.pdf-viewer:fullscreen').count(), 1, 'Escape dismisses the dropdown before fullscreen')
  const penWidth = page.getByRole('combobox', { name: 'Pen width', exact: true })
  await penWidth.click(); await page.getByRole('option', { name: 'Thick', exact: true }).click()
  assert.equal(await penWidth.innerText(), 'Thick')
  assert.equal(await page.evaluate("document.elementFromPoint(8, 8)?.closest('.pdf-viewer') !== null"), true, 'app tabs and outer UI are covered')
  assert.equal(await page.getByRole('button', { name: 'Pen', exact: true }).isVisible(), true)
  await page.screenshot({ path: '/tmp/mew-pdf-fullscreen-desktop.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'PDF fullscreen', exact: true }).waitFor()
  assert.equal(page.workers()[0], workerBeforeFullscreen, 'fullscreen never reloads the PDF worker')
  await page.getByText('Unsaved annotations', { exact: true }).waitFor()
  await page.locator('#toggle').click(); await page.locator('#toggle').click()
  await page.locator('.pdf-page[data-page="1"] .pdf-paper canvas').waitFor()
  await page.getByText('Unsaved annotations', { exact: true }).waitFor()
  await page.reload()
  await page.locator('.pdf-page[data-page="1"] .pdf-paper canvas').waitFor()
  await page.getByText('Unsaved annotations', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Highlighter', exact: true }).click()
  box = (await page.locator('.pdf-page[data-page="1"] .pdf-live').boundingBox())!
  await page.mouse.move(box.x + 90, box.y + 240); await page.mouse.down(); await page.mouse.move(box.x + 270, box.y + 240, { steps: 18 }); await page.mouse.up()
  await page.screenshot({ path: '/tmp/mew-pdf-desktop.png' })
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
  await page.getByText('Saved in PDF', { exact: true }).waitFor()
  await page.locator('.pdf-page[data-page="1"] .pdf-paper canvas').waitFor()
  const saved = await PDFDocument.load(await fs.readFile(file))
  assert.equal(saved.getPageCount(), 500)
  assert.equal(saved.getPage(0).node.Annots()!.size(), 2)
  assert.equal(saved.getPage(0).node.Annots()!.lookup(0, PDFDict).get(PDFName.of('Subtype'))!.toString(), '/Ink')
  const canvasPixels = await page.locator('canvas').evaluateAll(canvases => canvases.reduce((total, canvas) => total + canvas.width * canvas.height, 0))
  assert.ok(canvasPixels <= 16_000_000, `canvas pixel budget: ${canvasPixels}`)
  await page.getByRole('button', { name: 'Pen', exact: true }).click()
  box = (await page.locator('.pdf-page[data-page="1"] .pdf-live').boundingBox())!
  await page.mouse.move(box.x + 95, box.y + 310); await page.mouse.down(); await page.mouse.move(box.x + 230, box.y + 310, { steps: 12 }); await page.mouse.up()
  await page.request.post(`${origin}/test/conflict`)
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'changed on disk' }).waitFor()
  assert.equal((await PDFDocument.load(await fs.readFile(file))).getPage(0).node.Annots()!.size(), 2)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download annotated copy', exact: true }).click()
  const copy = await downloadEvent
  const exported = await PDFDocument.load(await fs.readFile((await copy.path())!))
  assert.equal(exported.getPage(0).node.Annots()!.size(), 3)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate("document.documentElement.classList.remove('dark')")
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).click()
  await page.getByRole('option', { name: 'Fit width', exact: true }).click()
  await page.screenshot({ path: '/tmp/mew-pdf-mobile.png' })
  assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
  // Mobile browsers can reject element fullscreen. Modal top-layer fallback must still cover the app.
  await page.evaluate("document.querySelector('.pdf-viewer').requestFullscreen = () => Promise.reject(new Error('Fullscreen unavailable'))")
  await page.getByRole('button', { name: 'PDF fullscreen', exact: true }).click()
  await page.locator('.pdf-stage:modal').waitFor()
  await zoomField.click()
  const zoomList = page.getByRole('listbox', { name: 'Zoom', exact: true })
  const listBounds = await zoomList.boundingBox()
  assert.ok(listBounds && listBounds.x >= 0 && listBounds.x + listBounds.width <= 390 && listBounds.y >= 0 && listBounds.y + listBounds.height <= 844)
  await page.getByRole('option', { name: '75%', exact: true }).click()
  assert.equal(await zoomField.innerText(), '75%')
  await zoomField.click(); await page.evaluate('history.back()'); await zoomList.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.pdf-stage:modal').count(), 1, 'Back dismisses the dropdown before the modal fullscreen fallback')
  assert.equal(await page.evaluate("document.elementFromPoint(8, 8)?.closest('.pdf-viewer') !== null"), true)
  await page.screenshot({ path: '/tmp/mew-pdf-fullscreen-mobile.png' })
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate("document.activeElement.closest('.pdf-viewer') !== null"), true, 'focus stays in the PDF')
  await page.getByRole('button', { name: 'Exit PDF fullscreen', exact: true }).click()
  await page.locator('.pdf-stage[open]:not(:modal)').waitFor()
  await page.locator('#toggle').click(); await page.locator('#toggle').click()
  await page.locator('.pdf-page[data-page="1"] .pdf-paper canvas').waitFor()
  await page.getByText('Unsaved annotations', { exact: true }).waitFor()
  await page.request.post(`${origin}/test/readonly`)
  await page.reload(); await page.locator('.pdf-page[data-page="1"] .pdf-paper canvas').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save PDF', exact: true }).count(), 0)
  assert.deepEqual(errors, [], 'no JavaScript or CSP errors')
  t.diagnostic(`Mounted pages: ${await page.locator('.pdf-page').count()}; canvas pixels: ${canvasPixels}`)
})
