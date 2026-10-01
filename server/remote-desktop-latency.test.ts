import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopInput, type InputSnapshot } from '../src/utils/desktop-input.ts'
import { createInputReceiver } from '../native/remote-desktop/protocol.mjs'
import { validCursor, pointerBitmap, type DesktopCursor } from '../native/remote-desktop/cursor-protocol.mjs'
// @ts-expect-error Shared helper policy runs in Electron and Node.
import { relayAdaptation } from '../native/remote-desktop/relay-adaptation.mjs'

const cursor: DesktopCursor = { type: 'cursor', visible: true, seq: 0, x: .5, y: .5, width: 1920, height: 1080, shapeId: 1 }

test('local pointer updates precede network sends; stale corrections never rewind newer movement', t => {
  let time = 0; t.mock.method(performance, 'now', () => time)
  const positions: unknown[] = [], packets: InputSnapshot[] = []
  const input = desktopInput(() => assert.fail(), (...point) => positions.push(point))
  const channel = { readyState: 'open' as const, bufferedAmount: 0, send: (raw: string) => packets.push(JSON.parse(raw)) }
  input.connect('motion', channel); input.connect('control', channel)
  input.remoteCursor(cursor); input.localCursor(true)
  input.point(.8, .7)
  assert.deepEqual(positions.at(-1), [.8, .7, false]); assert.equal(packets.length, 0)
  input.remoteCursor({ ...cursor, x: .2 }); assert.deepEqual(positions.at(-1), [.8, .7, false])
  input.flushMotion(time)
  input.point(.9, .8); input.remoteCursor({ ...cursor, seq: packets[0].seq, x: .8 }); assert.deepEqual(positions.at(-1), [.9, .8, false])
  time = 80; input.flushMotion(time)
  input.remoteCursor({ ...cursor, seq: packets.at(-1)!.seq, x: .9, y: .8 }); assert.deepEqual(positions.at(-1), [.9, .8, undefined])
  input.remoteCursor({ ...cursor, seq: packets.at(-1)!.seq, x: 1.5 }); input.heartbeat()
  assert.equal(packets.at(-1)!.point, undefined, 'idle feedback never becomes pointer input')
  input.button(1, true)
  assert.deepEqual(packets.at(-1)!.point, [.9, .8], 'another monitor cannot put out-of-range coordinates on the input wire')
})

test('hover is capped at 30Hz; drag retains 60Hz; final lost motion and scroll arrive reliably', t => {
  let time = 0; t.mock.method(performance, 'now', () => time)
  const input = desktopInput(), motion: InputSnapshot[] = [], control: InputSnapshot[] = [], events: unknown[][] = []
  input.connect('motion', { readyState: 'open', bufferedAmount: 0, send: raw => motion.push(JSON.parse(raw)) })
  input.connect('control', { readyState: 'open', bufferedAmount: 0, send: raw => control.push(JSON.parse(raw)) })
  input.remoteCursor(cursor); input.localCursor(true)
  for (time = 0; time < 1000; time += 1000 / 240) { input.point(time / 2000, .5); input.flushMotion(time) }
  assert.ok(motion.length >= 26 && motion.length <= 31, `hover messages: ${motion.length}`)
  const hovered = motion.length; input.button(1, true)
  for (; time < 2000; time += 1000 / 240) { input.point(time / 3000, .5); input.flushMotion(time) }
  assert.ok(motion.length - hovered > 45 && motion.length - hovered <= 61)
  input.point(.91, .72); input.wheel(0, 120); input.flushMotion()
  const receiver = createInputReceiver({ moveTo: (...args: number[]) => events.push(['point', ...args]), move() {}, button: (...args: unknown[]) => events.push(['button', ...args]), wheel: (...args: number[]) => events.push(['wheel', ...args]), key() {} })
  // Deliver reliable transitions only: the last lossy packet is absent.
  for (const packet of control) receiver.accept(packet, true)
  time += 80; input.flushMotion(time); receiver.accept(control.at(-1), true)
  assert.deepEqual(events.slice(-2), [['point', .91, .72], ['wheel', 0, 120]])
  input.point(.95, .75); input.button(1, false); receiver.accept(control.at(-1), true)
  assert.deepEqual(events.slice(-2), [['point', .95, .75], ['button', 1, false]])
})

test('a stable high RTT does not collapse bitrate; additional delay and byte pressure do', () => {
  let now = 0; const control = relayAdaptation(() => now)
  for (; now <= 30_000; now += 1000) control.sample(280, 40_000)
  assert.ok(control.bitrate >= 2_500_000)
  const before = control.bitrate; now += 2001; control.sample(450, 40_000)
  assert.ok(control.bitrate < before)
  const after = control.bitrate; now += 2001; control.sample(280, 300_000)
  assert.ok(control.bitrate < after)
  assert.equal(control.sample(NaN, 0), null)
})

test('cursor packets and native bitmap dimensions are bounded before allocation/display', () => {
  assert.ok(validCursor(cursor))
  for (const bad of [{ x: NaN }, { seq: -1 }, { width: 5000 }, { shape: { width: 100000, height: 100000, png: 'anything' } }]) assert.equal(validCursor({ ...cursor, ...bad }), false)
  const color = pointerBitmap({ type: 2, width: 1, height: 1, pitch: 4, hotX: 0, hotY: 0 }, new Uint8Array([20, 30, 40, 255]))
  assert.deepEqual([...color.pixels], [20, 30, 40, 255])
  const mono = pointerBitmap({ type: 1, width: 2, height: 2, pitch: 1, hotX: 0, hotY: 0 }, new Uint8Array([0b01000000, 0]))
  assert.deepEqual([...mono.pixels], [0, 0, 0, 255, 0, 0, 0, 0])
  assert.throws(() => pointerBitmap({ type: 2, width: 129, height: 1, pitch: 516, hotX: 0, hotY: 0 }, new Uint8Array(516)))
  assert.throws(() => pointerBitmap({ type: 1, width: 8, height: 3, pitch: 1, hotX: 0, hotY: 0 }, new Uint8Array(3)))
})
