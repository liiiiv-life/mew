import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Connection, Table } from '@lancedb/lancedb'
import { DATA_DIR } from '../dataDir.ts'
import { WORKSPACE_ROOT, DOCS_ROOT, projectRoot } from '../paths.ts'
import { chunkText, passageText } from './chunking.ts'
import { LocalE5Embeddings } from './embeddings.ts'
import { docsTierMap, tierForFile } from './tiers.ts'
import { ragEnabled } from './settings.ts'
import { withRagLock } from './lock.ts'
import type { RagDocument } from '../../shared/rag.ts'
export { ragEnabled } from './settings.ts'
import type { EmbeddedChunk, EmbeddingProvider, RagMatch, RagSearchResponse, RagStatus } from './types.ts'

const SCHEMA_VERSION = 2
const TABLE = 'chunks'
const MAX_FILES = 4_000
const MAX_FILE_BYTES = Number(process.env.MEW_RAG_MAX_FILE_BYTES ?? 1_000_000)
const BATCH_SIZE = 16
const QUERY_CANDIDATES = 100

interface FileManifest {
  size: number
  mtimeMs: number
  fingerprint: string
  chunks: number
}

interface ProjectManifest {
  files: Record<string, FileManifest>
  chunks: number
}

interface Manifest {
  schema: number
  model: string
  projects: Record<string, ProjectManifest>
}

interface PreparedFile {
  path: string
  stat: fs.Stats
  fingerprint: string
  chunks: ReturnType<typeof chunkText>
}

interface LanceRow extends EmbeddedChunk {
  _distance?: number
}

export class RagDisabledError extends Error {}
export class RagUnavailableError extends Error {}

function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function workspaceKey(root: string): string {
  return crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 20)
}

function sha(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function emptyManifest(model: string): Manifest {
  return { schema: SCHEMA_VERSION, model, projects: {} }
}

function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function lexicalTokens(value: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}_-]+/gu)) {
    const word = match[0]
    tokens.add(word)
    if (word.length >= 3) {
      for (let i = 0; i < word.length - 1; i++) tokens.add(word.slice(i, i + 2))
    }
  }
  return tokens
}

function lexicalScore(query: Set<string>, row: LanceRow): number {
  if (!query.size) return 0
  const haystack = lexicalTokens(`${row.path}\n${row.title}\n${row.heading}\n${row.content}`)
  let overlap = 0
  for (const token of query) if (haystack.has(token)) overlap++
  return overlap / query.size
}

function revealText(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 80) ?? ''
}

