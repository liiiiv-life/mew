import { sameTags, taskTags, validTags } from './task-tags.ts'
import { validDateValue } from '@mew/ui/date-value'

export type TaskItem = { id: string; path?: string; text: string; done: boolean; tags?: string[]; parentId?: string | null; date?: string | null; startDate?: string | null }
export type TaskChange = { id: string; before: TaskItem | null; after: TaskItem | null; afterId: string | null; move?: boolean }
export type TaskBoard = { tasks: TaskItem[]; canEdit: boolean; tags?: string[]; tagColors?: import('./task-tag-colors.ts').TaskTagColors }
export const TASK_LIMIT = 2000
export const TASK_TEXT_LIMIT = 8000

export class TaskConflict extends Error {
  constructor() { super('다른 창에서 같은 태스크를 수정했습니다. 입력은 유지됩니다. 확인 후 다시 저장하세요.') }
}

export function taskChanges(before: TaskItem[], after: TaskItem[]): TaskChange[] {
  const old = new Map(before.map(item => [item.id, item]))
  const next = new Map(after.map(item => [item.id, item]))
  const changes: TaskChange[] = before.filter(item => !next.has(item.id)).map(item => ({ id: item.id, before: item, after: null, afterId: null }))
  const order = before.filter(item => next.has(item.id)).map(item => item.id)
  after.forEach((item, index) => {
    const previous = old.get(item.id) ?? null
    const position = order.indexOf(item.id)
    const move = !!previous && position !== index
    if (!previous || move) {
      if (position >= 0) order.splice(position, 1)
      order.splice(index, 0, item.id)
    }
    if (!previous || move || previous.text !== item.text || previous.done !== item.done || !sameTags(previous.tags, item.tags) || taskParent(previous) !== taskParent(item) || taskDate(previous) !== taskDate(item) || taskStartDate(previous) !== taskStartDate(item)) changes.push({ id: item.id, before: previous, after: item, afterId: after[index - 1]?.id ?? null, ...(move ? { move: true } : {}) })
  })
  return changes
}

/** Merge unrelated objects/fields; reject conflicting edits as one atomic batch. */
export function applyTaskChanges(tasks: TaskItem[], changes: TaskChange[]): TaskItem[] {
  const next = tasks.map(item => ({ ...item }))
  for (const change of changes) {
    const index = next.findIndex(item => item.id === change.id)
    const current = next[index]
    if (!change.before) {
      if (!change.after) throw new TaskConflict()
      if (current) {
        if (current.text !== change.after.text || current.done !== change.after.done || !sameTags(current.tags, change.after.tags) || taskParent(current) !== taskParent(change.after) || taskDate(current) !== taskDate(change.after) || taskStartDate(current) !== taskStartDate(change.after)) throw new TaskConflict()
        continue // Retrying an acknowledged-but-lost creation response.
      }
      const anchor = change.afterId === null ? -1 : next.findIndex(item => item.id === change.afterId)
      if (change.afterId !== null && anchor < 0) throw new TaskConflict()
      next.splice(anchor + 1, 0, { ...change.after })
    } else if (!change.after) {
      if (!current) continue
      if (current.text !== change.before.text || current.done !== change.before.done || !sameTags(current.tags, change.before.tags) || taskParent(current) !== taskParent(change.before) || taskDate(current) !== taskDate(change.before) || taskStartDate(current) !== taskStartDate(change.before)) throw new TaskConflict()
      next.splice(index, 1)
    } else {
      if (!current) throw new TaskConflict()
      for (const field of ['text', 'done'] as const) {
        if (change.before[field] === change.after[field]) continue
        if (current[field] !== change.before[field] && current[field] !== change.after[field]) throw new TaskConflict()
      }
      if (!sameTags(change.before.tags, change.after.tags)) {
        if (!sameTags(current.tags, change.before.tags) && !sameTags(current.tags, change.after.tags)) throw new TaskConflict()
        current.tags = [...taskTags(change.after)]
      }
      if (taskDate(change.before) !== taskDate(change.after)) {
        if (taskDate(current) !== taskDate(change.before) && taskDate(current) !== taskDate(change.after)) throw new TaskConflict()
        current.date = taskDate(change.after)
      }
      if (taskStartDate(change.before) !== taskStartDate(change.after)) {
        if (taskStartDate(current) !== taskStartDate(change.before) && taskStartDate(current) !== taskStartDate(change.after)) throw new TaskConflict()
        current.startDate = taskStartDate(change.after)
      }
      if (taskParent(change.before) !== taskParent(change.after)) {
        if (taskParent(current) !== taskParent(change.before) && taskParent(current) !== taskParent(change.after)) throw new TaskConflict()
        current.parentId = taskParent(change.after)
      }
      if (change.before.text !== change.after.text) current.text = change.after.text
      if (change.before.done !== change.after.done) current.done = change.after.done
      if (change.move) {
        next.splice(index, 1)
        const anchor = change.afterId === null ? -1 : next.findIndex(item => item.id === change.afterId)
        if (change.afterId !== null && anchor < 0) throw new TaskConflict()
        next.splice(anchor + 1, 0, current)
      }
    }
  }
  if (!validTaskTree(next)) throw new TaskConflict()
  return next
}

