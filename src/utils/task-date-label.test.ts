import test from 'node:test'
import assert from 'node:assert/strict'
import { taskDateLabel } from './task-date-label.ts'

const task = { id: 'task', text: '일정', done: false }
test('task countdown prioritizes future start and compares calendar days at date boundaries', () => {
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-05', date: '2026-10-08' }, '2026-10-04'), { label: '시작 전', tone: 'muted' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-04', date: '2026-10-08' }, '2026-10-04'), { label: 'D-4', tone: 'normal' })
  assert.deepEqual(taskDateLabel({ ...task, date: '2026-10-04' }, '2026-10-04'), { label: 'D-Day', tone: 'normal' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-01', date: '2026-10-02' }, '2026-10-04'), { label: 'D+2', tone: 'danger' })
  assert.deepEqual(taskDateLabel({ ...task, date: '2024-03-01' }, '2024-02-28'), { label: 'D-2', tone: 'normal' })
  assert.deepEqual(taskDateLabel({ ...task, date: '2027-01-01' }, '2026-12-31'), { label: 'D-1', tone: 'normal' })
  assert.deepEqual(taskDateLabel(task, '2026-10-04'), { label: '일정 없음', tone: 'muted' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-05' }, '2026-10-04'), { label: '시작 전', tone: 'muted' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-03' }, '2026-10-04'), { label: '일정 없음', tone: 'muted' })
  assert.equal(taskDateLabel({ ...task, done: true, date: '2026-10-02' }, '2026-10-04').label, 'D+2')
})
