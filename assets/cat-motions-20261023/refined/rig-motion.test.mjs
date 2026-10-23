import assert from 'node:assert/strict'
import test from 'node:test'
import { RIG, MOTIONS, inspectRig, jointsFor, poseAt } from './rig-motion.mjs'

const shape = pose => ({ body: pose.body, head: pose.head, feet: pose.feet, tailPhase: pose.tailPhase })
const numbers = pose => [...Object.values(pose.body), ...Object.values(pose.head), ...pose.feet.flatMap(foot => [foot.x, foot.y]), pose.tailPhase]
const pairs = {
  'idle-walk': ['idle', 'walk'], 'walk-idle': ['walk', 'idle'], 'idle-run': ['idle', 'run'],
  'run-idle': ['run', 'idle'], 'walk-run': ['walk', 'run'], 'run-walk': ['run', 'walk'],
  takeoff: ['idle', 'jump'], apex: ['jump', 'fall'], landing: ['fall', 'idle'],
}

test('all seven loops and nine independent transitions have native frame timing', () => {
  assert.equal(MOTIONS.length, 16)
  assert.equal(MOTIONS.filter(motion => motion.loop).length, 7)
  assert.equal(new Set(MOTIONS.map(motion => motion.name)).size, 16)
  for (const motion of MOTIONS) {
    assert.equal(motion.durationMs % 20, 0)
    assert.ok(motion.frames >= 16)
  }
  assert.equal(RIG.ground, 110)
  assert.equal(RIG.ankleY, 107)
})

test('every transition matches its source and target silhouette exactly', () => {
  for (const [name, [source, target]] of Object.entries(pairs)) {
    assert.deepEqual(shape(poseAt(name, 0)), shape(poseAt(source, 0)), `${name}: start`)
    assert.deepEqual(shape(poseAt(name, 1)), shape(poseAt(target, 0)), `${name}: end`)
    assert.notDeepEqual(shape(poseAt(name, 0.5)), shape(poseAt(name, 0)), `${name}: distinct motion`)
  }
})

test('loop poses and velocities join continuously without a repeated terminal frame', () => {
  const h = 0.00001
  for (const motion of MOTIONS.filter(motion => motion.loop)) {
    assert.deepEqual(shape(poseAt(motion.name, 0)), shape(poseAt(motion.name, 1)), motion.name)
    const zero = numbers(poseAt(motion.name, 0)), a = numbers(poseAt(motion.name, h)), b = numbers(poseAt(motion.name, 2 * h))
    const y = numbers(poseAt(motion.name, 1 - h)), z = numbers(poseAt(motion.name, 1 - 2 * h)), seconds = motion.durationMs / 1000
    for (let i = 0; i < zero.length; i++) {
      const outgoing = (-3 * zero[i] + 4 * a[i] - b[i]) / (2 * h * seconds)
      const incoming = (3 * zero[i] - 4 * y[i] + z[i]) / (2 * h * seconds)
      assert.ok(Math.abs(outgoing - incoming) < 0.02, `${motion.name} component ${i}: ${outgoing} vs ${incoming}`)
    }
  }
})

test('dense motion samples preserve bone lengths, torso span, foot plants and reach', () => {
  const report = inspectRig(2000)
  assert.deepEqual(report.failures, [])
  assert.ok(report.maxBoneError < 1e-8)
  assert.ok(report.maxTorsoError < 1e-8)
  assert.ok(report.maxContactDrift < 1e-8)
  assert.ok(report.minPawSeparation >= 6.5)
  for (const motion of report.motions) assert.equal(motion.closePawSamples, 0, `${motion.name}: paw centres came within 6.5px`)
  assert.equal(report.motions.find(motion => motion.name === 'walk').aerialRatio, 0)
  const runAir = report.motions.find(motion => motion.name === 'run').aerialRatio
  assert.ok(runAir > 0.1 && runAir < 0.4)
  for (const name of ['idle-walk', 'walk-idle', 'run-idle', 'run-walk']) assert.equal(report.motions.find(motion => motion.name === name).aerialRatio, 0, `${name}: missing support foot`)
})

test('unreachable targets are reported instead of silently shortening or stretching bones', () => {
  const pose = poseAt('idle', 0)
  pose.feet[0].x = -100
  assert.throws(() => jointsFor(pose), /IK_UNREACHABLE/)
})
