// 홈 탭의 할 일 원장. 코드·문서 안의 표식을 훑지 않고, 로그인 사용자별 JSON 상태 파일에 저장한다.
import crypto from 'node:crypto'
import path from 'node:path'
import { DATA_DIR, readJsonRecord, writeFileAtomic } from './dataDir.ts'

export interface TodoItem {
  id: string
  text: string
  type: TodoType
  status: TodoStatus
  done: boolean
  /** YYYY-MM-DD 또는 null */
  due: string | null
  projects: string[]
  createdAt: string
  updatedAt: string
}

export type TodoType = 'today' | 'dated' | 'recurring'
export type TodoStatus = 'open' | 'done' | 'canceled' | 'missed'

export interface TodoCreate {
  text: string
  type?: TodoType
  due?: string | null
  projects?: string[]
}

export interface TodoChange {
  text?: string
  type?: TodoType
  status?: TodoStatus
  done?: boolean
  /** null이면 기한을 지운다 */
  due?: string | null
  projects?: string[]
}

export class TodoError extends Error {}

const FILE = path.join(DATA_DIR, 'todos.json')
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_TEXT = 240
const MAX_ITEMS_PER_USER = 1000

type TodoFile = Record<string, TodoItem[]>

function nowISO(): string {
  return new Date().toISOString()
}

function userKey(email: string): string {
  const key = email.trim().toLowerCase()
  if (!key) throw new TodoError('로그인이 필요합니다')
  return key
}

function readAll(): TodoFile {
  return readJsonRecord<TodoItem[]>(FILE) ?? {}
}

function writeAll(file: TodoFile): void {
  writeFileAtomic(FILE, `${JSON.stringify(file, null, 2)}\n`)
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') throw new TodoError('할 일을 입력하세요')
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) throw new TodoError('할 일을 입력하세요')
  if (text.length > MAX_TEXT) throw new TodoError(`할 일은 ${MAX_TEXT}자까지 입력할 수 있습니다`)
  return text
}

function normalizeDue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !DUE_RE.test(value)) throw new TodoError('기한 형식이 올바르지 않습니다')
  return value
}

function normalizeType(value: unknown, due: string | null): TodoType {
  if (value === undefined || value === null || value === '') return due ? 'dated' : 'today'
  if (value === 'today' || value === 'dated' || value === 'recurring') return value
  throw new TodoError('할 일 종류가 올바르지 않습니다')
}

function normalizeStatus(value: unknown, done: boolean): TodoStatus {
  if (value === undefined || value === null || value === '') return done ? 'done' : 'open'
  if (value === 'open' || value === 'done' || value === 'canceled' || value === 'missed') return value
  throw new TodoError('상태가 올바르지 않습니다')
}

function doneFromStatus(status: TodoStatus): boolean {
  return status === 'done'
}

function normalizeProjects(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new TodoError('프로젝트 목록이 올바르지 않습니다')
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !PROJECT_RE.test(entry)) throw new TodoError('프로젝트 이름이 올바르지 않습니다')
    seen.add(entry)
  }
  return [...seen].slice(0, 50)
}

function normalizeSchedule(type: TodoType, due: string | null): { type: TodoType; due: string | null } {
  if (type === 'dated') {
    if (!due) throw new TodoError('기한 있는 일은 날짜가 필요합니다')
    return { type, due }
  }
  return { type, due: null }
}

function normalizeItem(value: TodoItem): TodoItem | null {
  try {
    if (!value || typeof value !== 'object') return null
    if (typeof value.id !== 'string' || !value.id) return null
    if (typeof value.text !== 'string' || !value.text.trim()) return null
    const legacyDone = typeof value.done === 'boolean' ? value.done : false
    if (value.due !== null && (typeof value.due !== 'string' || !DUE_RE.test(value.due))) return null
    if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null
    const type = normalizeType(value.type, value.due)
    const status = normalizeStatus(value.status, legacyDone)
    const schedule = normalizeSchedule(type, value.due)
    return {
      id: value.id,
      text: value.text,
      type: schedule.type,
      status,
      done: doneFromStatus(status),
      due: schedule.due,
      projects: normalizeProjects(value.projects),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }
  } catch {
    return null
  }
}

