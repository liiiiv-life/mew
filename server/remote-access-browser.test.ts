import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import fs from 'node:fs'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { AuthenticatedSession } from './auth.ts'
import { REMOTE_LIMITS } from '../shared/remote-access.ts'
import { WebSocketServer } from 'ws'
const chrome = domBrowserExecutable()
test('Chromium/native P2P streams files, native images, Range, POST and cancellation without central data traffic', { skip: !chrome, timeout: 30_000 }, async t => {
  const bundle = await build({ input: 'virtual:remote-fixture', write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' }, plugins: [{ name: 'remote-fixture', resolveId(id) { if (id === 'virtual:remote-fixture') return id }, load(id) { if (id === 'virtual:remote-fixture') return `export * from '${new URL('../src/utils/remote-transport.ts', import.meta.url).pathname}';export * from '${new URL('../src/utils/remote-resources.ts', import.meta.url).pathname}';` } }] })
  const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  const appServer = http.createServer((req, res) => {
    if (req.url === '/api/binary') { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', 'attachment; filename="direct.bin"'); if (req.headers.range === 'bytes=100-109') { res.statusCode = 206; res.setHeader('Content-Range', 'bytes 100-109/1048576'); res.end(Buffer.alloc(10, 23)) } else res.end(Buffer.alloc(1024 * 1024, 23)); return }
    if (req.url === '/api/pixel') { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')); return }
    if (req.url === '/api/denied') { res.statusCode = 403; res.end('Denied'); return }
    if (req.url === '/api/post') { const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ bytes: Buffer.concat(chunks).length })) }); return }
    res.end(JSON.stringify({ ok: true }))
  })
  const sockets = new WebSocketServer({ noServer: true })
  appServer.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, ws => { ws.on('message', (data, binary) => ws.send(data, { binary })) }))
  t.after(() => sockets.close())
  const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  const helper = fork(new URL('./remote-access-rtc.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] })
  let helperError = ''; helper.stderr?.on('data', data => { helperError += data.toString() })
  const heartbeat = setInterval(() => { if (helper.connected) helper.send({ type: 'ping' }) }, 2000)
  t.after(() => { clearInterval(heartbeat); if (helper.connected) helper.send({ type: 'close' }); helper.kill() })
  const browser = await chromium.launch({ executablePath: chrome, chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const signalEvents: unknown[] = []
  const acknowledgements = new Map<string, () => void>()
  const dispatcher = remoteDispatcher(appServer, { send: data => new Promise<void>((resolve, reject) => {
    const id = crypto.randomUUID(); acknowledgements.set(id, resolve)
    helper.send({ type: 'send', id, data }, error => { if (error) reject(error) })
  }), close: () => {} }, () => owner, 'https://mew.saens.kr')
  t.after(() => dispatcher.close())
  helper.on('message', message => {
    const value = message as { type: string; data?: string; id?: string }
    if (value.type === 'data') void dispatcher.receive(value.data!)
    else if (value.type === 'sent') { acknowledgements.get(value.id!)?.(); acknowledgements.delete(value.id!) }
    else if (['answer', 'candidate'].includes(value.type)) signalEvents.push(value)
  })
  let centralWorkRequests = 0
  const fixture = http.createServer((req, res) => {
    if (req.url === '/remote-resource-worker.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(new URL('../public/remote-resource-worker.js', import.meta.url))); return }
    if (req.url?.startsWith('/api/')) { centralWorkRequests++; res.statusCode = 503; res.end('Central server does not handle work data'); return }
    if (req.url === '/events') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(signalEvents.splice(0))); return }
    if (req.url === '/signal') { let data = ''; req.on('data', chunk => { data += chunk }); req.on('end', () => { helper.send(JSON.parse(data)); res.end('{}') }); return }
    res.setHeader('Content-Type', 'text/html'); res.end(`<div id="root"></div><script>${code}</script><script>
      window.ready=false;window.failure='';const peer=new RTCPeerConnection({iceServers:[]});const channel=peer.createDataChannel('mew-app');
      const send=value=>fetch('/signal',{method:'POST',body:JSON.stringify(value)});
      peer.onicecandidate=e=>{if(e.candidate)send({type:'candidate',candidate:e.candidate.toJSON()})};
      channel.onopen=()=>{window.transport=new Remote.DataChannelTransport(channel);Remote.setRemoteTransport(window.transport);Remote.enableRemoteResources().then(()=>window.ready=true).catch(e=>window.failure=e.message)};
      peer.onconnectionstatechange=()=>{if(peer.connectionState==='failed')window.failure='ICE failed'};
      const poll=setInterval(async()=>{for(const v of await(await fetch('/events')).json()){if(v.type==='answer')await peer.setRemoteDescription({type:'answer',sdp:v.sdp});if(v.type==='candidate')await peer.addIceCandidate(v.candidate)}},10);
      (async()=>{const offer=await peer.createOffer();await peer.setLocalDescription(offer);await send({type:'start',sdp:offer.sdp,stun:[]})})();
    </script>`)
  })
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening'); t.after(() => new Promise<void>(resolve => fixture.close(() => resolve())))
  await page.goto(`http://127.0.0.1:${(fixture.address() as { port: number }).port}`)
  try { await page.waitForFunction('window.ready', { timeout: 8000 }) } catch (error) { throw new Error(`${error} ${helperError}`) }
  await page.locator('#root').evaluate(el => { const link = el.ownerDocument.createElement('a'); link.href = '/api/binary'; link.textContent = 'Native download'; el.append(link) })
  const downloading = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Native download', exact: true }).click()
  const download = await downloading
  assert.equal(await download.failure(), null)
  assert.deepEqual(fs.readFileSync((await download.path())!), Buffer.alloc(1024 * 1024, 23))
  const result = await page.locator('#root').evaluate(async el => {
    const window = el.ownerDocument.defaultView as unknown as { Remote: { setRemoteTransport(value: null): void; mewFetch(url: string, init: object): Promise<unknown> }; transport: { fetch(url: string, init?: object): Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>; socket(url: string): { binaryType: string; onopen?: () => void; onmessage?: (event: { data: ArrayBuffer }) => void; send(data: Uint8Array): void; close(): void } } }
    const bytes = new Uint8Array(await (await window.transport.fetch('/api/binary')).arrayBuffer())
    const controller = new AbortController(); controller.abort(); let cancelled = false
    try { await window.transport.fetch('/api/binary', { signal: controller.signal }) } catch (error) { cancelled = (error as { name: string }).name === 'AbortError' }
    const post = await (await window.transport.fetch('/api/post', { method: 'POST', body: new Uint8Array(36_000).fill(9) })).json()
    const denied = await window.transport.fetch('/api/denied', { method: 'POST', body: new Uint8Array(3 * 1024 * 1024) }); await denied.arrayBuffer()
    const range = await el.ownerDocument.defaultView!.fetch('/api/binary', { headers: { Range: 'bytes=100-109' } })
    const rangeBytes = new Uint8Array(await range.arrayBuffer())
    const image = el.ownerDocument.createElement('img'); el.append(image)
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Native image failed')); image.src = '/api/pixel' })
    const socket = window.transport.socket(`ws://${el.ownerDocument.defaultView!.location.host}/api/collab`); socket.binaryType = 'arraybuffer'
    await new Promise<void>(resolve => { socket.onopen = resolve })
    const echo = await new Promise<Uint8Array>(resolve => { socket.onmessage = event => resolve(new Uint8Array(event.data)); socket.send(new Uint8Array(140_000).fill(19)) }); socket.close()
    window.Remote.setRemoteTransport(null); let disconnected = false
    try { await window.Remote.mewFetch('/api/post', { method: 'POST', body: 'private work after disconnection' }) } catch { disconnected = true }
    return { length: bytes.length, first: bytes[0], last: bytes.at(-1), post, cancelled, denied: denied.status, disconnected, range: { status: range.status, contentRange: range.headers.get('Content-Range'), bytes: [...rangeBytes] }, image: { width: image.naturalWidth, height: image.naturalHeight }, socket: { length: echo.length, first: echo[0], last: echo.at(-1) } }
  })
  assert.deepEqual(result, { length: 1024 * 1024, first: 23, last: 23, post: { bytes: 36_000 }, cancelled: true, denied: 403, disconnected: true, range: { status: 206, contentRange: 'bytes 100-109/1048576', bytes: Array(10).fill(23) }, image: { width: 1, height: 1 }, socket: { length: 140_000, first: 19, last: 19 } })
  assert.equal(centralWorkRequests, 0)
  assert.ok(REMOTE_LIMITS.chunk < 32 * 1024)
})
