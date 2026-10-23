import fs from 'node:fs'
import path from 'node:path'
import { isDbConfigured, exec } from './pool.ts'
import { getView } from './databaseService.ts'
import { projectRoot, resolveProjectPath } from '../paths.ts'
import { withRowPageDraft, RowPageError, hasDatabasePageBinding } from './rowPages.ts'
import type { DocumentPageMove } from '../../shared/document-pages.ts'
import { remapPagePath } from '../../shared/document-pages.ts'

function canonicalPath(project: string, relative: string): string {
  const file = resolveProjectPath(project, relative), root = fs.realpathSync(projectRoot(project))
  let ancestor = file
  const suffix: string[] = []
  while (!fs.existsSync(ancestor)) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor) }
  const canonical = path.join(fs.realpathSync(ancestor), ...suffix)
  const normalized = path.relative(root, canonical).split(path.sep).join('/')
  if (normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized)) throw new RowPageError('프로젝트 밖의 데이터베이스 페이지에는 연결할 수 없습니다', 403)
  return normalized
}

async function boundDatabase(project: string, relative: string): Promise<string | null> {
  if (!isDbConfigured() || !/\.md$/i.test(relative)) return null
  relative = canonicalPath(project, relative)
  if (!(await exec("SELECT to_regclass('mew.row_pages') AS name")).rows[0]?.name) return null
  const { rows } = await exec<{ database_id: string }>(`SELECT p.database_id FROM mew.row_pages p
    JOIN mew.databases d ON d.id = p.database_id WHERE d.project = $1 AND p.path = $2
    AND (SELECT type FROM mew.columns WHERE database_id = d.id ORDER BY position, created_at LIMIT 1) = 'page'`, [project, relative])
  return rows[0]?.database_id ?? null
}

/** Autosaves validate the complete shared row before any submitted file is written. */
export async function saveDatabaseRowPage(project: string, relative: string, content: string, expected?: string, allowed = true): Promise<string | null> {
  // Ordinary Markdown saves remain independent of an optional or unavailable Postgres.
  if (!/\.md$/i.test(relative)) return null
  let previous = ''
  const file = resolveProjectPath(project, relative)
  try { previous = fs.readFileSync(file, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (![content, expected ?? '', previous].some(hasDatabasePageBinding) && !/[0-9a-f-]{36}\.md$/i.test(relative)) return null
  relative = canonicalPath(project, relative)
  const id = await boundDatabase(project, relative)
  if (!id) return null
  if (!allowed) throw new RowPageError('연결된 데이터베이스를 변경할 권한이 없습니다', 403)
  await withRowPageDraft(project, relative, content, () => getView(project, id), expected)
  return fs.readFileSync(resolveProjectPath(project, relative), 'utf8')
}

/** Tree watcher calls this after external file writes; failures retain the original file. */
export async function refreshDatabaseRowPages(project: string, paths: readonly string[]): Promise<void> {
  if (!isDbConfigured()) return
  const ids = new Set<string>()
  for (const relative of paths) {
    if (!/\.md$/i.test(relative)) continue
    let content: string
    try { content = fs.readFileSync(resolveProjectPath(project, relative), 'utf8') } catch { continue }
    if (!hasDatabasePageBinding(content)) continue
    try {
      const id = await boundDatabase(project, relative)
      if (id) ids.add(id)
    } catch { /* Optional DB outages must not break the file tree. */ }
  }
  for (const id of ids) {
    try { await getView(project, id) }
    catch (error) { console.error('[mew] database page sync:', (error as Error).message) }
  }
}

export async function remapDatabaseRowPages(project: string, moves: DocumentPageMove[]): Promise<void> {
  if (!isDbConfigured() || !moves.length) return
  // Only row-page moves need DB metadata. Ordinary document operations still work
  // when an optional Postgres connection is unavailable.
  let containsPage = false
  for (const move of moves) {
    const inspect = (relative: string): void => {
      const absolute = resolveProjectPath(project, relative)
      if (!fs.existsSync(absolute)) return
      const stat = fs.lstatSync(absolute)
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
          if (!entry.name.startsWith('.') && !entry.isSymbolicLink()) inspect(`${relative}/${entry.name}`)
        }
      } else if (stat.isFile() && /\.md$/i.test(relative)) {
        const content = fs.readFileSync(absolute, 'utf8')
        if (hasDatabasePageBinding(content) || /data-mew-db=/.test(content)) containsPage = true
      }
    }
    inspect(move.to)
  }
  if (!containsPage) return
  try {
    if (!(await exec("SELECT to_regclass('mew.row_pages') AS name")).rows[0]?.name) return
    const records = await exec<{ database_id: string; row_id: string; path: string }>(`SELECT p.database_id, p.row_id, p.path FROM mew.row_pages p
      JOIN mew.databases d ON d.id = p.database_id WHERE d.project = $1`, [project])
    for (const record of records.rows) {
      const updated = remapPagePath(record.path, moves)
      if (updated !== record.path) await exec('UPDATE mew.row_pages SET path = $1 WHERE database_id = $2 AND row_id = $3', [updated, record.database_id, record.row_id])
    }
    const databases = await exec<{ id: string; owner_path: string | null }>('SELECT id, owner_path FROM mew.databases WHERE project = $1 AND owner_path IS NOT NULL', [project])
    for (const db of databases.rows) {
      const updated = remapPagePath(db.owner_path!, moves)
      if (updated !== db.owner_path) await exec('UPDATE mew.databases SET owner_path = $1 WHERE id = $2', [updated, db.id])
    }
  } catch { /* Missing bindings are recovered by their immutable frontmatter IDs on the next read. */ }
}
