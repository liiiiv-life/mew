import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { build } from 'rolldown'
import { chromium } from 'playwright-core'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { AuthenticatedSession } from './auth.ts'
import { REMOTE_LIMITS } from '../shared/remote-access.ts'

test('browser response window removes chunk RTT waterfall and bounds unread responses, with legacy fallback', { skip: !domBrowserExecutable(), timeout: 20_000 }, async t => {
  const bundle = await build({ input: new URL('../src/utils/remote-transport.ts', import.meta.url).pathname, write: false, platform: 'browser', output: { format: 'iife', name: 'Remote' } })
  const code = bundle.output.find(item => item.type === 'chunk')!.code
  const browser = await chromium.launch({ executablePath: domBrowserExecutable(), chromiumSandbox: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const app = http.createServer((req, res) => res.end(Buffer.alloc(REMOTE_LIMITS.chunk * (req.url === '/api/large' ? 12 : 7) + 7, 23)))
  const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  let dispatcher: ReturnType<typeof remoteDispatcher>
  let legacy = false, chunks = 0, closed = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const delay = (callback: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); callback() }, 50)
    timers.add(timer)
  }
  t.after(() => { dispatcher?.close(); for (const timer of timers) clearTimeout(timer) })
  await page.exposeFunction('nodeSend', (raw: string) => {
    const frame = JSON.parse(raw)
    if (legacy && frame.type === 'request') delete frame.responseWindow
    delay(() => { void dispatcher.receive(JSON.stringify(frame)) })
  })
  await page.route('https://mew-window.test/**', route => route.fulfill({ contentType: 'text/html', body: `<script>${code}</script><script>
class Channel extends EventTarget {readyState='open';bufferedAmount=0;send(raw){window.nodeSend(raw)}close(){this.readyState='closed'}}
window.connect=()=>{window.channel=new Channel();window.transport=new Remote.DataChannelTransport(window.channel)};
window.deliver=raw=>window.channel.dispatchEvent(new MessageEvent('message',{data:raw}));window.connect();
</script>` }))
  await page.goto('https://mew-window.test/')
  const connect = async (oldPeer: boolean) => {
    dispatcher?.close()
    for (const timer of timers) clearTimeout(timer)
    timers.clear(); legacy = oldPeer; chunks = 0; closed = false
    dispatcher = remoteDispatcher(app, { send: async raw => {
      if (JSON.parse(raw).type === 'chunk') chunks++
      delay(() => { void page.evaluate(raw => (globalThis as unknown as { deliver(raw: string): void }).deliver(raw), raw) })
    }, close: () => { closed = true } }, () => owner, 'https://mew-window.test')
    await page.evaluate('window.connect()')
  }
  const read = () => page.evaluate(`(async()=>{const start=performance.now();const response=await window.transport.fetch('/api/list');const bytes=new Uint8Array(await response.arrayBuffer());return {elapsed:performance.now()-start,size:bytes.length,valid:bytes.every(byte=>byte===23)}})()`)
  await connect(true)
  const old = await read() as { elapsed: number; size: number; valid: boolean }
  assert.equal(old.valid, true)
  assert.equal(closed, false)
  await connect(false)
  const current = await read() as typeof old
  assert.equal(current.valid, true)
  assert.equal(current.size, old.size)
  assert.ok(current.elapsed < old.elapsed * 0.6, `${current.elapsed}ms window vs ${old.elapsed}ms legacy at simulated RTT 100ms`)
  t.diagnostic(`simulated RTT 100ms / ${current.size}B: legacy ${old.elapsed.toFixed(1)}ms, window ${current.elapsed.toFixed(1)}ms`)
  assert.equal(closed, false)

  await connect(false)
  await page.evaluate("window.transport.fetch('/api/large').then(response=>window.unread=response)")
  await page.waitForTimeout(300)
  assert.equal(chunks, 8, 'unread browser response queues at most eight chunks')
  const size = await page.evaluate('(async()=> (await window.unread.arrayBuffer()).byteLength)()')
  assert.equal(size, REMOTE_LIMITS.chunk * 12 + 7)
  assert.equal(closed, false)
  assert.deepEqual(errors, [])
})
