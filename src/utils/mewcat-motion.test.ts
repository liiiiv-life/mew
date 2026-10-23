import test from 'node:test'
import assert from 'node:assert/strict'
import { mewpetMotionEnabled, parseMewpetMotion } from '../../shared/mewpet-motion.ts'
import { apexDurationBeforeLanding, motionCycleDuration, motionFrameAt, motionMovementSpeed, nextMotionBoundary } from './mewcat-motion.ts'

test('custom cycle duration plays all frames and transitions stop at the final frame', () => {
  assert.deepEqual(Array.from({ length: 5 }, (_, frame) => motionFrameAt('walk', frame * 320 + 1, 5, 1600)), [0, 1, 2, 3, 4])
  assert.equal(motionFrameAt('walk', 1600, 5, 1600), 0)
  assert.equal(motionFrameAt('idle-walk', 599, 2, 1200), 0)
  assert.equal(motionFrameAt('idle-walk', 600, 2, 1200), 1)
  assert.equal(motionFrameAt('idle-walk', 2400, 2, 1200), 1)
})

test('disabled actions also disable dependent transitions, preserving required motions', () => {
  const motion = parseMewpetMotion({ enabled: { jump: false, run: false, fall: false } })
  for (const action of ['jump', 'run', 'fall', 'takeoff', 'apex', 'landing', 'walk-run', 'idle-run', 'run-idle', 'run-walk'] as const) assert.equal(mewpetMotionEnabled(action, motion), false, action)
  for (const action of ['idle', 'walk', 'struggle', 'idle-walk', 'walk-idle', 'love'] as const) assert.equal(mewpetMotionEnabled(action, motion), true, action)
  for (const value of [null, [], { enabled: [] }, { durations: { walk: -1 } }, { enabled: { love: 'false' } }, { movementSpeed: Infinity }]) assert.throws(() => parseMewpetMotion(value), /SKIN_MOTION_INVALID/)
})

test('stride skins keep the same ground distance per gait cycle at every size and speed', () => {
  for (const movementSpeed of [0.5, 1, 2]) for (const size of [24, 48, 144, 900]) {
    const motion = parseMewpetMotion({ stride: { walk: 40.96, run: 49.0666667 }, movementSpeed, durations: { walk: 640, run: 320 } })
    for (const action of ['walk', 'run'] as const) {
      const duration = motion.durations[action], cycle = motionCycleDuration(action, duration, motion)
      const speed = motionMovementSpeed(action, duration, size, 128, motion)
      assert.ok(Math.abs(speed * cycle / 1000 - motion.stride![action] * size / 128) < 1e-9)
      assert.equal(motionFrameAt(action, cycle / 2, 16, cycle), 8)
    }
    assert.equal(motionCycleDuration('walk-run', 240, motion), 240 / movementSpeed)
    assert.equal(motionCycleDuration('idle-walk', 240, motion), 240 / movementSpeed)
    for (const action of ['idle', 'love', 'jump', 'fall', 'takeoff', 'apex', 'landing', 'struggle'] as const) assert.equal(motionCycleDuration(action, 240, motion), 240)
  }
  const legacy = parseMewpetMotion({ movementSpeed: 2 })
  assert.equal(motionMovementSpeed('walk', 640, 144, 128, legacy), 96)
  assert.equal(motionMovementSpeed('run', 320, 144, 128, legacy), 230)
  assert.equal(motionCycleDuration('walk-run', 240, legacy), 240)
})

test('voluntary gait changes wait for a full source cycle', () => {
  assert.equal(nextMotionBoundary(100, 101, 640), 740)
  assert.equal(nextMotionBoundary(100, 740, 640), 740)
  assert.equal(nextMotionBoundary(100, 741, 640), 1380)
  assert.equal(nextMotionBoundary(100, 2020, 640), 2020)
})

test('short descents reserve a rendered fall pose before contact without delaying physics', () => {
  assert.equal(apexDurationBeforeLanding(320, 128, 0), 320)
  assert.ok(apexDurationBeforeLanding(320, 8, 0) > 75 && apexDurationBeforeLanding(320, 8, 0) < 77)
  assert.equal(apexDurationBeforeLanding(320, 0.5, 0), 0)
  assert.equal(apexDurationBeforeLanding(320, 0, 25), 0)
  assert.ok(apexDurationBeforeLanding(320, 8, 30) < 84)
  for (const frameMs of [16, 33, 50]) for (const height of [2, 8, 32, 128]) {
    const duration = apexDurationBeforeLanding(320, height, 15, frameMs)
    let y = -height, velocity = 15, contact = 0
    while (y < 0) {
      velocity += 1600 * frameMs / 1000
      y += velocity * frameMs / 1000
      contact += frameMs
    }
    assert.ok(Math.ceil(duration / frameMs) * frameMs < contact, `a fall frame precedes contact at ${height}px and ${frameMs}ms`)
  }
})
