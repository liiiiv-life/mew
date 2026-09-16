import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import express from 'express'
import { chromium } from 'playwright-core'
import { build } from 'rolldown'
import { attachDomBrowserWebSocket, createDomBrowserRoutes, domBrowserExecutable, openDomBrowserTab, type DomInput } from './browser-dom.ts'

test('DOM scrolling rejects delayed echoes, preserves nested moves, and still follows source scrolling', { skip: !domBrowserExecutable(), timeout: 45_000 }, async (t) => {
  const bundle = await build({ input: new URL('../src/utils/browser-dom-view.ts', import.meta.url).pathname, output: { format: 'esm' }, platform: 'browser', write: false })
  const code = bundle.output.find((item) => item.type === 'chunk')!
  const owner = { role: 'owner' as const, email: 'scroll-test@example.com', mustChangePassword: false }
  const app = express()
  app.use((req, _res, next) => { req.auth = owner; next() })
  app.use('/api/browser-dom', createDomBrowserRoutes())
  const fixture = '<!doctype html><html style="scroll-behavior:smooth"><body style="margin:0;height:4000px"><h1>Scroll fixture</h1><div id="pane" style="height:180px;width:240px;overflow:auto;scroll-behavior:smooth"><div style="height:1600px">Nested pane</div></div><div id="other" style="height:100px;width:240px;overflow:auto"><div style="height:1000px">Other pane</div></div></body></html>'
  app.get('/site', (_req, res) => res.type('html').send(fixture))
  app.get('/view.js', (_req, res) => res.type('js').send(code.code))
  let streamUrl = ''
  app.get('/init.js', (_req, res) => res.type('js').send(`import {mountDomBrowser} from '/view.js';window.controller=mountDomBrowser(document.querySelector('#root'),${JSON.stringify(streamUrl)},()=>{});`))
  app.get('/viewer', (_req, res) => res.type('html').send('<!doctype html><html><body style="margin:0"><div id="root" style="width:600px;height:600px"></div><script type="module" src="/init.js"></script></body></html>'))
  const server = http.createServer(app)
  attachDomBrowserWebSocket(server, () => owner)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const session = openDomBrowserTab(owner.email, 'scroll-fixture', `${origin}/site`)
  streamUrl = session.info().streamUrl
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), headless: true, chromiumSandbox: true })
  t.after(async () => {
    await browser.close()
    await session.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const inputs: DomInput[] = []
  const input = session.input.bind(session)
  session.input = async (value, signal) => { if (value.kind === 'scroll') inputs.push(value); await input(value, signal) }
  const send = session.send.bind(session)
  const held: { type: string; frame: string; generation: number; event: { type: number; data: { source: number; id: number; y: number; mewScroll?: { token: string; revision: number } } } }[] = []
  let hold = false
  session.send = (value) => {
    const packet = value as typeof held[number]
    if (hold && packet.type === 'event' && packet.event?.type === 3 && packet.event.data.source === 3) held.push(packet)
    else send(value)
  }
  const viewer = await browser.newPage({ viewport: { width: 600, height: 600 } })
  const errors: string[] = []
  viewer.on('pageerror', (error) => errors.push(error.message))
  await viewer.goto(`${origin}/viewer`)
  const view = viewer.frameLocator('#root > .replayer-wrapper > iframe')
  await view.getByText('Scroll fixture').waitFor()
  const source = session.page!
  const wait = async (check: () => boolean) => {
    for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 20)) }
    assert.fail('scroll packet did not arrive')
  }
  const docY = () => view.locator('html').evaluate((node) => node.ownerDocument.scrollingElement!.scrollTop)

  // A source-only scroll is applied immediately even if the page uses smooth CSS,
  // and must not produce a scroll input back to the source.
  await source.evaluate('window.scrollTo({top:300,behavior:"instant"})')
  await viewer.waitForFunction('document.querySelector("iframe").contentWindow.scrollY === 300')
  await viewer.waitForTimeout(150)
  assert.equal(inputs.length, 0)

  // Hold two real recorded source echoes; replay the older one after a newer move.
  hold = true
  await view.locator('html').evaluate((node) => node.ownerDocument.defaultView!.scrollTo({ top: 500, behavior: 'instant' }))
  await wait(() => held.some((p) => p.event.data.y === 500))
  const older = held.find((p) => p.event.data.y === 500)!
  assert(older.event.data.mewScroll?.revision)
  await view.locator('html').evaluate((node) => node.ownerDocument.defaultView!.scrollTo({ top: 850, behavior: 'instant' }))
  await wait(() => held.some((p) => p.event.data.y === 850))
  const newer = held.find((p) => p.event.data.y === 850)!
  send(newer); send(older)
  await viewer.waitForTimeout(300)
  assert.equal(await docY(), 850)
  assert.equal(inputs.length, 2)
  assert.equal(await source.evaluate('scrollY'), 850)

  // The document and two panes can scroll within the same debounce interval.
  hold = false
  await view.locator('html').evaluate((node) => {
    const doc = node.ownerDocument
    doc.defaultView!.scrollTo({ top: 900, behavior: 'instant' })
    doc.querySelector('#pane')!.scrollTo({ top: 420, behavior: 'instant' })
    doc.querySelector('#other')!.scrollTo({ top: 240, behavior: 'instant' })
  })
  await source.waitForFunction('scrollY === 900 && document.querySelector("#pane").scrollTop === 420 && document.querySelector("#other").scrollTop === 240')
  await viewer.waitForTimeout(200)
  assert.equal(inputs.length, 5)

  // Site-driven navigation/scrolling still works after the local revision is applied.
  await source.evaluate('window.scrollTo({top:1200,behavior:"instant"});document.querySelector("#pane").scrollTo({top:700,behavior:"instant"})')
  await viewer.waitForFunction('document.querySelector("iframe").contentWindow.scrollY === 1200 && document.querySelector("iframe").contentDocument.querySelector("#pane").scrollTop === 700')
  await viewer.waitForTimeout(150)
  assert.equal(inputs.length, 5)

  // Rebuilding a snapshot with nonzero offsets must not create fresh user input.
  await viewer.evaluate('window.controller.command("snapshot")')
  await viewer.waitForTimeout(350)
  assert.equal(await docY(), 1200)
  assert.equal(inputs.length, 5)
  assert.deepEqual(errors, [])
})
