import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { DATA_DIR } from './dataDir.ts'
import { projectRoot, resolveProjectPath, workspacePaths } from './paths.ts'
import { DOWNLOAD_EXTENSIONS, isPathVisible, MEDIA_EXTENSIONS } from './tree.ts'
import { subscribeFileCatalog, type CatalogUpdate } from './fileCatalog.ts'
import { measure, measureSync } from './perfMarks.ts'

export type SearchIndexState = 'ready' | 'building' | 'stale' | 'disabled'

type ProjectState = {
  state: SearchIndexState
  build: Promise<void> | null
  queue: Promise<void>
  dirty: Set<string>
}

const SCHEMA_VERSION = 1
const states = new Map<string, ProjectState>()
const databases = new Map<string, DatabaseSync>()
let generation = 0

function enabled(): boolean {
  return process.env.MEW_SEARCH_INDEX_ENABLED !== '0'
}

function projectState(project: string): ProjectState {
  const key = projectRoot(project)
  let state = states.get(key)
  if (!state) {
    state = { state: enabled() ? 'building' : 'disabled', build: null, queue: Promise.resolve(), dirty: new Set() }
    states.set(key, state)
  }
  return state
}

function dbPath(): string {
  const hash = crypto.createHash('sha256').update(workspacePaths.root).digest('hex').slice(0, 20)
  return path.join(DATA_DIR, 'search', hash, 'catalog.sqlite')
}

export function searchIndexDatabasePath(): string {
  return dbPath()
}

function initializeDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(file)
  try {
    try { fs.chmodSync(file, 0o600) } catch { /* chmod가 없는 플랫폼은 상위 0700 디렉터리에 의존한다 */ }
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS search_files (
        id INTEGER PRIMARY KEY,
        project TEXT NOT NULL,
        path TEXT NOT NULL,
        mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL,
        UNIQUE(project, path)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        body,
        tokenize='trigram'
      );
    `)
    const version = db.prepare("SELECT value FROM search_meta WHERE key='schema_version'").get() as { value?: string } | undefined
    if (version && Number(version.value) !== SCHEMA_VERSION) {
      db.exec('DROP TABLE IF EXISTS search_files; DROP TABLE IF EXISTS search_fts;')
      db.exec(`
        CREATE TABLE search_files (
          id INTEGER PRIMARY KEY,
          project TEXT NOT NULL,
          path TEXT NOT NULL,
          mtime_ms REAL NOT NULL,
          size INTEGER NOT NULL,
          UNIQUE(project, path)
        );
        CREATE VIRTUAL TABLE search_fts USING fts5(body, tokenize='trigram');
      `)
    }
    db.prepare("INSERT OR REPLACE INTO search_meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
    return db
  } catch (error) {
    try { db.close() } catch { /* 이미 닫힘 */ }
    throw error
  }
}

function discardDatabase(file: string) {
  try { databases.get(file)?.close() } catch { /* damaged handle */ }
  databases.delete(file)
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${file}${suffix}`, { force: true }) } catch { /* 파생 캐시는 다음 재구축에서 다시 시도 */ }
  }
}

function openDatabase(): DatabaseSync {
  const file = dbPath()
  const existing = databases.get(file)
  if (existing) return existing
  let database: DatabaseSync
  try {
    database = initializeDatabase(file)
  } catch {
    discardDatabase(file)
    database = initializeDatabase(file)
  }
  databases.set(file, database)
  return database
}

function removePrefix(db: DatabaseSync, project: string, prefix: string) {
  // LIKE 와일드카드를 쓰지 않는다. `prefix/` 이상 `prefix0` 미만 범위가 정확히 그 하위 경로이며,
  // UNIQUE(project, path) 인덱스를 타므로 `%`·`_`가 든 파일명도 안전하고 전체 표를 훑지 않는다.
  const lower = `${prefix}/`
  const upper = `${prefix}0`
  const rows = db.prepare(`
    SELECT id FROM search_files
    WHERE project=? AND (path=? OR (path>=? AND path<?))
  `).all(project, prefix, lower, upper) as Array<{ id: number }>
  const removeFts = db.prepare('DELETE FROM search_fts WHERE rowid=?')
  const removeFile = db.prepare('DELETE FROM search_files WHERE id=?')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of rows) { removeFts.run(row.id); removeFile.run(row.id) }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

