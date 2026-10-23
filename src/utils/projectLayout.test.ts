import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ProjectInfo } from '../api/client'
import { applyLayout, bySlot, buildPlacement, reorderedLayout } from './projectLayout.ts'

function p(name: string, slot: number | null): ProjectInfo {
  return { name, icon: null, slot }
}

test('bySlot: 자리 순서대로, 자리가 없는 프로젝트는 뒤에 이름순으로', () => {
  const order = [p('c', 5), p('a', null), p('b', 1), p('z', null)].sort(bySlot).map((x) => x.name)
  assert.deepEqual(order, ['b', 'c', 'a', 'z'])
})

test('buildPlacement: 자리가 겹치거나 없으면 앞쪽 빈 칸부터 채운다', () => {
  const placement = buildPlacement([p('a', 2), p('b', 2), p('c', null)])
  assert.equal(placement.get(2), 'a')
  // b·c는 앞쪽 빈 칸(0, 1)으로 밀려난다 — 서로 덮어쓰지 않는다
  assert.deepEqual([placement.get(0), placement.get(1)], ['b', 'c'])
})

test('reorderedLayout: 쓰이는 칸은 그대로 두고 순서만 바꾼다', () => {
  // 격자에 일부러 비워둔 자리(2, 4)가 있는 배치
  const projects = [p('a', 0), p('b', 1), p('c', 3), p('d', 5)]
  const layout = reorderedLayout(projects, 0, 2)
  // a가 세 번째로 갔다 — 칸 번호 집합은 그대로(0·1·3·5)이고 주인만 바뀐다
  assert.deepEqual(layout, { b: 0, c: 1, a: 3, d: 5 })

  // 새 배치로 다시 정렬하면 탭 줄 순서가 의도대로다
  const reordered = applyLayout(projects, layout ?? {})
    .sort(bySlot)
    .map((x) => x.name)
  assert.deepEqual(reordered, ['b', 'c', 'a', 'd'])
})

test('reorderedLayout: 뒤에서 앞으로 옮기는 것도 같은 규칙', () => {
  const projects = [p('a', 0), p('b', 1), p('c', 2)]
  assert.deepEqual(reorderedLayout(projects, 2, 0), { c: 0, a: 1, b: 2 })
})

test('reorderedLayout: 옮길 것이 없으면 null — 쓸데없는 저장을 부르지 않는다', () => {
  const projects = [p('a', 0), p('b', 1)]
  assert.equal(reorderedLayout(projects, 1, 1), null)
  assert.equal(reorderedLayout(projects, 0, 9), null)
  assert.equal(reorderedLayout(projects, -1, 0), null)
})

test('applyLayout: 배치에 없는 프로젝트는 건드리지 않는다', () => {
  const projects = [p('a', 0), p('hidden', 7)]
  const next = applyLayout(projects, { a: 3 })
  assert.deepEqual(
    next.map((x) => [x.name, x.slot]),
    [
      ['a', 3],
      ['hidden', 7],
    ],
  )
})
