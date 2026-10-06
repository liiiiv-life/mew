import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DATA_DIR, readJsonFile } from './dataDir.ts'
import { parseDocument, Document } from 'yaml'
import { sameTags } from '../shared/task-tags.ts'
import type { TaskItem } from '../shared/task-list.ts'

export const TASK_DOCUMENT_DIRECTORY = 'docs/tasks'
export const taskDirectory = (workspace: string) => path.join(workspace, TASK_DOCUMENT_DIRECTORY)
export type TaskDocumentIdentity = { id: string; path: string; device: number; inode: number }
export function taskListFile(workspace: string) {
  return path.join(DATA_DIR, `task-list-${createHash('sha256').update(workspace).digest('hex')}.json`)
}
function documentIdentity(workspace: string, relative: string, id: string): TaskDocumentIdentity {
  const stat = fs.statSync(path.join(workspace, relative))
  return { id, path: relative, device: stat.dev, inode: stat.ino }
}
type TaskDocument = { task: TaskItem; raw: string; body: string; yaml: ReturnType<typeof parseDocument> }

function taskDocumentTags(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return undefined
  if (!text.startsWith('[')) return [text]
  const parsed = parseDocument(text)
  if (parsed.errors.length) return value
  const tags = parsed.toJS()
  return Array.isArray(tags) ? tags : value
}

function directory(workspace: string, relative: string) {
  let dir = workspace
  for (const segment of relative.split('/')) {
    dir = path.join(dir, segment)
    if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) throw new Error('Invalid task directory')
  }
  return dir
}
export function readTaskDocuments(workspace: string): TaskDocument[] {
  const metadata = readJsonFile<{ version: number; documents?: TaskDocumentIdentity[] }>(taskListFile(workspace))
  const identities = metadata?.version === 5 ? metadata.documents : []
  if (!Array.isArray(identities) || !identities.every(item => item && typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item.id) && typeof item.path === 'string' && Number.isFinite(item.device) && Number.isFinite(item.inode))
    || new Set(identities.map(item => item.id)).size !== identities.length || new Set(identities.map(item => item.path)).size !== identities.length) throw new Error('Invalid task document metadata')
  return [TASK_DOCUMENT_DIRECTORY, 'tasks'].flatMap(relative => {
    const dir = directory(workspace, relative)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(name => name.endsWith('.md')).sort().map(name => {
      const file = path.join(dir, name)
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid task file')
      const raw = fs.readFileSync(file, 'utf8')
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
      if (!match) throw new Error('Missing task frontmatter')
      const yaml = parseDocument(match[1])
      if (yaml.errors.length) throw new Error('Invalid task frontmatter')
      const value = yaml.toJS() as Record<string, unknown>
      if (!value || typeof value !== 'object') throw new Error('Invalid task frontmatter')
      const relativePath = `${relative}/${name}`
      const stat = fs.statSync(file)
      const identity = identities.find(item => item.path === relativePath) ?? identities.find(item => stat.ino !== 0 && item.device === stat.dev && item.inode === stat.ino)
      const id = identity?.id ?? value.id ?? createHash('sha256').update(stat.ino ? `${stat.dev}:${stat.ino}` : relativePath).digest('hex')
      const tags = taskDocumentTags(value.tags)
      const done = value.done === 'true' ? true : value.done === 'false' ? false : value.done
      const task = { id, text: value.title, done,
        ...(tags != null ? { tags } : {}), ...(value.date != null ? { date: value.date } : {}),
        ...(value.startDate != null ? { startDate: value.startDate } : {}), path: relativePath } as TaskItem
      return { task, raw, body: raw.slice(match[0].length), yaml }
    })
  })
}

export function taskFilename(title: string): string {
  let name = title.replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').trim().replace(/[. ]+$/, '')
  if (!name) name = '제목 없음'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
  // Leave room for .md and collision suffixes on filesystems with a 255-byte name limit.
  let shortened = ''
  for (const character of name) {
    if (Buffer.byteLength(shortened + character) > 200) break
    shortened += character
  }
  return shortened.replace(/[. ]+$/, '') || '제목 없음'
}

