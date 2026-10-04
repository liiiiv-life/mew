import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTaskChanges, taskChanges, setTaskDate, taskRange, validTaskTree, type TaskItem } from '../../shared/task-list.ts'
import { tasksOnDate, taskBars, moveTaskRange } from './task-schedule.ts'
import { toDay, fromDay, tickDays } from './task-timeline.ts'

const task: TaskItem = { id: 'a', text: '일정', done: false, startDate: '2026-10-03', date: '2026-10-07' }
test('inclusive periods, legacy single dates, optional endpoints and leap/year boundaries', () => {
  const legacy = { id: 'legacy', text: '기존 일정', done: true, date: '2026-10-04' }
  assert.deepEqual(tasksOnDate([task, legacy], '2026-10-03'), [task])
  assert.deepEqual(tasksOnDate([task, legacy], '2026-10-04'), [task, legacy])
  assert.deepEqual(tasksOnDate([task, legacy], '2026-10-07'), [task])
  assert.deepEqual(tasksOnDate([task, legacy], '2026-10-08'), [])
  assert.deepEqual(taskRange(legacy), { start: legacy.date, end: legacy.date })
  assert.deepEqual(taskRange({ ...task, date: null }), { start: task.startDate, end: task.startDate })
  assert.equal(taskRange({ ...task, startDate: null, date: null }), null)
  assert.equal(validTaskTree([{ ...task, startDate: '2026-02-29' }]), false)
  assert.equal(validTaskTree([{ ...task, startDate: '2026-10-08' }]), false)
  assert.deepEqual(setTaskDate(task, 'startDate', '2026-10-10'), { ...task, startDate: '2026-10-10', date: '2026-10-10' })
  assert.deepEqual(setTaskDate(task, 'date', '2026-09-30'), { ...task, startDate: '2026-09-30', date: '2026-09-30' })
  for (const day of ['0001-01-01', '0099-12-31', '0100-01-01', '2024-02-29', '9999-12-31']) assert.equal(fromDay(toDay(day)), day)
  assert.deepEqual(tickDays(toDay('0099-12-30'), toDay('0100-01-02'), 'day').map(fromDay), ['0099-12-30', '0099-12-31', '0100-01-01', '0100-01-02'])
})

test('start dates participate in atomic field merge, conflicts, deletions and lost-response retries', () => {
  const before = [task], changed = [{ ...task, startDate: '2026-10-04' }]
  assert.equal(taskChanges(before, changed).length, 1)
  assert.deepEqual(applyTaskChanges([{ ...task, text: '別', done: true }], taskChanges(before, changed)), [{ ...changed[0], text: '別', done: true }])
  assert.throws(() => applyTaskChanges([{ ...task, startDate: '2026-10-05' }], taskChanges(before, changed)))
  assert.throws(() => applyTaskChanges(changed, taskChanges(before, [])))
  assert.throws(() => applyTaskChanges(changed, taskChanges([], before)))
  assert.deepEqual(applyTaskChanges(changed, taskChanges([], changed)), changed)
  assert.deepEqual(applyTaskChanges([{ ...task, date: '2026-10-09' }], taskChanges(before, changed)), [{ ...changed[0], date: '2026-10-09' }])
  assert.throws(() => applyTaskChanges([{ ...task, date: '2026-10-04' }], taskChanges(before, [{ ...task, startDate: '2026-10-06' }])), 'independent endpoints cannot merge into an invalid interval')
})

test('Gantt moves retain duration and identity, resizing clamps and nested summaries span descendants', () => {
  assert.deepEqual(moveTaskRange(task, 3, 'move'), { ...task, startDate: '2026-10-06', date: '2026-10-10' })
  assert.deepEqual(moveTaskRange(task, 10, 'start'), { ...task, startDate: '2026-10-07' })
  assert.deepEqual(moveTaskRange(task, -10, 'end'), { ...task, date: '2026-10-03' })
  assert.equal(moveTaskRange({ ...task, startDate: '0001-01-01', date: '0001-01-05' }, -10, 'move').startDate, '0001-01-01')
  assert.equal(moveTaskRange({ ...task, startDate: '9999-12-27', date: '9999-12-31' }, 10, 'move').date, '9999-12-31')
  const parent = { id: 'p', text: '상위', done: false }, child = { ...task, parentId: 'p' }
  const nested = { id: 'n', text: '하위', done: false, parentId: 'p' }, leaf = { ...task, id: 'leaf', parentId: 'n', startDate: '2026-10-05', date: '2026-10-09', done: true }
  const bars = taskBars([parent, child, nested, leaf], '2026-10-10')
  assert.equal(bars.get('p')?.length, 1)
  assert.equal(bars.get('p')?.[0].start, '2026-10-03')
  assert.equal(bars.get('p')?.[0].end, '2026-10-09')
  assert.equal(bars.get('p')?.[0].own, false)
  assert.deepEqual(bars.get('n'), [{ ...bars.get('leaf')![0], own: false, ...{ from: '#fca5a5', to: '#dc2626' } }])
  assert.equal(taskBars([{ ...parent, startDate: '2026-10-01', date: '2026-10-02' }, child], '2026-10-10').get('p')?.[0].own, false)
})
