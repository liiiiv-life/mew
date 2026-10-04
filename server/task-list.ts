import { taskRollups } from '../shared/task-rollup.ts'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { applyTaskChanges, validTaskTree, validTaskDates, TASK_LIMIT, TASK_TEXT_LIMIT, type TaskChange, type TaskItem } from '../shared/task-list.ts'

export class TaskInputError extends Error {}
function validItem(value: unknown): value is TaskItem {
  if (!value || typeof value !== 'object') return false
  const item = value as TaskItem
  return typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item.id)
    && (item.parentId == null || (typeof item.parentId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item.parentId)))
    && validTaskDates(item)
    && typeof item.text === 'string' && item.text.length <= TASK_TEXT_LIMIT && typeof item.done === 'boolean'
}
export function taskListFile(workspace: string) {
  return path.join(DATA_DIR, `task-list-${createHash('sha256').update(workspace).digest('hex')}.json`)
}
export function readTaskList(workspace: string): TaskItem[] {
  const data = readJsonFile<{ version: number; tasks: unknown }>(taskListFile(workspace))
  if (data === null) {
    if (fs.existsSync(taskListFile(workspace))) throw new Error('태스크 저장 파일을 읽지 못했습니다')
    return []
  }
  if (data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > TASK_LIMIT || !data.tasks.every(validItem)
    || !validTaskTree(data.tasks)) throw new Error('태스크 저장 파일을 읽지 못했습니다')
  return data.tasks.map(({ id, text, done, parentId, date, startDate }) => ({ id, text, done, ...(parentId ? { parentId } : {}), ...(date ? { date } : {}), ...(startDate ? { startDate } : {}) }))
}
export function changeTaskList(workspace: string, input: unknown): TaskItem[] {
  if (!Array.isArray(input) || input.length > TASK_LIMIT * 2) throw new TaskInputError('잘못된 태스크 변경입니다')
  const ids = new Set<string>()
  for (const value of input) {
    const change = value as TaskChange
    if (!change || typeof change !== 'object' || typeof change.id !== 'string' || ids.has(change.id)
      || (change.before === null && change.after === null)
      || (change.before !== null && (!validItem(change.before) || change.before.id !== change.id))
      || (change.after !== null && (!validItem(change.after) || change.after.id !== change.id))
      || (change.move !== undefined && (typeof change.move !== 'boolean' || !change.before || !change.after))
      || (change.afterId !== null && (typeof change.afterId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(change.afterId) || change.afterId === change.id))) throw new TaskInputError('잘못된 태스크 변경입니다')
    ids.add(change.id)
  }
  const clean = (item: TaskItem | null): TaskItem | null => item === null ? null : { id: item.id, text: item.text, done: item.done, ...(item.parentId ? { parentId: item.parentId } : {}), ...(item.date ? { date: item.date } : {}), ...(item.startDate ? { startDate: item.startDate } : {}) }
  const changes = (input as TaskChange[]).map(change => ({ id: change.id, before: clean(change.before), after: clean(change.after), afterId: change.afterId, ...(change.move ? { move: true } : {}) }))
  const tasks = applyTaskChanges(readTaskList(workspace), changes)
  const { parents } = taskRollups(tasks)
  for (const change of changes) {
    if (change.after && parents.has(change.id) && ((change.before?.startDate ?? null) !== (change.after.startDate ?? null) || (change.before?.date ?? null) !== (change.after.date ?? null))) {
      throw new TaskInputError('하위 항목이 있는 태스크의 일정은 자동 계산됩니다')
    }
  }
  if (tasks.length > TASK_LIMIT) throw new TaskInputError('태스크는 최대 2,000개까지 추가할 수 있습니다')
  writeFileAtomic(taskListFile(workspace), JSON.stringify({ version: 1, tasks }) + '\n')
  return tasks
}
