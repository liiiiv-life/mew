import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropZoneAt, leaf, normalizeLayout, paneIds, removeLeaf, splitLeaf, type PaneNode } from './paneTree.ts'

const rect = { left: 0, top: 0, width: 100, height: 100 }

test('dropZoneAt: 가운데는 center, 가장자리 30%는 그 방향', () => {
  assert.equal(dropZoneAt(rect, 50, 50), 'center')
  assert.equal(dropZoneAt(rect, 90, 50), 'right')
  assert.equal(dropZoneAt(rect, 10, 50), 'left')
  assert.equal(dropZoneAt(rect, 50, 95), 'bottom')
  assert.equal(dropZoneAt(rect, 50, 5), 'top')
  // 모서리는 더 가까운 쪽이 이긴다
  assert.equal(dropZoneAt(rect, 5, 20), 'left')
  assert.equal(dropZoneAt(rect, 20, 5), 'top')
})

test('splitLeaf: 잎을 방향대로 가른다', () => {
  const right = splitLeaf(leaf('a'), 'a', 'b', 'right')
  assert.deepEqual(right, { kind: 'split', dir: 'row', kids: [leaf('a'), leaf('b')] })
  const top = splitLeaf(leaf('a'), 'a', 'b', 'top')
  assert.deepEqual(top, { kind: 'split', dir: 'col', kids: [leaf('b'), leaf('a')] })
})

test('splitLeaf: 같은 방향이면 중첩하지 않고 형제로 끼운다', () => {
  const two = splitLeaf(leaf('a'), 'a', 'b', 'right')
  const three = splitLeaf(two, 'b', 'c', 'right')
  assert.deepEqual(three, { kind: 'split', dir: 'row', kids: [leaf('a'), leaf('b'), leaf('c')] })
  assert.deepEqual(paneIds(three), ['a', 'b', 'c'])
})

test('splitLeaf: 다른 방향이면 그 잎 자리에 중첩된다', () => {
  const row = splitLeaf(leaf('a'), 'a', 'b', 'right')
  const mixed = splitLeaf(row, 'b', 'c', 'bottom') as Extract<PaneNode, { kind: 'split' }>
  assert.equal(mixed.dir, 'row')
  assert.deepEqual(mixed.kids[1], { kind: 'split', dir: 'col', kids: [leaf('b'), leaf('c')] })
})

test('removeLeaf: 홀로 남은 분할은 접힌다', () => {
  const row = splitLeaf(leaf('a'), 'a', 'b', 'right')
  assert.deepEqual(removeLeaf(row, 'b'), leaf('a'))
  assert.equal(removeLeaf(leaf('a'), 'a'), null)
})

test('normalizeLayout: 칸 목록과 어긋나면 한 줄 배치로 되돌린다', () => {
  const row = splitLeaf(leaf('a'), 'a', 'b', 'right')
  assert.deepEqual(normalizeLayout(row, ['a', 'b']), row)
  assert.deepEqual(normalizeLayout(row, ['a']), leaf('a'))
  assert.deepEqual(normalizeLayout(null, ['a', 'b']), { kind: 'split', dir: 'row', kids: [leaf('a'), leaf('b')] })
})
