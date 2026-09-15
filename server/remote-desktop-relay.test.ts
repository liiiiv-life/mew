import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { packFrame, readFrame, relayWindow, MAX_FRAME_BYTES } from '../native/remote-desktop/relay-protocol.mjs'
import { hostFrame, hostReader } from '../native/remote-desktop/host-wire.mjs'
import { desktopRelay } from './desktop-relay.ts'

const packet = (seq = 1, size = 32) => packFrame({ seq, timestamp: seq * 33_333, width: 1280, height: 720, key: seq === 1 }, new Uint8Array(size).fill(10))

test('native pipe preserves arbitrary binary/text boundaries including embedded control-looking bytes', () => {
  const binary = packet(), text = Buffer.from('MEW_DESKTOP {"type":"sources","label":"한글"}\n')
  binary.set(new TextEncoder().encode('MEW_DESKTOP {}\n'), 24)
  const wire = Buffer.concat([Buffer.from('unrelated diagnostic\n'), text, hostFrame(binary), text, hostFrame(packet(2))])
  for (const size of [1, 7, 19, 1024]) {
    const messages: unknown[] = [], frames: Buffer[] = [], read = hostReader(value => messages.push(value), value => frames.push(value))
    for (let offset = 0; offset < wire.length; offset += size) read(wire.subarray(offset, offset + size))
    assert.deepEqual(messages, [{ type: 'sources', label: '한글' }, { type: 'sources', label: '한글' }])
    assert.deepEqual(frames, [Buffer.from(binary), Buffer.from(packet(2))])
  }
  const read = hostReader(() => {}, () => {})
  assert.throws(() => read(Buffer.from('MEW_DESKTOP_FRAME 9999999\n')))
  assert.throws(() => hostReader(() => {}, () => {})(Buffer.alloc(128 * 1024 + 1, 32)))
})

test('wire rejects unknown versions, invalid dimensions, timestamps and oversized frames before decoding', () => {
  assert.equal(readFrame(packet()).data.byteLength, 32)
  for (const mutate of [(data: Uint8Array) => data[0] = 0, (data: Uint8Array) => data[21] = 1, (data: Uint8Array) => new DataView(data.buffer).setFloat64(8, NaN), (data: Uint8Array) => new DataView(data.buffer).setUint16(16, 65535)]) {
    const value = packet(); mutate(value); assert.throws(() => readFrame(value))
  }
  assert.throws(() => readFrame(new Uint8Array(MAX_FRAME_BYTES + 1)))
  assert.throws(() => readFrame(new Uint8Array(24)))
})

test('display credit bounds buffered frames and bytes; duplicate ACK cannot grant extra credit', () => {
  let now = 0
  const window = relayWindow(() => now)
  for (let seq = 1; seq <= 4; seq++) window.sent(seq, 100)
  assert.equal(window.available(), false)
  assert.throws(() => window.sent(5, 100))
  assert.throws(() => window.ack(5))
  assert.equal(window.count, 4)
  now = 120
  assert.equal(window.ack(2), 120)
  assert.equal(window.ack(2), null)
  assert.equal(window.count, 2); assert.equal(window.bytes, 200)
  window.sent(5, 100)
  now = 10_001
  assert.equal(window.expired(), true)
  window.ack(5)
  assert.equal(window.expired(), false); assert.equal(window.bytes, 0)
  window.sent(6, MAX_FRAME_BYTES)
  assert.equal(window.available(), false)
})

test('server relay only accepts validated input after transition and forwards identical compressed bytes', () => {
  const sent: unknown[] = [], written: unknown[] = []
  const socket = { readyState: WebSocket.OPEN, bufferedAmount: 0, send(value: unknown) { sent.push(value) } } as unknown as WebSocket
  const relay = desktopRelay(socket, value => written.push(value))
  assert.throws(() => relay.accept({ type: 'relay-input', reliable: true, value: { type: 'paste', text: 'x' } }))
  assert.throws(() => relay.frame(Buffer.from(packet())))
  relay.start()
  assert.throws(() => relay.start())
  assert.throws(() => relay.accept({ type: 'relay-input', reliable: true, value: { type: 'exec', command: 'x' } }))
  assert.throws(() => relay.accept({ type: 'relay-input', reliable: false, value: { type: 'paste', text: 'x' } }))
  relay.accept({ type: 'relay-input', reliable: true, value: { type: 'paste', text: '한글' } })
  relay.frame(Buffer.from(packet()))
  assert.deepEqual(sent, [Buffer.from(packet())])
  assert.throws(() => relay.accept({ type: 'frame-ack', seq: 2 }))
  relay.accept({ type: 'frame-ack', seq: 1 })
  assert.deepEqual(written, [{ type: 'relay' }, { type: 'relay-input', reliable: true, value: { type: 'paste', text: '한글' } }, { type: 'frame-ack', seq: 1, keyframe: false }])
  relay.status({ type: 'relay-status', seq: 1, idle: true, ackMs: 280, bitrate: 2_500_000 })
  assert.throws(() => relay.status({ seq: 2, idle: true, ackMs: 280, bitrate: 2_500_000 }))
  assert.throws(() => relay.status({ seq: 1, idle: 'yes', ackMs: 280, bitrate: 2_500_000 }))
  Object.defineProperty(socket, 'bufferedAmount', { value: MAX_FRAME_BYTES * 3 })
  assert.throws(() => relay.frame(Buffer.from(packet(2))), /congested/)
})