export const taskDate = (item: TaskItem): string | null => item.date ?? null
export const taskStartDate = (item: TaskItem): string | null => item.startDate ?? null
export const taskParent = (item: TaskItem): string | null => item.parentId ?? null

export function validTaskDates(item: TaskItem): boolean {
  return (item.date == null || validDateValue(item.date))
    && (item.startDate == null || validDateValue(item.startDate))
    && !(item.date && item.startDate && item.startDate > item.date)
}

/** Changing one endpoint keeps the range valid; clearing it leaves the other intact. */
export function setTaskDate(item: TaskItem, field: 'startDate' | 'date', value: string | null): TaskItem {
  const next = { ...item, [field]: value }
  if (next.startDate && next.date && next.startDate > next.date) {
    if (field === 'startDate') next.date = value
    else next.startDate = value
  }
  return next
}

/** A single endpoint is a one-day event. Both endpoints are inclusive. */
export function taskRange(item: TaskItem): { start: string; end: string } | null {
  const start = item.startDate || item.date, end = item.date || item.startDate
  return start && end ? { start, end } : null
}

/** Flat preorder keeps typing, persistence and subtree moves in the same order. */
export function validTaskTree(tasks: TaskItem[]): boolean {
  const path: string[] = [], seen = new Set<string>()
  for (const item of tasks) {
    if (!validTaskDates(item) || (item.tags !== undefined && !validTags(item.tags))) return false
    if (seen.has(item.id)) return false
    const parent = taskParent(item)
    if (parent === null) path.length = 0
    else {
      const index = path.indexOf(parent)
      if (index < 0) return false
      path.length = index + 1
    }
    path.push(item.id); seen.add(item.id)
  }
  return true
}
export function taskDepths(tasks: TaskItem[]): Map<string, number> {
  const depths = new Map<string, number>()
  for (const item of tasks) depths.set(item.id, item.parentId ? (depths.get(item.parentId) ?? 0) + 1 : 0)
  return depths
}
export function taskSubtreeEnd(tasks: TaskItem[], index: number): number {
  const descendants = new Set([tasks[index].id])
  let end = index + 1
  while (end < tasks.length && descendants.has(taskParent(tasks[end]) ?? '')) { descendants.add(tasks[end].id); end++ }
  return end
}
export function removeTask(tasks: TaskItem[], index: number): TaskItem[] {
  const removed = tasks[index]
  return tasks.filter((_, i) => i !== index).map(item => taskParent(item) === removed.id ? { ...item, parentId: taskParent(removed) } : item)
}
export function moveTaskSubtree(tasks: TaskItem[], id: string, beforeId: string | null): TaskItem[] {
  const start = tasks.findIndex(item => item.id === id)
  if (start < 0) return tasks
  const end = taskSubtreeEnd(tasks, start), parent = taskParent(tasks[start])
  const block = tasks.slice(start, end)
  if (block.some(item => item.id === beforeId)) return tasks
  const next = [...tasks.slice(0, start), ...tasks.slice(end)]
  let index: number
  if (beforeId === null) {
    index = parent === null ? next.length : taskSubtreeEnd(next, next.findIndex(item => item.id === parent))
  } else {
    index = next.findIndex(item => item.id === beforeId)
    if (index < 0 || taskParent(next[index]) !== parent) return tasks
  }
  next.splice(index, 0, ...block)
  return next
}

/** Replace the visible slots without moving or deleting items hidden by a filter. */
export function mergeVisibleTasks(all: TaskItem[], visible: TaskItem[], next: TaskItem[]): TaskItem[] {
  const visibleIds = new Set(visible.map(task => task.id)), allIds = new Set(all.map(task => task.id))
  const remaining = next.filter(task => allIds.has(task.id))
  let index = 0
  return [...all.flatMap(task => visibleIds.has(task.id) ? remaining[index] ? [remaining[index++]] : [] : [task]), ...next.filter(task => !allIds.has(task.id))]
}
