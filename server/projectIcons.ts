import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, readJsonRecord, writeFileAtomic } from './dataDir.ts'
import { listProjects, projectRoot, WORKSPACE_ROOT } from './paths.ts'
import { normalizeIconValue } from './svgIcon.ts'

const LEGACY_FILE = path.join(DATA_DIR, 'project-icons.json')

function iconFile(root: string, create = false): string {
  if (!path.isAbsolute(root) || !fs.statSync(root).isDirectory()) throw new Error('프로젝트 폴더가 필요합니다')
  const directory = path.join(root, '.mew')
  if (create) fs.mkdirSync(directory, { recursive: true })
  try {
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('.mew는 실제 폴더여야 합니다')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const file = path.join(directory, 'project-icon.json')
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error('아이콘은 실제 파일이어야 합니다')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return file
}

/** The project file is authoritative, including an explicit reset (null). */
export function readProjectIcon(root: string, fallback?: string): string | null {
  try {
    const file = iconFile(root)
    const record = readJsonRecord<unknown>(file)
    if (record) return typeof record.icon === 'string' ? normalizeIconValue(record.icon) || null : null
    // Legacy names were scoped to the active parent's sidebar. Never guess by basename elsewhere.
    const name = path.basename(root)
    const legacy = path.dirname(root) === WORKSPACE_ROOT ? readJsonRecord<string>(LEGACY_FILE) : null
    const value = legacy?.[name] ?? fallback
    if (!value) return null
    const icon = writeProjectIcon(root, value)
    if (legacy && name in legacy) {
      delete legacy[name]
      writeFileAtomic(LEGACY_FILE, `${JSON.stringify(legacy, null, 2)}\n`, 0o644)
    }
    return icon
  } catch { return null } // A broken/unavailable project must not break the project list.
}

export function writeProjectIcon(root: string, value: string | null): string | null {
  const icon = value ? normalizeIconValue(value) || null : null
  const file = iconFile(root, true)
  readJsonRecord(file) // Preserve corrupt data; do not silently overwrite it.
  writeFileAtomic(file, `${JSON.stringify({ icon }, null, 2)}\n`, 0o644)
  return icon
}

export function readProjectIcons(): Record<string, string> {
  return Object.fromEntries(listProjects().flatMap(name => {
    const icon = readProjectIcon(projectRoot(name))
    return icon ? [[name, icon]] : []
  }))
}

export function setProjectIcon(project: string, icon: string | null): void {
  writeProjectIcon(projectRoot(project), icon)
}

export function readRootProjectIcons(paths: unknown, fallback: Record<string, string> = {}): Record<string, string> {
  if (!Array.isArray(paths) || paths.length > 100
    || paths.some(root => typeof root !== 'string' || root.length > 4096 || !path.isAbsolute(root))) {
    throw new Error('프로젝트 경로 목록이 올바르지 않습니다')
  }
  return Object.fromEntries(paths.flatMap(root => {
    const icon = readProjectIcon(root, fallback[root])
    return icon ? [[root, icon]] : []
  }))
}