function documentPaths(tasks: TaskItem[]): Map<string, string> {
  const paths = new Map<string, string>(), used = new Set<string>()
  const key = (value: string) => value.normalize('NFC').toLowerCase()
  const base = (task: TaskItem) => `${TASK_DOCUMENT_DIRECTORY}/${taskFilename(task.text)}`
  // Keep existing suffixes stable when siblings are deleted or reordered.
  for (const task of tasks) {
    const prefix = base(task), current = task.path
    const suffix = current?.startsWith(`${prefix} (`) ? current.slice(prefix.length) : ''
    if (current && (current === `${prefix}.md` || /^ \((?:[2-9]|[1-9]\d+)\)\.md$/.test(suffix)) && !used.has(key(current))) {
      paths.set(task.id, current); used.add(key(current))
    }
  }
  for (const task of tasks) {
    if (paths.has(task.id)) continue
    const prefix = base(task)
    let file = `${prefix}.md`, counter = 2
    while (used.has(key(file))) file = `${prefix} (${counter++}).md`
    paths.set(task.id, file); used.add(key(file))
  }
  return paths
}
export function taskDocumentsNeedMigration(tasks: TaskItem[], workspace?: string): boolean {
  const paths = documentPaths(tasks)
  if (tasks.some(task => task.path !== paths.get(task.id))) return true
  if (!workspace) return false
  const metadata = readJsonFile<{ documents?: TaskDocumentIdentity[] }>(taskListFile(workspace))
  if (metadata?.documents?.length !== tasks.length) return true
  return readTaskDocuments(workspace).some(doc => {
    const current = documentIdentity(workspace, doc.task.path!, doc.task.id)
    return doc.yaml.has('id') || !metadata.documents?.some(item => item.id === current.id && item.path === current.path && item.device === current.device && item.inode === current.inode)
  })
}

/** Validate the full batch before writing; restore files if any write or metadata commit fails. */
export function writeTaskDocuments(workspace: string, tasks: TaskItem[], commit: (documents: TaskDocumentIdentity[]) => void) {
  const dir = directory(workspace, TASK_DOCUMENT_DIRECTORY)
  const documents = readTaskDocuments(workspace)
  const existing = new Map(documents.map(doc => [doc.task.id, doc]))
  const paths = documentPaths(tasks)
  const sourcePaths = new Set(documents.map(doc => doc.task.path))
  const writes = new Map<string, string | null>()
  for (const doc of documents) if (doc.task.path !== paths.get(doc.task.id)) writes.set(doc.task.path!, null)
  for (const task of tasks) {
    const old = existing.get(task.id), file = paths.get(task.id)!
    if (!sourcePaths.has(file) && fs.existsSync(path.join(workspace, file)) && !documents.some(doc => doc.task.path!.normalize('NFC').toLowerCase() === file.normalize('NFC').toLowerCase() && fs.realpathSync(path.join(workspace, doc.task.path!)) === fs.realpathSync(path.join(workspace, file)))) throw new Error('Task file already exists')
    const yaml = old?.yaml ?? new Document({})
    let changed = !old
    if (yaml.has('id')) { yaml.delete('id'); changed = true }
    if (!old || old.task.text !== task.text) { yaml.set('title', task.text); changed = true }
    if (!old || old.task.done !== task.done) { yaml.set('done', task.done); changed = true }
    for (const key of ['tags', 'date', 'startDate'] as const) {
      const value = task[key]
      if (old && (key === 'tags' ? sameTags(old.task.tags, task.tags) : (old.task[key] ?? null) === (value ?? null))) continue
      if (value == null || Array.isArray(value) && !value.length) yaml.delete(key)
      else yaml.set(key, value)
      changed = true
    }
    const raw = old && !changed ? old.raw : `---\n${yaml.toString()}---\n${old?.body ?? ''}`
    if (file !== old?.task.path || raw !== old?.raw) writes.set(file, raw)
  }
  fs.mkdirSync(dir, { recursive: true })
  // Capture every source before mutations so filename swaps can also roll back.
  const backups = new Map([...writes.keys()].map(relative => {
    const file = path.join(workspace, relative)
    return [file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null] as const
  }))
  try {
    for (const [relative, raw] of writes) {
      const file = path.join(workspace, relative)
      if (raw === null) fs.unlinkSync(file)
      else {
        const temporary = `${file}.tmp-${process.pid}`
        let created = false
        try { fs.writeFileSync(temporary, raw, { flag: 'wx' }); created = true; fs.renameSync(temporary, file) }
        finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary) }
      }
    }
    commit(tasks.map(task => documentIdentity(workspace, paths.get(task.id)!, task.id)))
  } catch (error) {
    for (const [file, raw] of backups) {
      if (raw === null) fs.rmSync(file, { force: true })
      else fs.writeFileSync(file, raw)
    }
    throw error
  }
}
