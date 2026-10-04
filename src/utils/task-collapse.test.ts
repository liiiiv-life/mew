import test from 'node:test'
import assert from 'node:assert/strict'
import { hiddenTaskIds, expandTaskAncestors } from './task-collapse.ts'
import { moveTaskSubtree, removeTask, type TaskItem } from '../../shared/task-list.ts'
import { taskRollups } from '../../shared/task-rollup.ts'

const tasks: TaskItem[] = [
  { id: 'p', text: 'parent', done: false },
  { id: 'n', text: 'nested', done: false, parentId: 'p' },
  { id: 'leaf', text: 'leaf', done: false, parentId: 'n', startDate: '2026-09-01', date: '2026-09-03' },
  { id: 'sibling', text: 'sibling', done: false, parentId: 'p', startDate: '2026-09-06', date: '2026-09-08' },
  { id: 'other', text: 'other', done: false },
]

test('collapsing hides every descendant, keeps unrelated rows and retains nested collapse state', () => {
  const original = structuredClone(tasks), collapsed = new Set(['p', 'n'])
  assert.deepEqual([...hiddenTaskIds(tasks, collapsed)], ['n', 'leaf', 'sibling'])
  collapsed.delete('p')
  assert.deepEqual([...hiddenTaskIds(tasks, collapsed)], ['leaf'])
  assert.deepEqual([...hiddenTaskIds(tasks, new Set())], [])
  assert.deepEqual(tasks, original)
  assert.deepEqual(taskRollups(tasks).ranges.get('p'), { start: '2026-09-01', end: '2026-09-08' }, 'folding never removes dates from rollups')
  assert.deepEqual(moveTaskSubtree(tasks, 'p', null).map(task => task.id), ['other', 'p', 'n', 'leaf', 'sibling'], 'a folded subtree still moves as one block')
  assert.deepEqual([...hiddenTaskIds(removeTask(tasks, 0), new Set(['p']))], [], 'deleting the folded parent exposes promoted children')
})

test('revealing a focused descendant expands its ancestors while keeping unrelated folders collapsed', () => {
  const collapsed = new Set(['p', 'n', 'other'])
  assert.deepEqual([...expandTaskAncestors(tasks, 'leaf', collapsed)], ['other'])
  assert.deepEqual([...expandTaskAncestors(tasks, 'n', collapsed)], ['n', 'other'])
  assert.deepEqual([...collapsed], ['p', 'n', 'other'])
})
