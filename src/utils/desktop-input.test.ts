import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopInput, desktopStick, clampView, HOLD_MS, STICK_TRAVEL, type InputSnapshot, type StickKind } from './desktop-input.ts'
// @ts-expect-error Native ES module is exercised directly by Node.
import { createInputReceiver, validSnapshot } from '../../native/remote-desktop/protocol.mjs'

function setup() {
  const events: unknown[][] = [], reliable: InputSnapshot[] = [], motion: InputSnapshot[] = []
  let now = 0
  const receiver = createInputReceiver({ button: (...args: unknown[]) => events.push(['button', ...args]), move: (...args: unknown[]) => events.push(['move', ...args]), moveTo: (...args: unknown[]) => events.push(['point', ...args]), wheel: (...args: unknown[]) => events.push(['wheel', ...args]), key: (...args: unknown[]) => events.push(['key', ...args]) }, () => now)
  const input = desktopInput()
  const channel = (target: InputSnapshot[]) => ({ readyState: 'open' as const, bufferedAmount: 0, send(value: string) { target.push(JSON.parse(value)) } })
  input.connect('control', channel(reliable)); input.connect('motion', channel(motion))
  return { input, receiver, events, reliable, motion, time(value: number) { now = value } }
}

test('lost and reordered movement recovers distance without erasing a reliable click', () => {
  const s = setup()
  s.input.heartbeat(); s.receiver.accept(s.reliable.shift())
  s.input.move(20, 10); s.input.flushMotion(); s.input.move(30, 20); s.input.flushMotion()
  s.receiver.accept(s.motion[1], false); s.receiver.accept(s.motion[0], false)
  assert.deepEqual(s.events, [['move', 50, 30]])
  s.input.click(1); s.input.move(10, 0); s.input.flushMotion()
  s.receiver.accept(s.motion[2], false) // Overtakes BOTH reliable button transitions.
  assert.equal(s.events.length, 1)
  for (const packet of s.reliable) s.receiver.accept(packet)
  assert.deepEqual(s.events.slice(1), [['button', 1, true], ['button', 1, false], ['move', 10, 0]])
})

test('absolute clicks land at the latest pointer position even if motion was lost', () => {
  const s = setup()
  s.input.point(.8, .2); s.input.button(4, true)
  s.receiver.accept(s.reliable[0])
  assert.deepEqual(s.events, [['point', .8, .2], ['button', 4, true]])
  s.input.heartbeat(); s.receiver.accept(s.reliable[1])
  assert.equal(s.events.length, 2, 'idle heartbeats do not repeatedly warp the physical cursor')
})

test('release, timeout and invalid packets cannot leave keys/buttons pressed', () => {
  const s = setup()
  s.input.button(2, true); s.input.key('ControlLeft', true)
  s.reliable.forEach(packet => s.receiver.accept(packet))
  s.time(1499); assert.equal(s.receiver.tick(), false)
  s.time(1501); assert.equal(s.receiver.tick(), true)
  assert.deepEqual(s.events.slice(-2), [['button', 2, false], ['key', 'ControlLeft', false]])
  assert.equal(validSnapshot({ ...s.reliable[0], x: Infinity }), false)
  assert.equal(validSnapshot({ ...s.reliable[0], keys: ['../../command'] }), false)
  assert.throws(() => s.receiver.accept({ type: 'exec', command: 'anything' }))
})

test('congested motion skips a packet and its next snapshot includes all distance', () => {
  const input = desktopInput(), packets: InputSnapshot[] = []
  const channel = { readyState: 'open' as const, bufferedAmount: 3000, send(value: string) { packets.push(JSON.parse(value)) } }
  input.connect('motion', channel); input.move(100, 40); input.flushMotion()
  assert.equal(packets.length, 0)
  channel.bufferedAmount = 0; input.move(5, 6); input.flushMotion()
  assert.deepEqual([packets[0].x, packets[0].y], [105, 46])
})

for (const [kind, bit] of [['left', 1], ['wheel', 2], ['right', 4]] as const) {
  test(`${kind} tap, immediate movement, hold-drag and cancellation`, () => {
    const events: unknown[][] = [], input = { button: (...args: unknown[]) => events.push(['button', ...args]), click: (...args: unknown[]) => events.push(['click', ...args]), move: (...args: unknown[]) => events.push(['move', ...args]), wheel: (...args: unknown[]) => events.push(['wheel', ...args]) }
    const stick = desktopStick(kind, input, () => {})
    stick.down(0); stick.up(); assert.deepEqual(events.pop(), ['click', bit])
    stick.down(0); stick.move(20, 20, 10)
    const visual = stick.tick(30)
    assert.ok(Math.hypot(visual.x, visual.y) <= STICK_TRAVEL + 1e-9)
    assert.equal(events[0][0], kind === 'wheel' ? 'wheel' : 'button')
    if (kind === 'wheel') assert.equal(events[0][1], 0)
    else { assert.deepEqual(events[0], ['button', bit, true]); assert.equal(events[1][0], 'move') }
    stick.tick(1000); stick.up()
    if (kind === 'wheel') assert.ok(!events.some(event => event[0] === 'button' || event[0] === 'click'))
    else assert.deepEqual(events.filter(event => event[0] === 'button'), [['button', bit, true], ['button', bit, false]])
    events.length = 0
    stick.down(0); stick.move(20, 15, HOLD_MS + 1); stick.tick(350); stick.up()
    assert.deepEqual(events[0], ['button', bit, true]); assert.equal(events[1][0], 'move'); assert.deepEqual(events.at(-1), ['button', bit, false])
    events.length = 0
    stick.down(0); stick.up(true); assert.equal(events.length, 0)
    stick.down(0); stick.tick(350); stick.up(true); assert.deepEqual(events, [['button', bit, true], ['button', bit, false]])
  })
}

