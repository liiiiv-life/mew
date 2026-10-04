import { taskParent, type TaskItem } from '../../shared/task-list.ts'

/** Keep hidden descendants in the data so dates, edits and subtree moves remain intact. */
export function hiddenTaskIds(tasks: TaskItem[], collapsed: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>()
  for (const task of tasks) {
    const parent = taskParent(task)
    if (parent && (collapsed.has(parent) || hidden.has(parent))) hidden.add(task.id)
  }
  return hidden
}

export function expandTaskAncestors(tasks: TaskItem[], id: string, collapsed: ReadonlySet<string>): Set<string> {
  const next = new Set(collapsed), parents = new Map(tasks.map(task => [task.id, taskParent(task)]))
  const visited = new Set<string>()
  let parent = parents.get(id)
  while (parent && !visited.has(parent)) { next.delete(parent); visited.add(parent); parent = parents.get(parent) }
  return next
}