type PreparedIndexChange =
  | { kind: 'remove'; path: string }
  | { kind: 'upsert'; path: string; mtimeMs: number; size: number; content: string }

async function prepareIndexChange(
  project: string,
  relPath: string,
  indexGeneration: number,
): Promise<PreparedIndexChange | null> {
  if (indexGeneration !== generation) return null
  if (!isPathVisible(project, relPath, { type: 'file' })) {
    return { kind: 'remove', path: relPath }
  }
  const ext = path.extname(relPath).toLowerCase()
  if (MEDIA_EXTENSIONS.has(ext) || DOWNLOAD_EXTENSIONS.has(ext)) {
    return { kind: 'remove', path: relPath }
  }
  try {
    const absolutePath = resolveProjectPath(project, relPath)
    const stat = await fs.promises.stat(absolutePath)
    if (indexGeneration !== generation) return null
    if (!stat.isFile()) return { kind: 'remove', path: relPath }
    const db = openDatabase()
    const existing = db.prepare('SELECT mtime_ms, size FROM search_files WHERE project=? AND path=?').get(project, relPath) as { mtime_ms: number; size: number } | undefined
    if (existing && existing.mtime_ms === stat.mtimeMs && existing.size === stat.size) return null
    const content = await fs.promises.readFile(absolutePath, 'utf8')
    if (indexGeneration !== generation) return null
    if (content.includes('\u0000')) return { kind: 'remove', path: relPath }
    return { kind: 'upsert', path: relPath, mtimeMs: stat.mtimeMs, size: stat.size, content }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && indexGeneration === generation) {
      return { kind: 'remove', path: relPath }
    }
    throw error
  }
}

