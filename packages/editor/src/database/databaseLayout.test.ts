import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarDates, databaseDateRange, dateKey, groupCalendarRows, groupDatabaseRows, normalizeDatabaseLayout, parseDatabaseLayout, searchDatabaseRows, serializeDatabaseLayout, shiftCalendarMonth } from './databaseLayout.ts'
import { databaseMarkdown } from './databaseMarkdown.ts'
import type { DbRow } from '../types.ts'

const rows: DbRow[] = [
  { id: 'a', pos: 0, cells: { title: '팀 기획', status: '준비', tags: ['리서치', '디자인'] } },
  { id: 'b', pos: 1, cells: { title: '출시 준비', status: '진행', tags: ['개발'] } },
  { id: 'c', pos: 2, cells: { title: '검토', status: null } },
]

test('database layout metadata round-trips safely without changing legacy Markdown', () => {
  const layout = { mode: 'calendar' as const, dateColumn: 'date"<script>', startDateColumn: 'start', visibleFields: ['date', 'status'] }
  assert.deepEqual(parseDatabaseLayout(serializeDatabaseLayout(layout)), layout)
  const source = databaseMarkdown('11111111-1111-4111-8111-111111111111', true, layout)
  assert.ok(!source.includes('<script>'))
  assert.deepEqual(parseDatabaseLayout(/data-mew-db-layout="([^"]+)"/.exec(source)![1]), layout)
  assert.equal(databaseMarkdown('11111111-1111-4111-8111-111111111111', false, { mode: 'table' }), '<div data-mew-db="11111111-1111-4111-8111-111111111111"></div>')
  assert.deepEqual(parseDatabaseLayout('%bad'), { mode: 'table' })
  assert.deepEqual(normalizeDatabaseLayout({ mode: 'unknown', groupColumn: 12, visibleFields: ['a', 'a', null] }), { mode: 'table', visibleFields: ['a'] })
  assert.deepEqual(normalizeDatabaseLayout({ mode: 'calendar', startDateColumn: 12 }), { mode: 'calendar' })
  const tableWithDates = { mode: 'table' as const, startDateColumn: 'start' }
  assert.match(databaseMarkdown('11111111-1111-4111-8111-111111111111', false, tableWithDates), /data-mew-db-layout=/)
})

test('board groups include empty configured lanes and retain every row exactly once', () => {
  const groups = groupDatabaseRows(rows, { id: 'status', name: '상태', type: 'select', options: ['준비', '진행', '완료'] })
  assert.deepEqual(groups.map(group => [group.value, group.rows.length]), [['준비', 1], ['진행', 1], ['완료', 0], [null, 1]])
  assert.deepEqual(groups.flatMap(group => group.rows).map(row => row.id).sort(), ['a', 'b', 'c'])
  const checks = groupDatabaseRows([{ id: 'a', pos: 0, cells: { done: false } }, { id: 'b', pos: 1, cells: { done: true } }, { id: 'c', pos: 2, cells: {} }], { id: 'done', name: '완료', type: 'checkbox' })
  assert.deepEqual(checks.map(group => group.rows.map(row => row.id)), [['a'], ['b'], ['c']])
})

test('calendar cells cover leap days and year boundaries without timezone shifts', () => {
  const dates = calendarDates('2024-02')
  assert.equal(dates.length, 42)
  assert.equal(dates[0], '2024-01-28')
  assert.ok(dates.includes('2024-02-29'))
  assert.equal(shiftCalendarMonth('2026-12', 1), '2027-01')
  assert.equal(shiftCalendarMonth('2026-01', -1), '2025-12')
  assert.equal(dateKey('2026-10-20T23:00:00-12:00'), '2026-10-20')
  assert.equal(dateKey('2026-02-29'), null)
  assert.equal(dateKey('not a date'), null)
  assert.equal(dateKey(null), null)
})

test('search matches every term across properties and never mutates the data', () => {
  assert.deepEqual(searchDatabaseRows(rows, '팀 디자인', 'ko').map(row => row.id), ['a'])
  assert.deepEqual(searchDatabaseRows(rows, '준비').map(row => row.id), ['a', 'b'])
  assert.equal(searchDatabaseRows(rows, '  '), rows)
  assert.equal(searchDatabaseRows(rows, 'missing').length, 0)
})

test('calendar periods include both endpoints, clip to visible days and retain incomplete dates', () => {
  const period: DbRow = { id: 'period', pos: 0, cells: { start: '2024-02-28T23:00:00-12:00', date: '2024-03-02' } }
  const startOnly: DbRow = { id: 'start', pos: 1, cells: { start: '2024-02-29' } }
  const endOnly: DbRow = { id: 'end', pos: 2, cells: { start: 'invalid', date: '2024-03-01' } }
  const missing: DbRow = { id: 'none', pos: 3, cells: { start: '2024-02-30', date: null } }
  const reversed: DbRow = { id: 'reversed', pos: 4, cells: { start: '2024-03-02', date: '2024-02-29' } }
  const long: DbRow = { id: 'long', pos: 5, cells: { start: '1900-01-01', date: '9999-12-31' } }
  const groups = groupCalendarRows([period, startOnly, endOnly, missing, reversed, long], ['2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03'], 'date', 'start')
  assert.deepEqual(groups.get('2024-02-29')!.map(row => row.id), ['period', 'start', 'reversed', 'long'])
  assert.deepEqual(groups.get('2024-03-01')!.map(row => row.id), ['period', 'end', 'reversed', 'long'])
  assert.deepEqual(groups.get('2024-03-02')!.map(row => row.id), ['period', 'reversed', 'long'])
  assert.deepEqual(groups.get('2024-03-03')!.map(row => row.id), ['long'])
  assert.deepEqual(groups.get('')!.map(row => row.id), ['none'])
  assert.equal(groups.size, 5, 'long periods never allocate dates outside the visible grid')
  assert.deepEqual(databaseDateRange(period, 'date'), { start: '2024-03-02', end: '2024-03-02' }, 'legacy calendars still use one date')
  assert.deepEqual(databaseDateRange(startOnly, 'date', 'start'), { start: '2024-02-29', end: '2024-02-29' })
  assert.deepEqual(databaseDateRange(reversed, 'date', 'start'), { start: '2024-02-29', end: '2024-03-02' })
  assert.equal(databaseDateRange(missing, 'date', 'start'), null)
})
