import assert from 'node:assert/strict'
import test from 'node:test'
import { MEWCAT_CYCLE_MS, MEWCAT_SPRITE_ACTIONS, MEWCAT_TRANSITION_ACTIONS, roamActivity, spriteAction, spriteFrameAt, transitionAction, validSpriteDimensions } from './mewcat-sprites.ts'

test('variable frame counts play every frame once in the same fixed cycle', () => {
  for (const action of MEWCAT_SPRITE_ACTIONS) for (const count of [1, 5, 8, 10, 256]) {
    const duration = MEWCAT_CYCLE_MS[action]
    const seen = Array.from({ length: count }, (_, frame) => spriteFrameAt(action, (frame + 0.5) * duration / count, count))
    assert.deepEqual(seen, Array.from({ length: count }, (_, frame) => frame))
    assert.equal(spriteFrameAt(action, duration - 0.001, count), count - 1)
    assert.equal(spriteFrameAt(action, duration, count), 0)
  }
})

test('ascent and descent have separate strips; landing uses the descent ending', () => {
  assert.equal(spriteAction('jump'), 'jump')
  assert.equal(spriteAction('fall'), 'fall')
  assert.equal(spriteAction('land'), 'fall')
  assert.deepEqual([0, 280].map(time => spriteFrameAt('fall', time, 4)), [0, 2])
  assert.deepEqual([0, 120].map(time => spriteFrameAt('land', time, 4)), [2, 3])
  for (const action of ['fall', 'land'] as const) for (const frames of [1, 3, 10]) {
    assert.ok(spriteFrameAt(action, 50, frames) < frames)
  }
})

test('sprite strips require equal-sized frames and reject invalid frame counts and dimensions', () => {
  assert.equal(validSpriteDimensions(1000, 100, 10), true)
  assert.equal(validSpriteDimensions(1000, 100, 11), false)
  for (const count of [0, -1, 2.5, 257, NaN, Infinity]) assert.equal(validSpriteDimensions(1000, 100, count), false)
  assert.equal(validSpriteDimensions(10, 10, 20), false)
  assert.equal(validSpriteDimensions(32768, 4096, 256), false)
})

test('nine optional transitions play once, retaining their last frame after completion', () => {
  assert.equal(MEWCAT_SPRITE_ACTIONS.length, 7)
  assert.equal(MEWCAT_TRANSITION_ACTIONS.length, 9)
  for (const action of MEWCAT_TRANSITION_ACTIONS) for (const frames of [1, 5, 8, 256]) {
    const duration = MEWCAT_CYCLE_MS[action]
    assert.deepEqual(Array.from({ length: frames }, (_, index) => spriteFrameAt(action, (index + 0.5) * duration / frames, frames)), Array.from({ length: frames }, (_, index) => index))
    assert.equal(spriteFrameAt(action, duration, frames), frames - 1)
    assert.equal(spriteFrameAt(action, duration * 2, frames), frames - 1)
  }
})

test('ground transitions are directional; takeoff, apex and landing follow physical state', () => {
  for (const from of ['idle', 'walk', 'run'] as const) for (const to of ['idle', 'walk', 'run'] as const) {
    assert.equal(transitionAction(from, to), from === to ? undefined : `${from}-${to}`)
  }
  assert.equal(transitionAction('idle', 'takeoff'), 'takeoff')
  assert.equal(transitionAction('takeoff', 'jump'), undefined)
  assert.equal(transitionAction('struggle', 'jump'), undefined, 'throwing does not play a grounded takeoff')
  assert.equal(transitionAction('jump', 'fall'), 'apex')
  assert.equal(transitionAction('fall', 'land'), 'landing')
  assert.equal(transitionAction('fall', 'struggle'), undefined, 'catching interrupts flight immediately')
})

test('roaming occasionally jumps, while reduced motion keeps autonomous activity on the floor', () => {
  assert.deepEqual([0, 0.4, 0.7, 0.89, 0.9, 0.99].map(value => roamActivity(value)), ['idle', 'walk', 'run', 'run', 'jump', 'jump'])
  assert.equal(roamActivity(0.99, true), 'run')
})
