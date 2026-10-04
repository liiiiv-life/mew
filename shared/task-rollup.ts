import { taskParent, taskRange, type TaskItem } from './task-list.ts'

export type TaskRollups = { parents: Set<string>; ranges: Map<string, ReturnType<typeof taskRange>> }

/** Parent ranges are derived from leaves, including the gaps between their dates. */
export function taskRollups(tasks: TaskItem[]): TaskRollups {
  const parents = new Set(tasks.map(taskParent).filter((id): id is string => id !== null))
  const ranges: TaskRollups['ranges'] = new Map()
  for (const task of [...tasks].reverse()) {
    const range = parents.has(task.id) ? ranges.get(task.id) ?? null : taskRange(task)
    ranges.set(task.id, range)
    const parent = taskParent(task)
    if (!parent || !range) continue
    const previous = ranges.get(parent)
    ranges.set(parent, previous ? {
      start: previous.start < range.start ? previous.start : range.start,
      end: previous.end > range.end ? previous.end : range.end,
    } : { ...range })
  }
  return { parents, ranges }
}

/** Display derived dates without making them independent persisted edits. */
export function taskWithRollup(task: TaskItem, rollups: TaskRollups): TaskItem {
  if (!rollups.parents.has(task.id)) return task
  const range = rollups.ranges.get(task.id)
  return { ...task, startDate: range?.start ?? null, date: range?.end ?? null }
}
