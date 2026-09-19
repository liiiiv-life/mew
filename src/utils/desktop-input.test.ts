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
    const checkMotion = (x: number, y: number) => {
      if (kind === 'pan' || kind === 'zoom' || kind === 'wheel') {
        assert.deepEqual(events.at(-1), kind === 'pan' ? ['view', x, y, 0] : kind === 'zoom' ? ['view', 0, 0, -y / 100] : ['wheel', 0, y * 3])
      } else {
        const [type, mx, my] = events.filter(event => event[0] !== 'button').at(-1) as [string, number, number]
        assert.equal(type, 'move'); assert.equal(Math.sign(mx), Math.sign(x)); assert.equal(Math.sign(my), Math.sign(y))
        assert.ok(Math.abs(mx / my - x / y) < 1e-10, 'acceleration preserves the direction')
      }
    }
    stick.down(0)
    stick.move(1, 1, 1)
    assert.deepEqual(events, [], 'tap slop does not move the cursor')
    stick.move(20, 10, 10)
    checkMotion(20, 10)
    const count = events.length
    for (const now of [16, 32, 100, 1000]) stick.tick(now)
    stick.move(20, 10, 1010)
    assert.equal(events.length, count, 'holding off-centre generates no motion')
    stick.move(19.5, 9.5, 1020)
    checkMotion(-.5, -.5)
    stick.move(120, 50, 1030)
    checkMotion(100.5, 40.5)
    stick.up()
    events.length = 0
    stick.down(2000); stick.move(4, 3, 2010); stick.up()
    assert.equal(events.filter(event => event[0] !== 'button').length, 1, 'a quick new stroke needs no animation frame'); checkMotion(4, 3)
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
  assert.deepEqual(events.filter(event => event[0] === 'button'), [['button', 2, true], ['button', 2, false]])
  const motion = events.filter(event => event[0] === 'move') as [string, number, number][]
  assert.equal(motion.length, 2); assert.ok(motion[0][1] > 0 && motion[0][2] > 0); assert.ok(motion[1][1] < 0 && motion[1][2] < 0)
})


for (const kind of ['cursor', 'left', 'right', 'wheel'] as const) {
  test(`${kind} pointer acceleration: 100px in 50ms travels ten times farther than in 500ms`, () => {
    const stroke = (duration: number, samples: number) => {
      let distance = 0
      const stick = desktopStick(kind, { button() {}, click() {}, wheel() { assert.fail('expected pointer drag') }, move(x, y) { distance += x; assert.equal(y, 0) } }, () => assert.fail())
      stick.down(0)
      const start = kind === 'wheel' ? HOLD_MS : 0
      if (start) { stick.tick(start); stick.move(0, 0, start) }
      // Start after the hold with an explicit stationary sample, so hold time is not speed.
      for (let i = 1; i <= samples; i++) stick.move(100 * i / samples, 0, start + duration * i / samples)
      stick.up()
      return distance
    }
    for (const samples of [1, 10, 100]) {
      assert.ok(Math.abs(stroke(500, samples) - 200) < 1e-8)
      assert.ok(Math.abs(stroke(50, samples) - 2000) < 1e-8)
    }
  })
}

test('acceleration stops immediately, resets on a new stroke and bounds zero-time samples', () => {
  const moves: number[][] = []
  const stick = desktopStick('cursor', { button() {}, click() {}, wheel() {}, move: (...xy) => moves.push(xy) }, () => {})
  stick.down(0); stick.move(100, 0, 50)
  assert.deepEqual(moves, [[2000, 0]])
  stick.tick(1000); stick.move(100, 0, 1000); assert.equal(moves.length, 1)
  stick.move(99, 0, 1050); assert.ok(Math.abs(moves[1][0] + .2) < 1e-10, 'slow reversal immediately uses the slower gain')
  stick.up(); stick.down(2000); stick.move(100, 0, 2500); assert.deepEqual(moves[2], [200, 0])
  stick.move(101, 0, 2500); assert.equal(moves[3][0], 10)
  stick.move(201, 0, 2499); assert.equal(moves[4][0], 3200)
  stick.move(NaN, 0, 3000); assert.equal(moves.length, 5)
  stick.up(true); stick.move(500, 0, 4000); assert.equal(moves.length, 5)
})
