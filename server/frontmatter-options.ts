import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeFileAtomic } from './dataDir.ts'
import { projectRoot } from './paths.ts'
import { safeProjectPath } from './project-agent-settings.ts'

export class FrontmatterOptionsError extends Error {}
const storagePath = (project: string) => safeProjectPath(projectRoot(project), '.mew/frontmatter-options.json')
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)

function fieldName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new FrontmatterOptionsError('필드명을 확인하세요')
  return value.trim()
}
function options(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 500)) {
    throw new FrontmatterOptionsError('선택 항목은 500개까지, 이름은 500자까지 저장할 수 있습니다')
  }
  return [...new Set(value.map(v => v.trim()))]
}
function load(project: string): Record<string, string[]> {
  const stored = readJsonFile<{ version: number; fields: Record<string, unknown> }>(storagePath(project))
  if (stored === null) return {}
  if (stored.version !== 1 || !stored.fields || typeof stored.fields !== 'object' || Array.isArray(stored.fields)) {
    throw new FrontmatterOptionsError('선택 항목 저장 형식이 올바르지 않습니다')
  }
  return Object.fromEntries(Object.entries(stored.fields).map(([key, values]) => [fieldName(key), options(values)]))
}

export function readFrontmatterOptions(project: string, field: unknown): string[] | null {
  const key = fieldName(field), fields = load(project)
  return own(fields, key) ? fields[key] : null
}

/** Apply deltas to the current list so simultaneous editors do not overwrite each other. */
export function updateFrontmatterOptions(project: string, field: unknown, change: { add?: unknown; remove?: unknown; seed?: unknown }): string[] {
  const key = fieldName(field), fields = load(project)
  const add = options(change.add ?? []), remove = options(change.remove ?? []), seed = options(change.seed ?? [])
  const previous = own(fields, key) ? fields[key] : seed
  const next = options([...new Set([...previous, ...add])].filter(value => !remove.includes(value)))
  if (!own(fields, key) && Object.keys(fields).length >= 500) throw new FrontmatterOptionsError('공유 선택 필드가 너무 많습니다')
  const file = storagePath(project)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomic(file, `${JSON.stringify({ version: 1, fields: { ...fields, [key]: next } }, null, 2)}\n`)
  return next
}
