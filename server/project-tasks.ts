import path from 'node:path'
import { createHash } from 'node:crypto'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import type { ProjectTaskBoard } from '../shared/project-tasks.ts'

export class TaskBoardError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}
function invalid(): never { throw new TaskBoardError('태스크 정보가 올바르지 않습니다.') }
function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) return invalid()
  return value.trim()
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) return invalid()
  return value
}
function due(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid()
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid()
  return value
}
export function validateTaskBoard(value: unknown): ProjectTaskBoard {
  if (!value || typeof value !== 'object') return invalid()
  const board = value as ProjectTaskBoard
  if (!Number.isSafeInteger(board.revision) || board.revision < 0 || !Array.isArray(board.tasks) || !Array.isArray(board.milestones) || board.tasks.length > 2000 || board.milestones.length > 200) return invalid()
  const milestones = board.milestones.map(m => { if (!m || typeof m !== 'object') return invalid(); return { id: id(m.id), title: title(m.title), due: due(m.due) } })
  const ids = new Set(milestones.map(m => m.id))
  if (ids.size !== milestones.length) return invalid()
  const tasks = board.tasks.map(t => {
    if (!t || typeof t !== 'object' || !['todo', 'doing', 'blocked', 'done'].includes(t.status) || (t.milestoneId !== null && !ids.has(t.milestoneId))) return invalid()
    const parentId = t.parentId == null ? null : id(t.parentId)
    const priority = t.priority ?? null, time = t.time ?? null
    if (priority !== null && !['low', 'medium', 'high'].includes(priority)) return invalid()
    if (time !== null && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return invalid()
    return { id: id(t.id), title: title(t.title), milestoneId: t.milestoneId, status: t.status, due: due(t.due), parentId, priority, time }
  })
  if (new Set(tasks.map(t => t.id)).size !== tasks.length) return invalid()
  const byId = new Map(tasks.map(t => [t.id, t]))
  for (const task of tasks) {
    const visited = new Set([task.id])
    let parent = task.parentId
    while (parent !== null) {
      if (visited.has(parent) || !byId.has(parent)) return invalid()
      visited.add(parent)
      parent = byId.get(parent)!.parentId
    }
  }
  return { revision: board.revision, tasks, milestones }
}
export class ProjectTaskStore {
  directory: string
  constructor(directory = DATA_DIR) { this.directory = directory }
  file(workspace: string) { return path.join(this.directory, `project-tasks-${createHash('sha256').update(workspace).digest('hex')}.json`) }
  read(workspace: string): ProjectTaskBoard {
    const saved = readJsonFile<unknown>(this.file(workspace))
    return saved === null ? { revision: 0, tasks: [], milestones: [] } : validateTaskBoard(saved)
  }
  save(workspace: string, input: unknown): ProjectTaskBoard {
    const next = validateTaskBoard(input), previous = this.read(workspace)
    if (next.revision !== previous.revision) throw new TaskBoardError('다른 창에서 변경했습니다. 새로고침 후 다시 시도하세요.', 409)
    next.revision++
    writeFileAtomic(this.file(workspace), JSON.stringify(next))
    return next
  }
}