export class RagIndex {
  private readonly root: string
  private readonly dir: string
  private readonly manifestFile: string
  private readonly embedding: EmbeddingProvider
  private readonly resolveRoot: (project: string) => string
  private connectionPromise: Promise<Connection> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    root: string,
    embedding: EmbeddingProvider,
    dataDir = DATA_DIR,
    resolveRoot?: (project: string) => string,
  ) {
    this.root = path.resolve(root)
    this.embedding = embedding
    this.resolveRoot = resolveRoot ?? ((project) => {
      if (project === 'docs') {
        const selected = process.env.MEW_DOCS || (fs.existsSync(path.join(this.root, '.mew/docs')) ? '.mew/docs' : 'docs')
        return path.join(this.root, selected)
      }
      return project === '.workspace' ? this.root : path.join(this.root, project)
    })
    this.dir = path.join(dataDir, 'rag', 'indexes', workspaceKey(this.root))
    this.manifestFile = path.join(this.dir, 'manifest.json')
  }

  private async connection(): Promise<Connection> {
    if (!this.connectionPromise) {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      this.connectionPromise = import('@lancedb/lancedb').then(({ connect }) => connect(path.join(this.dir, 'lance')))
    }
    return this.connectionPromise
  }

  private readManifest(): Manifest {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.manifestFile, 'utf-8')) as Manifest
      if (typeof parsed.schema === 'number' && typeof parsed.model === 'string' && parsed.projects) return parsed
    } catch {
      // 파생 캐시다. 없거나 깨졌으면 원문에서 다시 만든다.
    }
    return { schema: 0, model: '', projects: {} }
  }

  private async tableIfExists(): Promise<Table | null> {
    const db = await this.connection()
    return (await db.tableNames()).includes(TABLE) ? db.openTable(TABLE) : null
  }

  private async resetIfSchemaChanged(manifest: Manifest): Promise<Manifest> {
    if (manifest.schema === SCHEMA_VERSION && manifest.model === this.embedding.id) return manifest
    const db = await this.connection()
    if ((await db.tableNames()).includes(TABLE)) await db.dropTable(TABLE)
    return emptyManifest(this.embedding.id)
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = () => withRagLock(this.dir, task)
    const next = this.queue.then(run, run)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  private async embedAll(chunks: PreparedFile[]): Promise<Map<string, EmbeddedChunk[]>> {
    const flat = chunks.flatMap((file) => file.chunks.map((chunk) => ({ file, chunk })))
    const vectors: number[][] = []
    for (let start = 0; start < flat.length; start += BATCH_SIZE) {
      const batch = flat.slice(start, start + BATCH_SIZE)
      vectors.push(...(await this.embedding.embedPassages(batch.map(({ chunk }) => passageText(chunk)))))
    }
    if (vectors.length !== flat.length) throw new RagUnavailableError('임베딩 결과 수가 청크 수와 다릅니다')

    const grouped = new Map<string, EmbeddedChunk[]>()
    flat.forEach(({ file, chunk }, i) => {
      const row: EmbeddedChunk = {
        ...chunk,
        id: sha(`${file.path}:${file.fingerprint}:${chunk.index}`),
        project: '',
        path: file.path,
        fingerprint: file.fingerprint,
        vector: vectors[i],
      }
      const rows = grouped.get(file.path) ?? []
      rows.push(row)
      grouped.set(file.path, rows)
    })
    return grouped
  }

  async ensureProject(project: string, relPaths: string[], force = false): Promise<{ files: number; chunks: number; updated: number }> {
    return this.serialize(() => this.updateProject(project, relPaths, force))
  }

  private async updateProject(project: string, relPaths: string[], force: boolean) {
    let manifest = await this.resetIfSchemaChanged(this.readManifest())
    let table = await this.tableIfExists()
    const previous = manifest.projects[project] ?? { files: {}, chunks: 0 }
    if (!table && Object.keys(previous.files).length) force = true

    const root = this.resolveRoot(project)
    const paths = relPaths.slice(0, MAX_FILES)
    const tiers = project === 'docs' ? docsTierMap(root, paths) : new Map()
    const current = new Set(paths)
    const deleted = force ? Object.keys(previous.files) : Object.keys(previous.files).filter((rel) => !current.has(rel))
    const prepared: PreparedFile[] = []
    const nextFiles: Record<string, FileManifest> = force ? {} : { ...previous.files }

    for (const rel of paths) {
      const abs = path.join(root, rel)
      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        if (previous.files[rel]) deleted.push(rel)
        delete nextFiles[rel]
        continue
      }
      const old = previous.files[rel]
      if (!force && old && old.size === stat.size && old.mtimeMs === stat.mtimeMs) continue
      let content: string
      try {
        content = fs.readFileSync(abs, 'utf-8')
      } catch {
        continue
      }
      const fingerprint = sha(content)
      prepared.push({
        path: rel,
        stat,
        fingerprint,
        chunks: chunkText(rel, content, tierForFile(rel, content, tiers.get(rel))),
      })
    }

    let grouped: Map<string, EmbeddedChunk[]>
    try {
      grouped = await this.embedAll(prepared)
    } catch (error) {
      throw new RagUnavailableError(error instanceof Error ? error.message : '로컬 임베딩 모델을 사용할 수 없습니다')
    }

    if (force && table) await table.delete(`project = ${sql(project)}`)

    for (const rel of new Set(deleted)) {
      if (table) await table.delete(`project = ${sql(project)} AND path = ${sql(rel)}`)
      delete nextFiles[rel]
    }

    for (const file of prepared) {
      const rows = (grouped.get(file.path) ?? []).map((row) => ({ ...row, project }))
      if (table) await table.delete(`project = ${sql(project)} AND path = ${sql(file.path)}`)
      if (rows.length) {
        if (table) await table.add(rows)
        else {
          const db = await this.connection()
          table = await db.createTable(TABLE, rows)
        }
      }
      nextFiles[file.path] = {
        size: file.stat.size,
        mtimeMs: file.stat.mtimeMs,
        fingerprint: file.fingerprint,
        chunks: rows.length,
      }
    }

    const projectManifest: ProjectManifest = {
      files: nextFiles,
      chunks: Object.values(nextFiles).reduce((sum, file) => sum + file.chunks, 0),
    }
    manifest.projects[project] = projectManifest
    atomicJson(this.manifestFile, manifest)
    return { files: Object.keys(nextFiles).length, chunks: projectManifest.chunks, updated: prepared.length + deleted.length }
  }

  async search(project: string, relPaths: string[], query: string, includeHistory = false, limit = 12): Promise<RagSearchResponse> {
    return this.serialize(() => this.searchProject(project, relPaths, query, includeHistory, limit))
  }

  private async searchProject(project: string, relPaths: string[], query: string, includeHistory: boolean, limit: number): Promise<RagSearchResponse> {
    const indexed = await this.updateProject(project, relPaths, false)
    const table = await this.tableIfExists()
    if (!table || indexed.chunks === 0) {
      return { results: [], indexedFiles: indexed.files, indexedChunks: 0, updatedFiles: indexed.updated, model: this.embedding.id }
    }

    let queryVector: number[]
    try {
      queryVector = await this.embedding.embedQuery(query)
    } catch (error) {
      throw new RagUnavailableError(error instanceof Error ? error.message : '로컬 임베딩 모델을 사용할 수 없습니다')
    }
    const tierFilter = includeHistory ? '' : ` AND tier = 'current'`
    const rows = (await table
      .vectorSearch(queryVector)
      .where(`project = ${sql(project)}${tierFilter}`)
      .limit(QUERY_CANDIDATES)
      .toArray()) as unknown as LanceRow[]
    const visible = new Set(relPaths)
    const queryTokens = lexicalTokens(query)
    const ranked = rows
      .filter((row) => visible.has(row.path))
      .map((row) => {
        const semantic = 1 / (1 + Math.max(0, Number(row._distance ?? 1)))
        return { row, score: semantic * 0.82 + lexicalScore(queryTokens, row) * 0.18 }
      })
      .sort((a, b) => b.score - a.score)

    const perFile = new Map<string, number>()
    const results: RagMatch[] = []
    for (const { row, score } of ranked) {
      const count = perFile.get(row.path) ?? 0
      if (count >= 2) continue
      perFile.set(row.path, count + 1)
      results.push({
        path: row.path,
        line: Number(row.lineStart),
        lineEnd: Number(row.lineEnd),
        title: row.title,
        heading: row.heading,
        text: row.content.replace(/\s+/g, ' ').trim().slice(0, 500),
        reveal: revealText(row.content),
        tier: row.tier,
        score: Math.round(score * 10_000) / 10_000,
      })
      if (results.length >= limit) break
    }

    return {
      results,
      indexedFiles: indexed.files,
      indexedChunks: indexed.chunks,
      updatedFiles: indexed.updated,
      model: this.embedding.id,
    }
  }

  documents(project: string, visiblePaths: string[]): RagDocument[] {
    const manifest = this.readManifest()
    if (manifest.schema !== SCHEMA_VERSION || manifest.model !== this.embedding.id) return []
    const visible = new Set(visiblePaths)
    return Object.entries(manifest.projects[project]?.files ?? {})
      .filter(([file]) => visible.has(file))
      .map(([file, value]) => ({ path: file, chunks: value.chunks, bytes: value.size, modifiedAt: value.mtimeMs }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  status(project: string): RagStatus {
    const manifest = this.readManifest()
    const valid = manifest.schema === SCHEMA_VERSION && manifest.model === this.embedding.id
    const projectManifest = valid ? manifest.projects[project] : undefined
    return {
      enabled: ragEnabled(),
      engine: 'LanceDB',
      dimensions: this.embedding.dimensions,
      database: `${workspaceKey(this.root)}/${TABLE}`,
      model: this.embedding.id,
      ready: !!projectManifest,
      indexedFiles: projectManifest ? Object.keys(projectManifest.files).length : 0,
      indexedChunks: projectManifest?.chunks ?? 0,
    }
  }
}

const stores = new Map<string, RagIndex>()

export function currentRagIndex(allowDisabled = false): RagIndex {
  if (!allowDisabled && !ragEnabled()) throw new RagDisabledError('RAG가 비활성화되어 있습니다. RAG 공통 설정과 서버 환경 설정을 확인하세요.')
  const key = path.resolve(WORKSPACE_ROOT)
  const cacheKey = `${key}\0${DOCS_ROOT}`
  let store = stores.get(cacheKey)
  if (!store) {
    const docs = projectRoot('docs')
    store = new RagIndex(key, new LocalE5Embeddings(), DATA_DIR, (project) => project === 'docs' ? docs : project === '.workspace' ? key : path.join(key, project))
    stores.set(cacheKey, store)
  }
  return store
}

/** API가 projectRoot 검증을 먼저 하도록 남긴 작은 경계. */
export function validateRagProject(project: string): void {
  projectRoot(project)
}
