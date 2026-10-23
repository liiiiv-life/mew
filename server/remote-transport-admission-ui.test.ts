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

test('without separate-pool negotiation app and assets share sixteen streams and cancel queued work', { skip: !domBrowserExecutable(), timeout: 20_000 }, async t => {
  const bundle = await build({ input: new URL('../src/utils/remote-transport.ts', import.meta.url).pathname, write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' } })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const held: http.ServerResponse[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const app = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/hold')) { held.push(res); return }
    const timer = setTimeout(() => { timers.delete(timer); res.end(req.url) }, 40)
    timers.add(timer)
  })
  const sockets = new WebSocketServer({ noServer: true })
  app.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, () => {}))
  const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  let dispatcher: ReturnType<typeof remoteDispatcher>, peak = 0
  const active = new Set<string>(), paths: string[] = []
  t.after(() => { dispatcher?.close(); for (const timer of timers) clearTimeout(timer); for (const ws of sockets.clients) ws.terminate(); sockets.close() })
  await page.exposeFunction('nodeSend', async (raw: string) => {
    const frame = JSON.parse(raw)
    if (frame.flowControl) delete frame.flowControl.separateStreams
    if (frame.type === 'request' || frame.type === 'socket') { active.add(frame.id); peak = Math.max(peak, active.size); if (frame.path) paths.push(frame.path) }
    if (frame.type === 'cancel' || frame.type === 'close') active.delete(frame.id)
    await dispatcher.receive(JSON.stringify(frame))
  })
  await page.route('https://mew-admission.test/**', route => route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><script>${code}</script><script>
class Wire extends EventTarget {readyState='open';bufferedAmount=0;send(raw){window.nodeSend(raw)}close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'))}}
window.channel=new Wire();window.transport=new Remote.DataChannelTransport(window.channel);
window.appChannel=new Wire();window.appChannel.send=raw=>{void window.transport.forward(JSON.parse(raw)).catch(()=>window.app.close())};
window.app=new Remote.DataChannelTransport(window.appChannel);
window.channel.addEventListener('message',event=>window.appChannel.dispatchEvent(new MessageEvent('message',{data:event.data})));
window.channel.addEventListener('close',()=>window.app.close());
window.deliver=raw=>window.channel.dispatchEvent(new MessageEvent('message',{data:raw}));
</script>` }))
  dispatcher = remoteDispatcher(app, { send: async raw => {
    const frame = JSON.parse(raw)
    if (['end', 'error', 'close'].includes(frame.type)) active.delete(frame.id)
    await page.evaluate(raw => (globalThis as unknown as { deliver(raw: string): void }).deliver(raw), raw)
  }, close: () => {} }, () => owner, 'https://mew-admission.test')
  await page.goto('https://mew-admission.test/')
  await page.evaluate(`(async()=>{window.sockets=Array.from({length:4},()=>window.app.socket('/api/presence'));await Promise.all(window.sockets.map(ws=>new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onclose=reject})))})()`)
  const responses = await page.evaluate(`Promise.all(Array.from({length:48},async(_,i)=>{const transport=i%2?window.app:window.transport;return(await transport.fetch('/api/burst?i='+i)).text()}))`) as string[]
  assert.equal(responses.length, 48)
  assert.ok(responses.every((value, i) => value === '/api/burst?i=' + i))
  assert.equal(peak, REMOTE_LIMITS.streams)
  assert.equal(active.size, 4)

  await page.evaluate(`window.held=Array.from({length:12},(_,i)=>window.transport.fetch('/api/hold?i='+i).catch(e=>e.message));`)
  await page.waitForFunction('window.transport.requests.size===12')
  const abort = await page.evaluate(`(async()=>{const c=new AbortController();const request=window.transport.fetch('/api/queued-abort',{signal:c.signal}).catch(e=>e.name);c.abort();return request})()`)
  assert.equal(abort, 'AbortError')
  assert.ok(!paths.includes('/api/queued-abort'))
  await page.evaluate(`window.transport.socket('/api/presence?queued-cancel').close()`)
  assert.ok(!paths.includes('/api/presence?queued-cancel'))
  await page.evaluate(`window.closedRequests=[window.transport.fetch('/api/queued-close'),window.app.fetch('/api/queued-app-close')].map(p=>p.catch(e=>e.message));`)
  const closed = await page.evaluate(`(async()=>{window.transport.close();return Promise.all(window.closedRequests)})()`) as string[]
  assert.deepEqual(closed, ['원격 연결이 종료됐습니다.', '원격 연결이 종료됐습니다.'])
  assert.ok(!paths.includes('/api/queued-close') && !paths.includes('/api/queued-app-close'))
  await page.evaluate('Promise.all(window.held)')
  assert.deepEqual(errors, [])
})
