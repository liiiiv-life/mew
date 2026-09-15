import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasScale, pageAt, pageLayout, simplifyInk, distanceToSegment } from './pdf-geometry.ts'

test('PDF layout supports large, mixed-size documents and clamps binary lookup', () => {
  const offsets = pageLayout(10_000, new Map([[2, { width: 800, height: 400 }]]), { width: 600, height: 800 }, 1.5)
  assert.equal(offsets[1], 1218)
  assert.equal(offsets[2], 1836)
  assert.equal(pageAt(offsets, -20), 0)
  assert.equal(pageAt(offsets, 1218), 1)
  assert.equal(pageAt(offsets, 1836), 2)
  assert.equal(pageAt(offsets, Infinity), 9999)
})

test('PDF canvases stay within pixel and maximum-dimension budgets', () => {
  for (const [width, height, dpr, budget] of [[2400, 3400, 3, 4e6], [100_000, 200, 2, 1e6], [500, 700, 1, 4e6]]) {
    const ratio = canvasScale(width, height, dpr, budget)
    assert.ok(width * height * ratio * ratio <= budget + 1)
    assert.ok(Math.max(width, height) * ratio <= 8192)
    assert.ok(ratio <= dpr)
  }
})

test('ink simplification retains corners and endpoints, including taps', () => {
  assert.deepEqual(simplifyInk([[1, 2]], .2), [[1, 2]])
  assert.deepEqual(simplifyInk([[0, 0], [1, .01], [2, 0], [2, 2]], .1), [[0, 0], [2, 0], [2, 2]])
  assert.equal(distanceToSegment([1, 2], [0, 0], [2, 0]), 2)
  assert.equal(distanceToSegment([3, 0], [0, 0], [2, 0]), 1)
})
