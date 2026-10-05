import { readTaskDocuments, writeTaskDocuments } from './task-markdown.ts'
import { taskRollups, taskWithRollup } from '../shared/task-rollup.ts'
import { collectTaskTags, validTags } from '../shared/task-tags.ts'
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
    && (item.tags === undefined || validTags(item.tags))
    && validTaskDates(item)
    && typeof item.text === 'string' && item.text.length <= TASK_TEXT_LIMIT && typeof item.done === 'boolean'
}
export function taskListFile(workspace: string) {
  return path.join(DATA_DIR, `task-list-${createHash('sha256').update(workspace).digest('hex')}.json`)
}
export function readTaskList(workspace: string): TaskItem[] {
  const data = readJsonFile<{ version: number; tasks: unknown; order?: string[] }>(taskListFile(workspace))
  if (data === null && fs.existsSync(taskListFile(workspace))) throw new Error('태스크 저장 파일을 읽지 못했습니다')
  if (data?.version === 3 || data === null) {
    const documents = readTaskDocuments(workspace)
    if (documents.length > TASK_LIMIT || !documents.every(doc => validItem(doc.task)) || !validTaskTree(documents.map(doc => doc.task))) throw new Error('태스크 저장 파일을 읽지 못했습니다')
    if (data?.version === 3 && (!Array.isArray(data.order) || !data.order.every(id => typeof id === 'string'))) throw new Error('태스크 저장 파일을 읽지 못했습니다')
    const order = data?.order ?? []
    const rank = new Map(order.map((id, index) => [id, index]))
    const tasks = documents.map(doc => doc.task).sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length))
    if (data?.version === 3 || tasks.length) return tasks
    return []
  }
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.tasks) || data.tasks.length > TASK_LIMIT || !data.tasks.every(validItem)
    || !validTaskTree(data.tasks) || (data.version === 2 && data.tasks.some(item => item.parentId != null))) throw new Error('태스크 저장 파일을 읽지 못했습니다')
  const tasks = data.tasks as TaskItem[]
  const rollups = taskRollups(tasks)
  return tasks.map(task => {
    const { id, text, done, tags, date, startDate } = taskWithRollup(task, rollups)
    return { id, text, done, ...(tags?.length ? { tags } : {}), ...(date ? { date } : {}), ...(startDate ? { startDate } : {}) }
  })
}
export function readTaskTags(workspace: string): string[] {
  const tasks = readTaskList(workspace)
  const data = readJsonFile<{ tags?: unknown }>(taskListFile(workspace))
  return collectTaskTags(tasks, Array.isArray(data?.tags) ? data.tags.filter(tag => typeof tag === 'string' && validTags([tag])) : [])
}
export function changeTaskList(workspace: string, input: unknown): TaskItem[] {
  if (!Array.isArray(input) || input.length > TASK_LIMIT * 2) throw new TaskInputError('잘못된 태스크 변경입니다')
  const ids = new Set<string>()
  for (const value of input) {
    const change = value as TaskChange
    if (!change || typeof change !== 'object' || typeof change.id !== 'string' || ids.has(change.id)
      || (change.before === null && change.after === null)
      || (change.before !== null && (!validItem(change.before) || change.before.id !== change.id))
      || (change.after !== null && (!validItem(change.after) || change.after.id !== change.id || change.after.parentId != null))
      || (change.move !== undefined && (typeof change.move !== 'boolean' || !change.before || !change.after))
      || (change.afterId !== null && (typeof change.afterId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(change.afterId) || change.afterId === change.id))) throw new TaskInputError('잘못된 태스크 변경입니다')
    ids.add(change.id)
  }
  const clean = (item: TaskItem | null): TaskItem | null => item === null ? null : { id: item.id, text: item.text, done: item.done, ...(item.tags?.length ? { tags: [...item.tags] } : {}), ...(item.date ? { date: item.date } : {}), ...(item.startDate ? { startDate: item.startDate } : {}) }
  const changes = (input as TaskChange[]).map(change => ({ id: change.id, before: clean(change.before), after: clean(change.after), afterId: change.afterId, ...(change.move ? { move: true } : {}) }))
  const stored = readJsonFile<{ version: number }>(taskListFile(workspace))
  if (stored && stored.version < 3 && readTaskDocuments(workspace).length) throw new Error('기존 태스크와 Markdown 파일이 중복됩니다')
  const tasks = applyTaskChanges(readTaskList(workspace), changes)
  if (tasks.length > TASK_LIMIT) throw new TaskInputError('태스크는 최대 2,000개까지 추가할 수 있습니다')
  const tags = collectTaskTags(tasks, readTaskTags(workspace))
  writeTaskDocuments(workspace, tasks, () => writeFileAtomic(taskListFile(workspace), JSON.stringify({ version: 3, order: tasks.map(task => task.id), tags }) + '\n'))
  return readTaskList(workspace)
}
