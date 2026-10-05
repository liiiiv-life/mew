import fs from 'node:fs'
import path from 'node:path'
import { parseDocument, Document } from 'yaml'
import type { TaskItem } from '../shared/task-list.ts'

export const taskDirectory = (workspace: string) => path.join(workspace, 'tasks')
type TaskDocument = { task: TaskItem; raw: string; body: string; yaml: ReturnType<typeof parseDocument> }

function directory(workspace: string) {
  const dir = taskDirectory(workspace)
  if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) throw new Error('Invalid task directory')
  return dir
}
export function readTaskDocuments(workspace: string): TaskDocument[] {
  const dir = directory(workspace)
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
    const task = { id: value.id, text: value.title, done: value.done,
      ...(value.tags != null ? { tags: value.tags } : {}), ...(value.date != null ? { date: value.date } : {}),
      ...(value.startDate != null ? { startDate: value.startDate } : {}), path: `tasks/${name}` } as TaskItem
    return { task, raw, body: raw.slice(match[0].length), yaml }
  })
}

/** Validate the full batch before writing; restore files if any write or metadata commit fails. */
export function writeTaskDocuments(workspace: string, tasks: TaskItem[], commit: () => void) {
  const dir = directory(workspace)
  const documents = readTaskDocuments(workspace)
  const existing = new Map(documents.map(doc => [doc.task.id, doc]))
  const writes = new Map<string, string | null>()
  for (const task of tasks) {
    const old = existing.get(task.id)
    const file = old?.task.path ?? `tasks/${task.id}.md`
    if (!old && fs.existsSync(path.join(workspace, file))) throw new Error('Task file already exists')
    const yaml = old?.yaml ?? new Document({})
    yaml.set('id', task.id); yaml.set('title', task.text); yaml.set('done', task.done)
    for (const key of ['tags', 'date', 'startDate'] as const) {
      const value = task[key]
      if (value == null || Array.isArray(value) && !value.length) yaml.delete(key)
      else yaml.set(key, value)
    }
    // The frontmatter title is the document title; preserve the user's Markdown body verbatim.
    const raw = `---\n${yaml.toString()}---\n${old?.body ?? ''}`
    if (raw !== old?.raw) writes.set(file, raw)
  }
  for (const doc of documents) if (!tasks.some(task => task.id === doc.task.id)) writes.set(doc.task.path!, null)
  fs.mkdirSync(dir, { recursive: true })
  const backups = new Map<string, string | null>()
  try {
    for (const [relative, raw] of writes) {
      const file = path.join(workspace, relative)
      backups.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)
      if (raw === null) fs.unlinkSync(file)
      else {
        const temporary = `${file}.tmp-${process.pid}`
        try { fs.writeFileSync(temporary, raw, { flag: 'wx' }); fs.renameSync(temporary, file) }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
      }
    }
    commit()
  } catch (error) {
    for (const [file, raw] of backups) {
      if (raw === null) fs.rmSync(file, { force: true })
      else fs.writeFileSync(file, raw)
    }
    throw error
  }
}
