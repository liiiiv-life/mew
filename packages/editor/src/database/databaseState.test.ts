import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDbEvent, setCell } from './databaseState.ts'
import type { DbView } from '../types.ts'

function baseView(): DbView {
  return {
    id: 'db1',
    title: 'T',
    kind: 'managed',
    editable: true,
    columns: [{ id: 'c1', name: '이름', type: 'text' }],
    rows: [{ id: 'r1', pos: 0, cells: { c1: '가' } }],
  }
}

test('setCell은 불변으로 값을 바꾸고, 없는 행이면 원본을 돌려준다', () => {
  const v = baseView()
  const next = setCell(v, 'r1', 'c1', '나')
  assert.equal(next.rows[0].cells.c1, '나')
  assert.equal(v.rows[0].cells.c1, '가') // 원본 불변
  assert.notEqual(next, v)
  assert.equal(setCell(v, 'nope', 'c1', 'x'), v) // 변화 없으면 동일 참조
})

test('row.insert는 pos 순으로 정렬해 추가하고 중복은 무시한다', () => {
  const v = baseView()
  const withNew = applyDbEvent(v, { type: 'row.insert', row: { id: 'r2', pos: 1, cells: { c1: null } } })
  assert.deepEqual(withNew.rows.map((r) => r.id), ['r1', 'r2'])
  const before = applyDbEvent(withNew, { type: 'row.insert', row: { id: 'r0', pos: -1, cells: { c1: null } } })
  assert.deepEqual(before.rows.map((r) => r.id), ['r0', 'r1', 'r2'])
  const dup = applyDbEvent(withNew, { type: 'row.insert', row: { id: 'r2', pos: 5, cells: { c1: 'x' } } })
  assert.equal(dup.rows.length, 2) // 이미 있으니 무시
})

test('row.update / row.delete / schema', () => {
  const v = baseView()
  assert.equal(applyDbEvent(v, { type: 'row.update', rowId: 'r1', columnId: 'c1', value: '변경' }).rows[0].cells.c1, '변경')
  assert.equal(applyDbEvent(v, { type: 'row.delete', rowId: 'r1' }).rows.length, 0)
  const schema = applyDbEvent(v, { type: 'schema', columns: [{ id: 'c1', name: '이름', type: 'text' }, { id: 'c2', name: '점수', type: 'number' }] })
  assert.equal(schema.columns.length, 2)
  assert.equal(applyDbEvent(v, { type: 'title', title: '새 제목' }).title, '새 제목')
})
