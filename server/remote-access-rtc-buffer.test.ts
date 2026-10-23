import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { Script } from 'node:vm'

function fixture(t: TestContext, send: () => boolean) {
  let closes = 0, buffered = 0, sends = 0
  const emitted: { type: string; id?: string }[] = []
  const channel = { getLabel: () => 'mew-app', onOpen() {}, onClosed() {}, onError() {}, onMessage() {}, isOpen: () => closes === 0, bufferedAmount: () => buffered,
    sendMessage() { sends++; const result = send(); if (!result) buffered += 100; return result }, close() { closes++ } }
  class Peer {
    onLocalDescription() {}
    onLocalCandidate() {}
    onStateChange() {}
    onDataChannel(callback: (value: typeof channel) => void) { callback(channel) }
    setRemoteDescription() {}
    close() {}
  }
  const process = Object.assign(new EventEmitter(), { connected: true, send(value: typeof emitted[number]) { emitted.push({ ...value }) }, disconnect(this: EventEmitter & { connected: boolean }) { this.connected = false; this.emit('disconnect') } })
  const source = fs.readFileSync(new URL('./remote-access-rtc.mjs', import.meta.url), 'utf8').replace(/^import .+\n/gm, '')
  new Script(source, { filename: 'remote-access-rtc.mjs' }).runInNewContext({ rtc: { PeerConnection: Peer, cleanup() {} }, createWslLoopbackCandidate: () => () => undefined,
    nativeConnectivity: () => ({ candidate() {}, connected() {}, close() {} }), publicV4: () => false, isIP: () => 0,
    process, Buffer, Date, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {} })
  process.emit('message', { type: 'start', stun: [], sdp: 'fixture' })
  t.after(() => process.emit('message', { type: 'close' }))
  return { send: () => process.emit('message', { type: 'send', id: 'accepted', data: 'frame' }), emitted, closes: () => closes, sends: () => sends }
}

test('native sendMessage false accepts a buffered frame without closing or sending it twice', async t => {
  const h = fixture(t, () => false)
  h.send(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.closes(), 0)
  assert.equal(h.sends(), 1)
  assert.deepEqual(h.emitted, [{ type: 'sent', id: 'accepted' }])
})

test('native send exceptions still close the channel without acknowledging the frame', async t => {
  const h = fixture(t, () => { throw new Error('channel closed') })
  h.send(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.closes(), 1)
  assert.deepEqual(h.emitted, [])
})
