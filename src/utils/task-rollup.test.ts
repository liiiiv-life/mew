import test from 'node:test'
import assert from 'node:assert/strict'
import { taskRollups, taskWithRollup } from '../../shared/task-rollup.ts'
import { removeTask, type TaskItem } from '../../shared/task-list.ts'
import { taskBars, tasksOnDate } from './task-schedule.ts'
import { taskDateLabel, sortTasksByDateStatus } from './task-date-label.ts'

const parent: TaskItem = { id: 'parent', text: '상위', done: false, startDate: '2026-01-01', date: '2026-12-31' }
const child = (id: string, startDate?: string, date?: string, parentId = 'parent'): TaskItem => ({ id, text: id, done: false, parentId, startDate, date })

test('parent schedules span overlapping or disjoint children and ignore old explicit parent dates', () => {
  for (const [children, expected] of [
    [[child('a', '2026-09-13', '2026-09-17'), child('b', '2026-09-14', '2026-09-19')], { start: '2026-09-13', end: '2026-09-19' }],
    [[child('a', '2026-09-01', '2026-09-03'), child('b', '2026-09-06', '2026-09-08')], { start: '2026-09-01', end: '2026-09-08' }],
  ] as const) {
    const tasks = [parent, ...children], original = structuredClone(tasks), rollups = taskRollups(tasks)
    assert.deepEqual(rollups.ranges.get(parent.id), expected)
    assert.equal(rollups.parents.has(parent.id), true)
    assert.deepEqual(taskWithRollup(parent, rollups), { ...parent, startDate: expected.start, date: expected.end })
    assert.deepEqual(tasks, original, 'computed parent dates never become independent persisted changes')
    assert.deepEqual(taskBars(tasks, '2026-09-04').get(parent.id)?.map(({ start, end, own }) => ({ start, end, own })), [{ ...expected, own: false }])
  }
  const separated = [parent, child('a', '2026-09-01', '2026-09-03'), child('b', '2026-09-06', '2026-09-08')]
  assert.deepEqual(tasksOnDate(separated, '2026-09-04').map(task => task.id), ['parent'], 'calendar includes the parent across the gap')
  assert.equal(taskDateLabel(taskWithRollup(parent, taskRollups(separated)), '2026-09-04').label, 'D-4')
  assert.deepEqual(sortTasksByDateStatus([parent, ...separated.slice(1), { id: 'empty', text: '', done: false }], '2026-09-04').map(task => task.id), ['parent', 'a', 'b', 'empty'])
})

test('nested rollups use leaf dates, ignore undated descendants and react to edits/deletion/reparenting', () => {
  const tasks = [parent, { ...child('nested'), startDate: '2025-01-01', date: '2027-01-01' }, child('leaf', undefined, '2026-09-19', 'nested'), child('undated'), child('a', '2026-09-13')]
  let rollups = taskRollups(tasks)
  assert.deepEqual(rollups.ranges.get('nested'), { start: '2026-09-19', end: '2026-09-19' })
  assert.deepEqual(rollups.ranges.get('parent'), { start: '2026-09-13', end: '2026-09-19' })
  assert.deepEqual(taskRollups(tasks.map(task => task.id === 'leaf' ? { ...task, date: '2026-09-23' } : task)).ranges.get('parent'), { start: '2026-09-13', end: '2026-09-23' })
  rollups = taskRollups(removeTask(tasks, 1))
  assert.deepEqual(rollups.ranges.get('parent'), { start: '2026-09-13', end: '2026-09-19' }, 'promoted children retain the outer range')
  const undated = [parent, child('empty')]
  assert.equal(taskRollups(undated).ranges.get('parent'), null)
  assert.deepEqual(taskWithRollup(parent, taskRollups(undated)), { ...parent, startDate: null, date: null })
  assert.equal(taskRollups([parent]).parents.has('parent'), false, 'removing the last child makes dates editable again')
  assert.equal(taskWithRollup(parent, taskRollups([parent])), parent)
  const boundary = [parent, child('first', '0001-01-01'), child('last', undefined, '9999-12-31')]
  assert.deepEqual(taskRollups(boundary).ranges.get('parent'), { start: '0001-01-01', end: '9999-12-31' })
})
