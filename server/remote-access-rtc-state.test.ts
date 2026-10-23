import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { Script } from 'node:vm'

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let state: (value: string) => void = () => {}, closes = 0, cleaned = 0
  class Peer {
    onLocalDescription() {}
    onLocalCandidate() {}
    onDataChannel() {}
    onStateChange(callback: typeof state) { state = callback }
    setRemoteDescription() {}
    close() { closes++; state('closed') }
  }
  const process = Object.assign(new EventEmitter(), { connected: true, send() {}, disconnect(this: EventEmitter & { connected: boolean }) { this.connected = false; this.emit('disconnect') } })
  const source = fs.readFileSync(new URL('./remote-access-rtc.mjs', import.meta.url), 'utf8').replace(/^import .+\n/gm, '')
  new Script(source, { filename: 'remote-access-rtc.mjs' }).runInNewContext({
    rtc: { PeerConnection: Peer, cleanup() { cleaned++ } }, createWslLoopbackCandidate: () => () => undefined,
    nativeConnectivity: () => ({ candidate() {}, connected() {}, close() {} }), publicV4: () => false, isIP: () => 0,
    process, Buffer, Date, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
  })
  process.emit('message', { type: 'start', stun: [], sdp: 'fixture' })
  t.after(() => process.emit('message', { type: 'close' }))
  return { state: (value: string) => state(value), closed: () => closes, cleaned: () => cleaned, process }
}

test('native RTC keeps a temporarily disconnected peer alive and cancels its recovery timeout', t => {
  const h = fixture(t)
  h.state('connected'); h.state('disconnected')
  assert.equal(h.closed(), 0)
  t.mock.timers.tick(14_999)
  h.state('connected')
  t.mock.timers.tick(15_000)
  assert.equal(h.closed(), 0)
  assert.equal(h.process.connected, true)
})

test('native RTC ends a persistent disconnect once after the original deadline', async t => {
  const h = fixture(t)
  h.state('disconnected')
  t.mock.timers.tick(10_000)
  h.state('disconnected')
  t.mock.timers.tick(5000)
  assert.equal(h.closed(), 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.cleaned(), 1)
  assert.equal(h.process.connected, false)
})

for (const cause of ['failed', 'closed', 'parent']) {
  test(`native RTC ${cause} closes immediately during the recovery window`, async t => {
    const h = fixture(t)
    h.state('disconnected')
    if (cause === 'parent') h.process.emit('message', { type: 'close' }); else h.state(cause)
    assert.equal(h.closed(), 1)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.cleaned(), 1)
    t.mock.timers.tick(15_000)
    assert.equal(h.closed(), 1)
  })
}
