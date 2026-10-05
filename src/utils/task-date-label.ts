import { taskRollups, taskWithRollup } from '../../shared/task-rollup.ts'
import { taskParent, type TaskItem } from '../../shared/task-list.ts'
import { toDay } from './task-timeline.ts'

export function taskDateLabel(task: TaskItem, today: string): { label: string; tone: 'muted' | 'normal' | 'danger' } {
  if (task.startDate && task.startDate > today) return { label: '시작 전', tone: 'muted' }
  if (!task.date) return { label: '날짜 설정', tone: 'muted' }
  const days = toDay(task.date) - toDay(today)
  return { label: days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : `D+${-days}`, tone: days < 0 ? 'danger' : 'normal' }
}

/** Stable sibling sorting keeps each parent's descendants in its subtree. */
export function sortTasksByDateStatus(tasks: TaskItem[], today: string): TaskItem[] {
  const rollups = taskRollups(tasks)
  const rank = (original: TaskItem) => {
    const task = taskWithRollup(original, rollups)
    if (task.startDate && task.startDate > today) return 3
    if (!task.date) return 4
    return task.date === today ? 0 : task.date > today ? 1 : 2
  }
  const children = new Map<string | null, TaskItem[]>()
  for (const task of tasks) {
    const parent = taskParent(task)
    const siblings = children.get(parent) ?? []
    siblings.push(task)
    children.set(parent, siblings)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => rank(a) - rank(b))
  const result: TaskItem[] = []
  const append = (parent: string | null) => {
    for (const task of children.get(parent) ?? []) { result.push(task); append(task.id) }
  }
  append(null)
  return result
}
