import test from 'node:test'
import assert from 'node:assert/strict'
import { sortDatabaseRows } from './databaseSort.ts'
import type { DbColumnType } from '../types.ts'

const sort = { columnId: 'value', direction: 'ascending' as const }
function sorted(values: unknown[], type: DbColumnType, direction: 'ascending' | 'descending' = 'ascending') {
  const rows = values.map((value, index) => ({ id: String(index), pos: index, cells: { value } }))
  const result = sortDatabaseRows(rows, { id: 'value', name: '값', type }, { ...sort, direction }, 'ko')
  assert.deepEqual(rows.map(row => row.cells.value), values, 'display sorting never mutates stored row order')
  return result.map(row => row.cells.value)
}

test('database sorting compares native numbers, chronological dates and checkbox values', () => {
  assert.deepEqual(sorted([10, 2, -1, '3'], 'number'), [-1, 2, '3', 10])
  assert.deepEqual(sorted([10, 2, -1], 'number', 'descending'), [10, 2, -1])
  assert.deepEqual(sorted(['2026-10-20', '2025-12-31', '2026-02-01'], 'date'), ['2025-12-31', '2026-02-01', '2026-10-20'])
  assert.deepEqual(sorted([true, false, 'true', 'false'], 'checkbox'), [false, 'false', true, 'true'])
})

test('text, pages and choices use natural order and place missing values last in both directions', () => {
  for (const type of ['text', 'page', 'select'] as const) {
    assert.deepEqual(sorted(['항목 10', null, '항목 2', '', undefined], type), ['항목 2', '항목 10', null, '', undefined])
    assert.deepEqual(sorted(['항목 2', null, '항목 10'], type, 'descending'), ['항목 10', '항목 2', null])
  }
  assert.deepEqual(sorted([['나'], [], ['가', '다']], 'multi_select'), [['가', '다'], ['나'], []])
  assert.deepEqual(sorted([2, null, 2, undefined], 'number'), [2, 2, null, undefined])
})

test('equal values retain original order and deleted columns or cleared sorting retain the source order', () => {
  const rows = [{ id: 'b', pos: 1, cells: { value: 'same' } }, { id: 'a', pos: 0, cells: { value: 'SAME' } }]
  const column = { id: 'value', name: '값', type: 'text' as const }
  assert.deepEqual(sortDatabaseRows(rows, column, sort).map(row => row.id), ['b', 'a'])
  assert.equal(sortDatabaseRows(rows, undefined, sort), rows)
  assert.equal(sortDatabaseRows(rows, column, null), rows)
})
