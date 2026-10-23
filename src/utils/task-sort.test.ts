import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultTaskSortRules, sortTasks, type TaskSortRule } from './task-sort.ts'
import type { TaskItem } from '../../shared/task-list.ts'

const task = (id: string, text: string, rest: Partial<TaskItem> = {}): TaskItem => ({ id, text, done: false, ...rest })
const ids = (tasks: TaskItem[], rules: TaskSortRule[]) => sortTasks(tasks, rules, 'ko', '2026-10-07').map(task => task.id)

test('earlier rules win and tied fields defer to later rules in either direction', () => {
  const tasks = [task('a', '가', { tags: ['b'], date: '2026-10-02' }), task('b', '나', { tags: ['a'], date: '2026-10-03' }), task('c', '가', { tags: ['a'], date: '2026-10-01' }), task('d', '가', { tags: ['a'], date: '2026-10-02' })]
  assert.deepEqual(ids(tasks, [{ field: 'tags', direction: 'asc' }, { field: 'title', direction: 'desc' }, { field: 'dueDate', direction: 'desc' }]), ['b', 'd', 'c', 'a'])
  assert.deepEqual(ids(tasks, [{ field: 'title', direction: 'asc' }, { field: 'tags', direction: 'desc' }]), ['a', 'c', 'd', 'b'])
  assert.deepEqual(ids(tasks, [{ field: 'dueDate', direction: 'asc' }]), ['c', 'a', 'd', 'b'])
})

test('tag comparison ignores assignment order, compares the whole tag list and leaves unset tags last', () => {
  const tasks = [task('a', '1', { tags: ['b', 'a'] }), task('b', '2', { tags: ['a', 'b'] }), task('c', '3', { tags: ['a'] }), task('d', '4'), task('e', '5', { tags: ['a', 'c'] })]
  assert.deepEqual(ids(tasks, [{ field: 'tags', direction: 'asc' }]), ['c', 'a', 'b', 'e', 'd'])
  assert.deepEqual(ids(tasks, [{ field: 'tags', direction: 'desc' }]), ['e', 'a', 'b', 'c', 'd'])
  assert.deepEqual(tasks[0].tags, ['b', 'a'])
})

test('start and due dates are independent, keep missing values last and preserve stored order', () => {
  const tasks = [task('a', '작업', { startDate: '2026-10-02', date: '2026-10-20' }), task('b', '작업', { date: '2026-10-01' }), task('c', '작업', { startDate: '2026-10-02' }), task('d', '작업'), task('e', '작업')]
  const original = structuredClone(tasks)
  assert.deepEqual(ids(tasks, [{ field: 'startDate', direction: 'asc' }]), ['a', 'c', 'b', 'd', 'e'])
  assert.deepEqual(ids(tasks, [{ field: 'startDate', direction: 'desc' }]), ['a', 'c', 'b', 'd', 'e'])
  assert.deepEqual(ids(tasks, [{ field: 'dueDate', direction: 'asc' }]), ['b', 'a', 'c', 'd', 'e'])
  assert.deepEqual(ids(tasks, [{ field: 'dueDate', direction: 'desc' }]), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(ids(tasks, []), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(tasks, original, 'display sorting never mutates tasks or stored order')
})

test('title sorting uses natural numbers and does not group completed tasks', () => {
  const tasks = [task('a', '작업 10'), task('b', '작업 2', { done: true }), task('c', '작업 1')]
  assert.deepEqual(ids(tasks, [{ field: 'title', direction: 'asc' }]), ['c', 'b', 'a'])
  assert.deepEqual(ids(tasks, [{ field: 'title', direction: 'desc' }]), ['a', 'b', 'c'])
})

const scheduleTasks = () => [
  task('unset', '미정'), task('start-only', '시작일만', { startDate: '2026-10-01' }),
  task('future-far', '시작 전', { startDate: '2026-10-20', date: '2026-10-22' }),
  task('future-near', '시작 전', { startDate: '2026-10-08' }),
  task('overdue-far', '지난 마감', { date: '2026-01-01' }),
  task('overdue-near', '지난 마감', { date: '2026-10-06' }),
  task('due-far', '진행 중', { date: '2026-10-10' }),
  task('due-near', '진행 중', { startDate: '2026-10-07', date: '2026-10-08' }),
  task('due-today', '오늘 마감', { date: '2026-10-07', done: true }),
]

test('schedule priority preserves status groups and compares deadline/start proximity within them', () => {
  const tasks = scheduleTasks()
  assert.deepEqual(ids(tasks, [{ field: 'schedule', direction: 'asc' }]), ['due-today', 'due-near', 'due-far', 'overdue-near', 'overdue-far', 'future-near', 'future-far', 'unset', 'start-only'])
  assert.deepEqual(ids(tasks, [{ field: 'schedule', direction: 'desc' }]), ['future-far', 'future-near', 'overdue-far', 'overdue-near', 'due-far', 'due-near', 'due-today', 'unset', 'start-only'])
  assert.deepEqual(sortTasks(tasks, [{ field: 'schedule', direction: 'asc' }], 'ko', '2026-10-08').slice(0, 2).map(task => task.id), ['due-near', 'due-far'], 'local date changes move future starts and deadlines to the appropriate group')
})

test('start status and deadline rules allow overdue-first ordering while future starts and unscheduled tasks remain below', () => {
  const tasks = scheduleTasks()
  assert.deepEqual(ids(tasks, [{ field: 'startStatus', direction: 'asc' }, { field: 'dueDate', direction: 'asc' }]), ['overdue-far', 'overdue-near', 'due-today', 'due-near', 'due-far', 'start-only', 'future-far', 'future-near', 'unset'])
  assert.deepEqual(ids(tasks, [{ field: 'startStatus', direction: 'desc' }, { field: 'startDate', direction: 'asc' }]).slice(0, 2), ['future-near', 'future-far'])
})

test('default rules apply tags before schedule priority, retain ties and return independent rule arrays', () => {
  const tasks = [task('b-today', 'B', { tags: ['b'], date: '2026-10-07' }), task('a-future', 'A', { tags: ['a'], startDate: '2026-10-10' }), task('no-tag-today', '미분류', { date: '2026-10-07' }), task('a-near', 'A', { tags: ['a'], date: '2026-10-08' }), task('a-tie', 'A', { tags: ['a'], date: '2026-10-08' })]
  assert.deepEqual(ids(tasks, defaultTaskSortRules()), ['a-near', 'a-tie', 'a-future', 'b-today', 'no-tag-today'])
  const changed = defaultTaskSortRules()
  changed[0].direction = 'desc'
  assert.equal(defaultTaskSortRules()[0].direction, 'asc')
})