function sortTodos(items: TodoItem[]): TodoItem[] {
  const typeRank: Record<TodoType, number> = { today: 0, dated: 1, recurring: 2 }
  const statusRank: Record<TodoStatus, number> = { open: 0, missed: 1, canceled: 2, done: 3 }
  return [...items].sort(
    (a, b) =>
      typeRank[a.type] - typeRank[b.type] ||
      statusRank[a.status] - statusRank[b.status] ||
      Number(a.due == null) - Number(b.due == null) ||
      (a.due ?? '').localeCompare(b.due ?? '') ||
      b.createdAt.localeCompare(a.createdAt),
  )
}

export function listTodos(email: string): TodoItem[] {
  const file = readAll()
  return sortTodos((file[userKey(email)] ?? []).map(normalizeItem).filter((v): v is TodoItem => v != null))
}

export function createTodo(email: string, input: TodoCreate): TodoItem {
  const key = userKey(email)
  const file = readAll()
  const items = (file[key] ?? []).map(normalizeItem).filter((v): v is TodoItem => v != null)
  if (items.length >= MAX_ITEMS_PER_USER) throw new TodoError(`할 일은 사용자당 ${MAX_ITEMS_PER_USER}개까지 저장할 수 있습니다`)
  const at = nowISO()
  const due = normalizeDue(input.due)
  const schedule = normalizeSchedule(normalizeType(input.type, due), due)
  const item: TodoItem = {
    id: crypto.randomUUID(),
    text: normalizeText(input.text),
    type: schedule.type,
    status: 'open',
    done: false,
    due: schedule.due,
    projects: normalizeProjects(input.projects),
    createdAt: at,
    updatedAt: at,
  }
  file[key] = sortTodos([item, ...items])
  writeAll(file)
  return item
}

export function updateTodo(email: string, id: string, change: TodoChange): TodoItem {
  if (!id) throw new TodoError('할 일을 찾을 수 없습니다')
  const key = userKey(email)
  const file = readAll()
  const items = (file[key] ?? []).map(normalizeItem).filter((v): v is TodoItem => v != null)
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) throw new TodoError('할 일을 찾을 수 없습니다')
  const prev = items[index]
  if (change.done !== undefined && typeof change.done !== 'boolean') throw new TodoError('완료 여부가 올바르지 않습니다')
  const due = change.due === undefined ? prev.due : normalizeDue(change.due)
  const type = change.type === undefined ? prev.type : normalizeType(change.type, due)
  const schedule = normalizeSchedule(type, due)
  const status =
    change.status === undefined
      ? change.done === undefined
        ? prev.status
        : change.done
          ? 'done'
          : 'open'
      : normalizeStatus(change.status, prev.done)
  const next: TodoItem = {
    ...prev,
    text: change.text === undefined ? prev.text : normalizeText(change.text),
    type: schedule.type,
    status,
    done: doneFromStatus(status),
    due: schedule.due,
    projects: change.projects === undefined ? prev.projects : normalizeProjects(change.projects),
    updatedAt: nowISO(),
  }
  items[index] = next
  file[key] = sortTodos(items)
  writeAll(file)
  return next
}

export function deleteTodo(email: string, id: string): void {
  if (!id) throw new TodoError('할 일을 찾을 수 없습니다')
  const key = userKey(email)
  const file = readAll()
  const items = (file[key] ?? []).map(normalizeItem).filter((v): v is TodoItem => v != null)
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) throw new TodoError('할 일을 찾을 수 없습니다')
  file[key] = sortTodos(next)
  writeAll(file)
}
