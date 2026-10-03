import test from 'node:test'
import assert from 'node:assert/strict'
import { DocumentGraphLayout } from './document-graph-layout.ts'

test('force layout converges, separates coincident nodes and respects dragging', () => {
  const engine = new DocumentGraphLayout(4, new Uint32Array([0, 1, 1, 2]))
  engine.positions.fill(0)
  engine.pin(1, [240, 30])
  for (let i = 0; i < 20; i++) engine.step()
  assert.equal(engine.positions[2], 240)
  assert.equal(engine.positions[3], 30)
  assert.ok(Math.hypot(engine.positions[0] - engine.positions[6], engine.positions[1] - engine.positions[7]) > 1)
  engine.pin(1, null)
  let steps = 0
  while (engine.step() && steps++ < 500) {}
  assert.ok(steps < 500, 'simulation sleeps once settled')
  assert.ok([...engine.positions].every(Number.isFinite))
  assert.equal(new DocumentGraphLayout(0, new Uint32Array()).step(), false)
})

test('large graph uses subquadratic repulsion with reproducible positions', t => {
  const count = 3000, edges = new Uint32Array((count - 1) * 2)
  for (let i = 1; i < count; i++) { edges[(i - 1) * 2] = i; edges[(i - 1) * 2 + 1] = Math.floor((i - 1) / 3) }
  const engine = new DocumentGraphLayout(count, edges), start = performance.now()
  for (let i = 0; i < 20; i++) engine.step()
  t.diagnostic(`3000 nodes / 2999 edges: 20 steps ${Math.round(performance.now() - start)}ms; ${engine.visits} cell visits vs ${count * count} pairs`)
  assert.ok(engine.visits < count * count / 8)
  assert.ok([...engine.positions].every(Number.isFinite))
  const a = new DocumentGraphLayout(30, new Uint32Array([0, 1])), b = new DocumentGraphLayout(30, new Uint32Array([0, 1]))
  for (let i = 0; i < 10; i++) { a.step(); b.step() }
  assert.deepEqual(a.positions, b.positions)
})