test('cursor pad only moves, including taps, long holds and cancellation', () => {
  const movements: number[][] = [], input = { button() { assert.fail('cursor pad pressed a button') }, click() { assert.fail('cursor pad clicked') }, wheel() { assert.fail('cursor pad scrolled') }, move: (...args: number[]) => movements.push(args) }
  const stick = desktopStick('cursor', input, () => assert.fail('cursor pad changed the view'))
  stick.down(0); stick.up()
  stick.down(0); stick.tick(1000); stick.move(20, -20, 1010)
  assert.equal(stick.tick(1020).held, false)
  stick.up(true)
  assert.ok(movements[0][0] > 0 && movements[0][1] < 0)
})

test('pan/zoom stay local, zoom only uses the vertical axis, viewport stays bounded', () => {
  const input = { button() { assert.fail() }, click() { assert.fail() }, move() { assert.fail() }, wheel() { assert.fail() } }
  for (const kind of ['pan', 'zoom'] as StickKind[]) {
    const events: number[][] = [], stick = desktopStick(kind, input, (...args) => events.push(args))
    stick.down(0); stick.move(20, -20, 20); stick.tick(40); stick.up()
    assert.ok(events.length)
    if (kind === 'zoom') assert.deepEqual(events[0].slice(0, 2), [0, 0])
  }
  assert.deepEqual(clampView({ scale: 2, x: 99999, y: -99999 }, 400, 800), { scale: 2, x: 200, y: -400 })
  assert.deepEqual(clampView({ scale: .1, x: 999, y: 999 }, 400, 800), { scale: 1, x: 0, y: 0 })
  assert.deepEqual(clampView({ scale: 2, x: 999, y: 999 }, 400, 800, { width: 400, height: 225 }), { scale: 2, x: 200, y: 0 }, 'letterboxed video cannot be panned entirely off-screen')
})

for (const kind of ['cursor', 'left', 'right', 'wheel', 'pan', 'zoom'] as const) {
  test(`${kind} follows distance, stops while held and resets the next stroke`, () => {
    const events: unknown[][] = []
    const input = { button: (...args: unknown[]) => events.push(['button', ...args]), click: (...args: unknown[]) => events.push(['click', ...args]), move: (...args: unknown[]) => events.push(['move', ...args]), wheel: (...args: unknown[]) => events.push(['wheel', ...args]) }
    const stick = desktopStick(kind, input, (...args) => events.push(['view', ...args]))
    const motion = (x: number, y: number) => kind === 'pan' ? ['view', x, y, 0] : kind === 'zoom' ? ['view', 0, 0, -y / 100] : kind === 'wheel' ? ['wheel', 0, y * 3] : ['move', x * 2, y * 2]
    stick.down(0)
    stick.move(1, 1, 1)
    assert.deepEqual(events, [], 'tap slop does not move the cursor')
    stick.move(20, 10, 10)
    assert.deepEqual(events.at(-1), motion(20, 10), 'first motion includes the initial distance')
    const count = events.length
    for (const now of [16, 32, 100, 1000]) stick.tick(now)
    stick.move(20, 10, 1010)
    assert.equal(events.length, count, 'holding off-centre generates no motion')
    stick.move(19.5, 9.5, 1020)
    assert.deepEqual(events.at(-1), motion(-.5, -.5), 'small reversal is immediate even off-centre')
    stick.move(120, 50, 1030)
    assert.deepEqual(events.at(-1), motion(100.5, 40.5), 'knob radius never clamps input distance')
    stick.up()
    events.length = 0
    stick.down(2000); stick.move(4, 3, 2010); stick.up()
    assert.deepEqual(events.filter(event => event[0] !== 'button'), [motion(4, 3)], 'a quick new stroke needs no animation frame and has a fresh origin')
    events.length = 0
    stick.move(40, 30, 2020); stick.tick(3000)
    assert.deepEqual(events, [], 'released controls cannot move')
  })
}

test('middle-button dragging also stops while held and reverses immediately', () => {
  const events: unknown[][] = []
  const stick = desktopStick('wheel', {
    button: (...args) => events.push(['button', ...args]), click() { assert.fail() },
    move: (...args) => events.push(['move', ...args]), wheel() { assert.fail() },
  }, () => assert.fail())
  stick.down(0); stick.tick(HOLD_MS)
  stick.move(20, 10, 400); stick.tick(1000); stick.move(19, 9, 1010); stick.up(true)
  assert.deepEqual(events, [['button', 2, true], ['move', 40, 20], ['move', -2, -2], ['button', 2, false]])
})
