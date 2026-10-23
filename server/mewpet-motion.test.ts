import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMewpetMotion } from '../shared/mewpet-motion.ts'

test('stride metadata is optional and preserves both source-frame cycle distances', () => {
  assert.equal(Object.hasOwn(parseMewpetMotion(), 'stride'), false)
  assert.equal(Object.hasOwn(parseMewpetMotion({ movementSpeed: 2 }), 'stride'), false)
  const source = { walk: 64.5, run: 128 }
  const motion = parseMewpetMotion({ stride: source })
  assert.deepEqual(motion.stride, source)
  assert.notEqual(motion.stride, source)
  assert.deepEqual(parseMewpetMotion(JSON.parse(JSON.stringify(motion))).stride, source)
  assert.deepEqual(parseMewpetMotion({ stride: { walk: 0.25, run: 4096 } }).stride, { walk: 0.25, run: 4096 })
})

test('stride metadata rejects malformed, partial or unreasonable cycle distances', () => {
  for (const stride of [null, [], '64', true, {}, { walk: 64 }, { run: 128 }, { walk: '64', run: 128 }]) {
    assert.throws(() => parseMewpetMotion({ stride }), /SKIN_MOTION_INVALID/)
  }
  for (const length of [0, -1, NaN, Infinity, -Infinity, 4096.01]) {
    for (const action of ['walk', 'run']) {
      assert.throws(() => parseMewpetMotion({ stride: { walk: 64, run: 128, [action]: length } }), /SKIN_MOTION_INVALID/)
    }
  }
})
