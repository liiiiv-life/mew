import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { WebSocketServer } from 'ws'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import { REMOTE_LIMITS } from '../shared/remote-access.ts'
import type { AuthenticatedSession } from './auth.ts'

const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
const bridge = `window.bridge=()=>{const previous=window.transport,c=new MessageChannel(),wire=new EventTarget();wire.readyState='open';wire.bufferedAmount=0;wire.send=raw=>c.port1.postMessage(raw);wire.close=()=>{wire.readyState='closed';c.port1.close();c.port2.close()};c.port1.onmessage=e=>wire.dispatchEvent(new MessageEvent('message',{data:e.data}));c.port2.onmessage=e=>previous.forward(JSON.parse(e.data)).catch(e=>window.failure=e.message);previous.channel.addEventListener('message',e=>c.port2.postMessage(e.data));c.port1.start();c.port2.start();window.transport=new Remote.DataChannelTransport(wire)};`

test('two-port consumers negotiate adaptive HTTP/WS credit at RTT 100ms while unread and cancelled bodies remain bounded', { skip: !domBrowserExecutable(), timeout: 30_000 }, async t => {
  const bundle = await build({ input: new URL('../src/utils/remote-transport.ts', import.meta.url).pathname, write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' } })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true }); t.after(() => browser.close())
  const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const app = http.createServer((req, res) => res.end(Buffer.alloc(req.url === '/api/large' ? 4 * 1024 * 1024 : 17, 23)))
  const sockets = new WebSocketServer({ noServer: true })
  app.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, ws => ws.on('message', () => ws.send(Buffer.alloc(1024 * 1024, 23)))))
  let dispatcher: ReturnType<typeof remoteDispatcher>, legacy = false, chunks = 0, closed = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (run: () => void) => { const timer = setTimeout(() => { timers.delete(timer); run() }, 50); timers.add(timer) }
  t.after(() => { dispatcher?.close(); for (const timer of timers) clearTimeout(timer); for (const ws of sockets.clients) ws.terminate(); sockets.close() })
  await page.exposeFunction('nodeSend', (raw: string) => { const frame = JSON.parse(raw); if (legacy && ['request', 'socket'].includes(frame.type)) delete frame.flowControl; later(() => { void dispatcher.receive(JSON.stringify(frame)) }) })
  await page.route('https://mew-flow.test/**', route => route.fulfill({ contentType: 'text/html', body: `<script>${code}</script><script>
class Channel extends EventTarget{readyState='open';bufferedAmount=0;send(raw){window.nodeSend(raw)}close(){this.readyState='closed'}}
${bridge}
window.connect=()=>{window.channel=new Channel();window.transport=new Remote.DataChannelTransport(window.channel);window.bridge();window.bridge()};window.deliver=raw=>window.channel.dispatchEvent(new MessageEvent('message',{data:raw}));window.connect();
</script>` }))
  await page.goto('https://mew-flow.test/')
  const connect = async (old: boolean) => {
    dispatcher?.close(); for (const timer of timers) clearTimeout(timer); timers.clear(); legacy = old; chunks = 0; closed = false
    dispatcher = remoteDispatcher(app, { send: async raw => { if (JSON.parse(raw).type === 'chunk') chunks++; later(() => { void page.evaluate(raw => (globalThis as unknown as { deliver(raw: string): void }).deliver(raw), raw).catch(() => {}) }) }, close: () => { closed = true } }, () => owner, 'https://mew-flow.test')
    await page.evaluate('window.connect()')
  }
  const read = () => page.evaluate(`(async()=>{const start=performance.now();const response=await window.transport.fetch('/api/large');const bytes=new Uint8Array(await response.arrayBuffer());return{elapsed:performance.now()-start,size:bytes.length,valid:bytes.every(x=>x===23)}})()` ) as Promise<{ elapsed: number; size: number; valid: boolean }>
  await connect(true); const old = await read(); assert.equal(closed, false)
  await connect(false); const current = await read(); assert.equal(closed, false)
  assert.equal(current.valid, true); assert.equal(current.size, old.size)
  assert.ok(current.elapsed < old.elapsed * 0.65, `${current.elapsed}ms adaptive vs ${old.elapsed}ms legacy window`)
  t.diagnostic(`RTT 100ms / ${current.size}B: legacy eight ${old.elapsed.toFixed(1)}ms, adaptive ${current.elapsed.toFixed(1)}ms`)
  const socket = await page.evaluate(`(async()=>{const started=performance.now(),ws=window.transport.socket('/api/agent/ws');ws.binaryType='arraybuffer';await new Promise(r=>ws.onopen=r);const size=await new Promise(r=>{ws.onmessage=e=>r(e.data.byteLength);ws.send('start')});ws.close();return{elapsed:performance.now()-started,size}})()`) as { elapsed: number; size: number }
  assert.equal(socket.size, 1024 * 1024); assert.ok(socket.elapsed < 2000, `${socket.elapsed}ms adaptive WS at RTT 100ms`)
  t.diagnostic(`RTT 100ms / WS ${socket.size}B: ${socket.elapsed.toFixed(1)}ms`)

  await connect(false)
  await page.evaluate("window.transport.fetch('/api/large').then(response=>window.unread=response)")
  await page.waitForTimeout(350); assert.equal(chunks, 8, 'a high-latency unread body retains its initial 96KiB cap')
  const before = chunks
  const sibling = await page.evaluate(`(async()=>{const r=await window.transport.fetch('/api/health');return(await r.arrayBuffer()).byteLength})()`)
  assert.equal(sibling, 17); assert.equal(chunks, before + 1)
  await page.evaluate('window.unread.body.cancel()'); await page.waitForTimeout(120)
  assert.equal(closed, false); assert.equal(chunks, before + 1, 'cancellation does not send late credits')
  await connect(false)
  await page.evaluate(`(async()=>{const response=await window.transport.fetch('/api/large');window.slow=response.body.getReader();await window.slow.read()})()`)
  await page.waitForTimeout(350)
  assert.ok(chunks <= 257, 'slow consumption remains bounded by at most 3MiB plus the consumed chunk')
  const slowSibling = await page.evaluate(`(async()=>{const r=await window.transport.fetch('/api/health');await r.arrayBuffer();for(let i=0;i<3;i++){await window.slow.read();await new Promise(r=>setTimeout(r,100))}await window.slow.cancel();return true})()`)
  assert.equal(slowSibling, true); assert.equal(closed, false)
  const independent = await page.evaluate(`(async()=>{const sockets=Array.from({length:16},()=>window.transport.socket('/api/presence'));await Promise.all(sockets.map(ws=>new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onclose=reject})));const start=performance.now(),response=await window.transport.fetch('/api/health');const bytes=(await response.arrayBuffer()).byteLength;const elapsed=performance.now()-start;for(const ws of sockets)ws.close();return{bytes,elapsed}})()`) as { bytes: number; elapsed: number }
  assert.equal(independent.bytes, 17); assert.ok(independent.elapsed < 1000, 'sixteen persistent sockets do not consume the HTTP pool through either bridge')
  assert.deepEqual(errors, [])
  assert.equal(REMOTE_LIMITS.responseWindow, 8, 'the legacy protocol limit remains unchanged')
})