function applyIndexChanges(db: DatabaseSync, project: string, changes: PreparedIndexChange[]) {
  if (!changes.length) return
  const select = db.prepare('SELECT id FROM search_files WHERE project=? AND path=?')
  const removeFts = db.prepare('DELETE FROM search_fts WHERE rowid=?')
  const removeFile = db.prepare('DELETE FROM search_files WHERE id=?')
  const updateFile = db.prepare('UPDATE search_files SET mtime_ms=?, size=? WHERE id=?')
  const insertFile = db.prepare('INSERT INTO search_files(project, path, mtime_ms, size) VALUES (?, ?, ?, ?)')
  const insertFts = db.prepare('INSERT INTO search_fts(rowid, body) VALUES (?, ?)')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const change of changes) {
      const existing = select.get(project, change.path) as { id: number } | undefined
      if (change.kind === 'remove') {
        if (existing) { removeFts.run(existing.id); removeFile.run(existing.id) }
        continue
      }
      let id = existing?.id
      if (id) {
        removeFts.run(id)
        updateFile.run(change.mtimeMs, change.size, id)
      } else {
        id = Number(insertFile.run(project, change.path, change.mtimeMs, change.size).lastInsertRowid)
      }
      insertFts.run(id, change.content)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function indexPaths(
  project: string,
  paths: string[],
  indexGeneration: number,
  onProcessed: (relPath: string) => void,
): Promise<void> {
  const batchSize = 128
  for (let offset = 0; offset < paths.length; offset += batchSize) {
    if (indexGeneration !== generation) return
    const source = paths.slice(offset, offset + batchSize)
    const changes: PreparedIndexChange[] = []
    for (const relPath of source) {
      const change = await prepareIndexChange(project, relPath, indexGeneration)
      if (indexGeneration !== generation) return
      if (change) changes.push(change)
    }
    applyIndexChanges(openDatabase(), project, changes)
    for (const relPath of source) onProcessed(relPath)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function rebuild(project: string, paths: string[], buildGeneration: number): Promise<void> {
  const state = projectState(project)
  state.state = 'building'
  try {
    await measure('search-index.rebuild', { files: paths.length }, async () => {
      if (buildGeneration !== generation) return
      const db = openDatabase()
      const wanted = new Set(paths.filter((relPath) => isPathVisible(project, relPath, { type: 'file' })))
      const stored = db.prepare('SELECT path FROM search_files WHERE project=?').all(project) as Array<{ path: string }>
      applyIndexChanges(db, project, stored
        .filter((row) => !wanted.has(row.path))
        .map((row) => ({ kind: 'remove', path: row.path })))
      await indexPaths(project, paths, buildGeneration, (relPath) => state.dirty.delete(relPath))
    })
    if (buildGeneration !== generation) return
    await indexPaths(project, [...state.dirty], buildGeneration, (relPath) => state.dirty.delete(relPath))
    if (buildGeneration !== generation) return
    state.state = 'ready'
  } catch (error) {
    if (buildGeneration === generation) {
      state.state = 'stale'
      console.error('[mew] exact search index rebuild failed; scanner fallback remains active:', error)
    }
  } finally {
    if (buildGeneration === generation) state.build = null
  }
}

export function ensureSearchIndex(project: string, paths: string[]): SearchIndexState {
  if (!enabled()) return 'disabled'
  const state = projectState(project)
  if (!state.build && state.state !== 'ready') state.build = rebuild(project, paths, generation)
  return state.state
}

function queueIndex(project: string, paths: string[]) {
  if (!enabled() || paths.length === 0) return
  const state = projectState(project)
  const queueGeneration = generation
  for (const relPath of paths) state.dirty.add(relPath)
  state.queue = state.queue.then(async () => {
    if (queueGeneration !== generation || state.state !== 'ready') return
    try { await indexPaths(project, paths, queueGeneration, (relPath) => state.dirty.delete(relPath)) }
    catch (error) { state.state = 'stale'; console.error('[mew] exact search index update failed:', error) }
  })
}

function onCatalogUpdate(update: CatalogUpdate) {
  if (!enabled()) return
  const state = projectState(update.project)
  if (update.version === 1 && update.changedPaths.length > 0 && state.state !== 'ready' && !state.build) {
    state.build = rebuild(update.project, update.changedPaths, generation)
    return
  }
  if (update.removedPaths.length) {
    const queueGeneration = generation
    state.queue = state.queue.then(async () => {
      if (queueGeneration !== generation) return
      const db = openDatabase()
      for (const removed of update.removedPaths) removePrefix(db, update.project, removed)
    })
  }
  queueIndex(update.project, update.changedPaths)
}

subscribeFileCatalog(onCatalogUpdate)

function quoteFts(input: string): string {
  return `"${input.replaceAll('"', '""')}"`
}

export function exactSearchCandidates(project: string, query: string, allowedPaths?: ReadonlySet<string>): {
  state: SearchIndexState
  paths: string[] | null
  dirtyPaths: string[]
} {
  if (!enabled()) return { state: 'disabled', paths: null, dirtyPaths: [] }
  const state = projectState(project)
  if (query.length < 3 || state.state !== 'ready') {
    return { state: enabled() ? state.state : 'disabled', paths: null, dirtyPaths: [...state.dirty] }
  }
  try {
    const rows = measureSync('search-index.query', {}, () => {
      const selected: string[] = []
      const iterator = openDatabase().prepare(`
        SELECT f.path AS path
        FROM search_fts s
        JOIN search_files f ON f.id = s.rowid
        WHERE search_fts MATCH ? AND f.project = ?
      `).iterate(quoteFts(query), project) as Iterable<{ path: string }>
      // scanner 자체의 4천 파일 상한보다 하나 더 모아 truncated 여부를 보존한다. scope 필터는
      // LIMIT 뒤가 아니라 여기서 먼저 적용해야 다른 scope의 대량 매치가 선택 scope를 밀어내지 않는다.
      for (const row of iterator) {
        if (allowedPaths && !allowedPaths.has(row.path)) continue
        selected.push(row.path)
        if (selected.length > 4_000) break
      }
      return selected
    })
    return { state: 'ready', paths: rows, dirtyPaths: [...state.dirty] }
  } catch (error) {
    state.state = 'stale'
    console.error('[mew] exact search index query failed; scanner fallback remains active:', error)
    return { state: 'stale', paths: null, dirtyPaths: [...state.dirty] }
  }
}

export async function waitForSearchIndex(project: string): Promise<SearchIndexState> {
  const state = projectState(project)
  await state.build
  await state.queue
  return state.state
}

export function resetSearchIndex(): void {
  generation += 1
  states.clear()
  for (const database of databases.values()) database.close()
  databases.clear()
}
