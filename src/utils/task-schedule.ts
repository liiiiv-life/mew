import { taskRollups } from '../../shared/task-rollup.ts'
import { taskRange, type TaskItem } from '../../shared/task-list.ts'
import { toDay, fromDay } from './task-timeline.ts'

export type TaskStatus = 'done' | 'planned' | 'missed'
export const taskStatusLabels = { done: '완료', planned: '계획', missed: '지연' } as const
// Status palette and union calculation adapted from liiiiv/gantt-maker's model/rollup.
export const taskStyles = {
  done: { from: '#4ade80', to: '#15a34a' },
  planned: { from: '#7dd3fc', to: '#2563eb' },
  missed: { from: '#fca5a5', to: '#dc2626' },
} as const
export type TaskBar = { start: string; end: string; from: string; to: string; own: boolean }
export function taskStatus(task: TaskItem, today: string): TaskStatus {
  return task.done ? 'done' : (taskRange(task)?.end ?? today) < today ? 'missed' : 'planned'
}
export function tasksOnDate(tasks: TaskItem[], day: string): TaskItem[] {
  const { ranges } = taskRollups(tasks)
  return tasks.filter(task => { const range = ranges.get(task.id); return range && range.start <= day && day <= range.end })
}
/** Every parent has one continuous, read-only bar spanning its descendant schedules. */
export function taskBars(tasks: TaskItem[], today: string): Map<string, TaskBar[]> {
  const { parents, ranges } = taskRollups(tasks)
  return new Map(tasks.map(task => {
    const range = ranges.get(task.id)
    const effective = range ? { ...task, startDate: range.start, date: range.end } : task
    return [task.id, range ? [{ ...range, ...taskStyles[taskStatus(effective, today)], own: !parents.has(task.id) }] : []]
  }))
}

export const MIN_TASK_DAY = toDay('0001-01-01'), MAX_TASK_DAY = toDay('9999-12-31')
export function moveTaskRange(task: TaskItem, delta: number, mode: 'move' | 'start' | 'end'): TaskItem {
  const range = taskRange(task)
  if (!range) return task
  let start = toDay(range.start), end = toDay(range.end)
  if (mode === 'move') {
    const shift = Math.max(MIN_TASK_DAY - start, Math.min(MAX_TASK_DAY - end, delta))
    start += shift; end += shift
  } else if (mode === 'start') start = Math.max(MIN_TASK_DAY, Math.min(end, start + delta))
  else end = Math.min(MAX_TASK_DAY, Math.max(start, end + delta))
  return { ...task, startDate: fromDay(start), date: fromDay(end) }
}
