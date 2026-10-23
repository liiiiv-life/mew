import test from 'node:test'
import assert from 'node:assert/strict'
import { taskDateLabel, sortTasksByDateStatus } from './task-date-label.ts'
import { addDays } from './task-timeline.ts'
import { getUiLocale, setUiLocale } from '@mew/ui/i18n-core'

const task = { id: 'task', text: '일정', done: false }
test('task countdown prioritizes future start and compares calendar days at date boundaries', () => {
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-05', date: '2026-10-08' }, '2026-10-04'), { label: '1일 후 시작', tone: 'muted' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-04', date: '2026-10-08' }, '2026-10-04'), { label: 'D-4', tone: 'normal' })
  assert.deepEqual(taskDateLabel({ ...task, date: '2026-10-04' }, '2026-10-04'), { label: 'D-Day', tone: 'normal' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-01', date: '2026-10-02' }, '2026-10-04'), { label: 'D+2', tone: 'danger' })
  assert.deepEqual(taskDateLabel({ ...task, date: '2024-03-01' }, '2024-02-28'), { label: 'D-2', tone: 'normal' })
  assert.deepEqual(taskDateLabel({ ...task, date: '2027-01-01' }, '2026-12-31'), { label: 'D-1', tone: 'normal' })
  assert.deepEqual(taskDateLabel(task, '2026-10-04'), { label: '날짜 설정', tone: 'muted' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-05' }, '2026-10-04'), { label: '1일 후 시작', tone: 'muted' })
  assert.deepEqual(taskDateLabel({ ...task, startDate: '2026-10-03' }, '2026-10-04'), { label: '날짜 설정', tone: 'muted' })
  assert.equal(taskDateLabel({ ...task, done: true, date: '2026-10-02' }, '2026-10-04').label, 'D+2')
})

test('future starts use whole days, weeks and 30-day months at unit boundaries', () => {
  for (const [days, label] of [[1, '1일 후 시작'], [6, '6일 후 시작'], [7, '1주 후 시작'], [13, '1주 후 시작'], [14, '2주 후 시작'], [29, '4주 후 시작'], [30, '1달 후 시작'], [59, '1달 후 시작'], [60, '2달 후 시작'], [365, '12달 후 시작']] as const) {
    const today = '2026-12-31'
    assert.deepEqual(taskDateLabel({ ...task, startDate: addDays(today, days), date: today }, today), { label, tone: 'muted' })
  }
  assert.equal(taskDateLabel({ ...task, startDate: '2024-03-01' }, '2024-02-28').label, '2일 후 시작')
})

test('future start labels follow the UI locale', () => {
  const previous = getUiLocale()
  try {
    for (const [locale, labels] of [
      ['en', ['In 2d', 'In 2w', 'In 2mo']],
      ['zh-CN', ['2天后开始', '2周后开始', '2个月后开始']],
      ['ja', ['2日後に開始', '2週間後に開始', '2か月後に開始']],
    ] as const) {
      setUiLocale(locale)
      for (const [index, days] of [2, 14, 60].entries()) {
        assert.equal(taskDateLabel({ ...task, startDate: addDays('2026-10-04', days) }, '2026-10-04').label, labels[index])
      }
    }
  } finally { setUiLocale(previous) }
})

test('list sorting follows date status priority, retains sibling order and preserves subtrees', () => {
  const items = [
    { ...task, id: 'future', startDate: '2026-10-05', date: '2026-10-06' },
    { ...task, id: 'late', date: '2026-10-01' },
    { ...task, id: 'soon', date: '2026-10-08' },
    { ...task, id: 'child-future', parentId: 'soon', startDate: '2026-10-06' },
    { ...task, id: 'child-today', parentId: 'soon', date: '2026-10-04' },
    { ...task, id: 'today', date: '2026-10-04' },
    { ...task, id: 'undated' },
    { ...task, id: 'soon-second', date: '2026-10-05', done: true },
  ]
  const original = [...items]
  assert.deepEqual(sortTasksByDateStatus(items, '2026-10-04').map(item => item.id), ['today', 'soon', 'child-today', 'child-future', 'soon-second', 'late', 'future', 'undated'])
  const added = { ...task, id: 'new-undated' }
  assert.deepEqual(sortTasksByDateStatus([...items, added], '2026-10-04').slice(-2).map(item => item.id), ['undated', 'new-undated'], 'new undated items stay below scheduled tasks and earlier undated items')
  assert.deepEqual(items, original, 'sorting leaves persisted input order untouched')
  assert.deepEqual(sortTasksByDateStatus([items[7], items[2]], '2026-10-04').map(item => item.id), ['soon-second', 'soon'], 'manual ordering within a status group remains stable')
  assert.equal(sortTasksByDateStatus(items, '2026-10-05').findIndex(item => item.id === 'soon-second'), 0, 'today changes the status priority')
})
