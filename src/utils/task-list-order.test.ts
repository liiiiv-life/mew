import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTaskChanges, taskChanges, moveTaskSubtree, removeTask, validTaskTree } from '../../shared/task-list.ts'

const a = { id: 'a', text: 'A', done: false }, b = { id: 'b', text: 'B', done: true }, c = { id: 'c', text: 'C', done: false }
test('reordering round-trips both directions and preserves independently edited fields', () => {
  for (const desired of [[c, a, b], [b, c, a], [a, c, b], [c, b, a]]) {
    const changes = taskChanges([a, b, c], desired)
    assert.deepEqual(applyTaskChanges([a, b, c], changes), desired)
    assert.deepEqual(applyTaskChanges(desired, changes), desired, 'retrying a lost response preserves order')
    const remote = [{ ...a, text: 'remote', done: true }, b, c]
    const merged = applyTaskChanges(remote, changes)
    assert.deepEqual(merged.map(item => item.id), desired.map(item => item.id))
    assert.deepEqual(merged.find(item => item.id === 'a'), remote[0])
  }
})
test('reorder combined with insertions and deletion preserves every surviving object', () => {
  const d = { id: 'd', text: 'D', done: false }
  const desired = [c, d, { ...a, text: 'edited' }]
  assert.deepEqual(applyTaskChanges([a, b, c], taskChanges([a, b, c], desired)), desired)
})

test('nested objects retain hierarchy through subtree moves, promotion and retries', () => {
  const child = { id: 'child', text: 'child', done: false, parentId: 'a' }
  const grandchild = { id: 'grandchild', text: '', done: true, parentId: 'child' }
  const tree = [a, child, grandchild, b, c]
  assert.equal(validTaskTree(tree), true)
  const moved = moveTaskSubtree(tree, 'a', null)
  assert.deepEqual(moved.map(item => item.id), ['b', 'c', 'a', 'child', 'grandchild'])
  const changes = taskChanges(tree, moved)
  assert.deepEqual(applyTaskChanges(tree, changes), moved)
  assert.deepEqual(applyTaskChanges(moved, changes), moved)
  assert.deepEqual(moveTaskSubtree(tree, 'a', 'grandchild'), tree)
  const promoted = removeTask(tree, 0)
  assert.equal(promoted[0].parentId, null)
  assert.equal(promoted[1].parentId, 'child')
  assert.deepEqual(applyTaskChanges(tree, taskChanges(tree, promoted)), promoted)
  assert.equal(validTaskTree([child, a]), false)
  assert.equal(validTaskTree([a, b, child]), false)
  assert.throws(() => applyTaskChanges([a, b], taskChanges([a, b], [a, { ...b, parentId: 'missing' }])), /다른 창/)
})

test('dates merge independently, survive reorders, conflict atomically and clear idempotently', () => {
  const dated = { ...a, date: '2026-10-15' }
  const changes = taskChanges([a, b], [dated, b])
  assert.deepEqual(applyTaskChanges([{ ...a, text: 'remote', done: true }, b], changes)[0], { ...dated, text: 'remote', done: true })
  assert.deepEqual(applyTaskChanges([a, b], changes), [dated, b])
  assert.deepEqual(applyTaskChanges([dated, b], changes), [dated, b])
  assert.throws(() => applyTaskChanges([{ ...a, date: '2026-10-16' }, b], changes), /다른 창/)
  assert.throws(() => applyTaskChanges([{ ...a, date: '2026-10-16' }, b], taskChanges([dated, b], [b])), /다른 창/)
  const reordered = applyTaskChanges([dated, b], taskChanges([a, b], [b, a]))
  assert.equal(reordered[1].date, '2026-10-15')
  const child = { ...c, parentId: 'a' }
  const promoted = applyTaskChanges([a, { ...child, date: '2026-10-18' }], taskChanges([a, child], [{ ...child, parentId: null }]))
  assert.equal(promoted[0].date, '2026-10-18', 'parent changes retain independently changed dates')
  const clear = taskChanges([dated, b], [{ ...dated, date: null }, b])
  assert.equal(applyTaskChanges([dated, b], clear)[0].date, null)
  assert.deepEqual(applyTaskChanges([a, b], clear), [{ ...a, date: null }, b])
})
