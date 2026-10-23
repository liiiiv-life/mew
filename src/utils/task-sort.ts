import type { TaskItem } from '../../shared/task-list.ts'
import { taskTags } from '../../shared/task-tags.ts'
import { toDay } from './task-timeline.ts'

export const TASK_SORT_FIELDS = ['tags', 'schedule', 'startStatus', 'dueDate', 'startDate', 'title'] as const
export type TaskSortField = typeof TASK_SORT_FIELDS[number]
export type TaskSortRule = { field: TaskSortField; direction: 'asc' | 'desc' }

export const defaultTaskSortRules = (): TaskSortRule[] => [
  { field: 'tags', direction: 'asc' },
  { field: 'schedule', direction: 'asc' },
]

export function sortTasks(tasks: TaskItem[], rules: TaskSortRule[], locale: string, today: string): TaskItem[] {
  const compare = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare
  const scheduleKey = (task: TaskItem): string[] => {
    if (task.startDate && task.startDate > today) return ['3', task.startDate]
    if (!task.date) return []
    if (task.date < today) return ['2', String(toDay(today) - toDay(task.date))]
    return [task.date === today ? '0' : '1', task.date]
  }
  const keys = new Map(tasks.map(task => [task.id, {
    tags: taskTags(task).slice().sort(compare), title: [task.text], schedule: scheduleKey(task),
    startStatus: task.startDate && task.startDate > today ? ['1'] : task.startDate || task.date ? ['0'] : [],
    dueDate: task.date ? [task.date] : [], startDate: task.startDate ? [task.startDate] : [],
  }]))
  return tasks.slice().sort((a, b) => {
    for (const { field, direction } of rules) {
      const left = keys.get(a.id)![field], right = keys.get(b.id)![field]
      // Unset tags/dates stay last in either direction.
      if (!left.length || !right.length) {
        const missing = Number(!left.length) - Number(!right.length)
        if (missing) return missing
        continue
      }
      let order = 0
      for (let i = 0; i < Math.min(left.length, right.length) && !order; i++) order = compare(left[i], right[i])
      order ||= left.length - right.length
      if (order) return direction === 'asc' ? order : -order
    }
    return 0
  })
}
