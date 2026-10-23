import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import express from 'express'
import { WebSocketServer } from 'ws'
import { chromium } from 'playwright-core'
import { build } from 'rolldown'
import { attachPortPreviewWebSocket, createPortPreviewRoutes } from './port-preview.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { AuthenticatedSession } from './auth.ts'

const stop = (server: http.Server | https.Server) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
test('isolated remote preview executes frontend modules, root CSS, POST, history, worker and HMR on port-only P2P', { timeout: 30_000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-preview-test-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(temporary, 'key.pem'), '-out', path.join(temporary, 'cert.pem'), '-days', '1', '-subj', '/CN=preview.test'], { stdio: 'ignore' })
  const files = Object.fromEntries(await Promise.all(['worker', 'launch', 'runtime'].map(async name => [name, await fs.readFile(new URL(`../public/port-preview-${name}.js`, import.meta.url), 'utf8')])))
  let centralRequests = 0
  const preview = https.createServer({ key: await fs.readFile(path.join(temporary, 'key.pem')), cert: await fs.readFile(path.join(temporary, 'cert.pem')) }, (req, res) => {
    if (req.url === '/__mew_preview_launch') {
      res.setHeader('Content-Type', 'text/html'); res.end(`<meta name="mew-preview-parent" content="${origin}"><script defer src="/__mew_preview_launch.js"></script>`); return
    }
    const name = /^\/__mew_preview_(worker|launch|runtime)\.js$/.exec(req.url ?? '')?.[1]
    if (name) { res.setHeader('Content-Type', 'text/javascript'); if (name === 'worker') res.setHeader('Service-Worker-Allowed', '/'); res.end(files[name]); return }
    centralRequests++; res.writeHead(503); res.end('P2P required')
  })
  preview.listen(0, '127.0.0.1'); await once(preview, 'listening'); t.after(() => stop(preview))
  const previewPort = (preview.address() as { port: number }).port
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/api/echo') { let body = ''; for await (const part of req) body += String(part); res.setHeader('Content-Type', 'application/json'); res.end(body); return }
    if (req.url === '/root.css') { res.setHeader('Content-Type', 'text/css'); res.end('#result{color:rgb(0,128,0)}'); return }
    if (req.url === '/lazy.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export const value="lazy"'); return }
    if (req.url === '/worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('postMessage("worker")'); return }
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(`const {value}=await import('/lazy.js');const worker=new Worker('/worker.js');const work=await new Promise(r=>worker.onmessage=e=>r(e.data));worker.terminate();const post=await(await fetch('/api/echo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:'POST'})})).json();history.pushState({},'','/deep/path');const socket=new WebSocket('wss://'+location.host+'/hmr',['offered-hmr','chosen-hmr']);const hmr=await new Promise(r=>{socket.onopen=()=>socket.send('update');socket.onmessage=e=>{r(e.data+' '+socket.protocol);socket.close()}});let blocked=false;try{top.document.body}catch{blocked=true}document.querySelector('#result').textContent=[value,work,post.ok,hmr,location.pathname,blocked?'isolated':'unsafe'].join(' ')`); return }
    res.setHeader('Content-Type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/root.css"></head><body><p id="result">Loading</p><script type="module" src="/app.js"></script></body></html>')
  })
  const hmr = new WebSocketServer({ server: upstream, handleProtocols: protocols => protocols.has('chosen-hmr') ? 'chosen-hmr' : false }); hmr.on('connection', socket => socket.on('message', () => socket.send('HMR')))
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); t.after(() => stop(upstream))
  const upstreamPort = (upstream.address() as { port: number }).port
  const bundle = await build({ input: 'virtual:preview', write: false, platform: 'browser', output: { format: 'iife', name: 'Preview' }, plugins: [{ name: 'fixture', resolveId(id) { if (id === 'virtual:preview') return id }, load(id) { if (id === 'virtual:preview') return `export * from '${new URL('../src/utils/port-preview-remote.ts', import.meta.url).pathname}';export * from '${new URL('../src/utils/remote-transport.ts', import.meta.url).pathname}'` } }] })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const fixture = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<iframe id="preview"></iframe><script>${code}</script><script>class Channel extends EventTarget{readyState='open';bufferedAmount=0;send(raw){window.nodeSend(raw)}close(){this.readyState='closed'}}window.channel=new Channel();window.deliver=raw=>channel.dispatchEvent(new MessageEvent('message',{data:raw}));Preview.setRemoteTransport(new Preview.DataChannelTransport(channel));Preview.configureRemotePortPreview('preview.test');Preview.mountRemotePortPreview(document.querySelector('iframe'),{port:${upstreamPort}}).then(cleanup=>window.disposePreview=cleanup).catch(e=>window.failure=e.message)</script>`) })
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening'); t.after(() => stop(fixture))
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
  const app = express(); app.use(express.json()); app.use('/api/port-preview', createPortPreviewRoutes())
  const host = http.createServer(app); attachPortPreviewWebSocket(host)
  const current: AuthenticatedSession | null = { email: 'preview@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  const browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP *.preview.test 127.0.0.1:${previewPort}`, '--ignore-certificate-errors', '--no-proxy-server'] })
  t.after(() => browser.close())
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const dispatcher = remoteDispatcher(host, { send: async raw => { await page.evaluate(raw => (globalThis as unknown as { deliver(raw: string): void }).deliver(raw), raw) }, close() {} }, () => current, origin)
  t.after(() => dispatcher.close())
  await page.exposeFunction('nodeSend', (raw: string) => { void dispatcher.receive(raw) })
  await page.goto(origin, {waitUntil:'domcontentloaded'})
  const content = page.frameLocator('#preview').frameLocator('iframe')
  await content.getByText('lazy worker POST HMR chosen-hmr /deep/path isolated', { exact: true }).waitFor({ timeout: 10000 })
  assert.equal(await content.locator('#result').evaluate(el => el.ownerDocument.defaultView!.getComputedStyle(el).color), 'rgb(0, 128, 0)')
  assert.equal(centralRequests, 0); assert.deepEqual(errors, [])
  await page.evaluate(() => (globalThis as unknown as { disposePreview(): void }).disposePreview())
})
