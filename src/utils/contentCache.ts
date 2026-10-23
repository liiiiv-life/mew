import { browserCachePersistenceEnabled, remoteStorageName, scopedBrowserStorage, globalBrowserStorage } from '@mew/ui/browser-storage-scope'
import { BROWSER_CACHE_MAX_AGE_MS, BROWSER_CACHE_MAX_BYTES, browserStorageBytes } from '@mew/ui/browser-storage'
import type { FileVersion } from '../../shared/file-version.ts'

const MEM_MAX = 20
const DISK_MAX = 40
const DISK_ENTRIES_MAX = 256
const MAX_CONTENT_LENGTH = 128 * 1024
const MAX_ENTRY_BYTES = 256 * 1024
const PREFIX = 'mew:content:'
const DB_NAME = 'mew-file-content'
const OPEN_TIMEOUT_MS = 250

export interface CachedFile {
  content: string
  editable: boolean
  /** Only a server-confirmed body may retain its revision. Local edits omit it. */
  version?: FileVersion
}

type Context = { database: string; identity: string; workspace: string; epoch: number; storage?: Storage; legacyPrefix: string }
type Meta = { key: string; identity: string; workspace: string; savedAt: number; bytes: number }
const cache = new Map<string, CachedFile>()
const epochs = new Map<string, number>()
const reads = new Map<string, { promise: Promise<CachedFile | undefined> }>()
const writes = new Map<string, { ctx: Context; file: CachedFile }>()
let identity = 'guest'
let workspace = ''
let queued: Promise<void> = Promise.resolve()
let opened: Promise<IDBDatabase> | undefined
let openedName = ''

function context(): Context {
  const database = remoteStorageName(DB_NAME)
  let storage: Storage | undefined
  try { storage = scopedBrowserStorage() } catch { /* disabled storage */ }
  return { database, identity, workspace, epoch: epochs.get(database) ?? 0, storage,
    legacyPrefix: `${PREFIX}${identity}:${workspace ? `${workspace}:` : ''}` }
}
function key(ctx: Context, project: string, path: string) { return JSON.stringify([ctx.identity, ctx.workspace, project, path]) }
function memoryKey(ctx: Context, id: string) { return JSON.stringify([ctx.database, id]) }
function valid(ctx: Context) { return (epochs.get(ctx.database) ?? 0) === ctx.epoch }
function current(ctx: Context) {
  return valid(ctx) && ctx.database === remoteStorageName(DB_NAME) && ctx.identity === identity && ctx.workspace === workspace
}
function remember(id: string, file: CachedFile) {
  cache.delete(id)
  cache.set(id, file)
  while (cache.size > MEM_MAX) cache.delete(cache.keys().next().value!)
}
function clearMemory(database: string, keepIdentity?: string) {
  for (const id of cache.keys()) {
    const [db, fileKey] = JSON.parse(id) as [string, string]
    if (db === database && (!keepIdentity || (JSON.parse(fileKey) as string[])[0] !== keepIdentity)) cache.delete(id)
  }
  for (const id of reads.keys()) if ((JSON.parse(id) as string[])[0] === database) reads.delete(id)
}

/** A task boundary keeps cloning, serialization and legacy localStorage reads off file-open handlers. */
function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
  const result = queued.then(() => new Promise<void>(resolve => setTimeout(resolve, 0))).then(work)
  queued = result.then(() => {}, () => {})
  return result
}
export async function flushContentCache(): Promise<void> {
  let pending: Promise<void>
  do { pending = queued; await pending } while (pending !== queued)
}

function open(name: string): Promise<IDBDatabase> {
  if (opened && openedName === name) return opened
  void opened?.then(db => db.close()).catch(() => {})
  openedName = name
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let expired = false
    const timer = setTimeout(() => { expired = true; reject(new Error('Content cache unavailable')) }, OPEN_TIMEOUT_MS)
    try {
      if (!browserCachePersistenceEnabled()) throw new Error('Persistent browser caches are disabled')
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('files')
        request.result.createObjectStore('metadata', { keyPath: 'key' })
      }
      request.onerror = request.onblocked = () => { expired = true; clearTimeout(timer); reject(request.error ?? new Error('Content cache blocked')) }
      request.onsuccess = () => {
        clearTimeout(timer)
        const db = request.result
        if (expired) { db.close(); return }
        db.onversionchange = () => { db.close(); if (opened === opening) opened = undefined }
        resolve(db)
      }
    } catch (error) { clearTimeout(timer); reject(error) }
  })
  opened = opening
  void opening.catch(() => { if (opened === opening) opened = undefined })
  return opening
}
function expired(meta: Meta, now = Date.now()) {
  return !Number.isFinite(meta.savedAt) || meta.savedAt > now || now - meta.savedAt >= BROWSER_CACHE_MAX_AGE_MS
}
function remove(tx: IDBTransaction, id: string) {
  tx.objectStore('files').delete(id)
  tx.objectStore('metadata').delete(id)
}
function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void, fallback: T): Promise<T> {
  return new Promise(resolve => {
    let value = fallback
    try {
      const tx = db.transaction(['files', 'metadata'], mode)
      tx.oncomplete = () => resolve(value)
      tx.onerror = tx.onabort = () => resolve(fallback)
      work(tx, result => { value = result })
    } catch { resolve(fallback) }
  })
}
function decode(value: unknown): CachedFile | undefined {
  if (!value || typeof value !== 'object' || typeof (value as CachedFile).content !== 'string') return undefined
  const file = value as CachedFile
  const version = file.version && Number.isFinite(file.version.size) && Number.isFinite(file.version.mtimeMs) ? file.version : undefined
  return { content: file.content, editable: file.editable !== false, ...(version ? { version } : {}) }
}
async function writeDisk(ctx: Context, id: string, file: CachedFile, savedAt = Date.now()): Promise<boolean> {
  if (!valid(ctx)) return false
  try {
    const db = await open(ctx.database)
    if (!valid(ctx)) return false
    return await transaction(db, 'readwrite', (tx, result) => {
      const metadata = tx.objectStore('metadata')
      const request = metadata.getAll()
      request.onsuccess = () => {
        try {
          if (!valid(ctx)) return
          const bytes = browserStorageBytes(id, JSON.stringify(file))
          if (file.content.length > MAX_CONTENT_LENGTH || bytes > MAX_ENTRY_BYTES) { remove(tx, id); result(true); return }
          let total = bytes, count = 1, rootCount = 1
          const all = (request.result as Meta[]).filter(meta => meta.key !== id).sort((a, b) => b.savedAt - a.savedAt)
          for (const meta of all) {
            const sameRoot = meta.identity === ctx.identity && meta.workspace === ctx.workspace
            if (expired(meta) || !Number.isFinite(meta.bytes) || total + meta.bytes > BROWSER_CACHE_MAX_BYTES
              || count >= DISK_ENTRIES_MAX || sameRoot && rootCount >= DISK_MAX) remove(tx, meta.key)
            else { total += meta.bytes; count++; if (sameRoot) rootCount++ }
          }
          tx.objectStore('files').put(file, id)
          metadata.put({ key: id, identity: ctx.identity, workspace: ctx.workspace, savedAt, bytes } satisfies Meta)
          result(true)
        } catch { tx.abort() }
      }
    }, false)
  } catch { return false }
}
function legacyRemove(ctx: Context, project: string, path: string) {
  try { ctx.storage?.removeItem(ctx.legacyPrefix + `${project} ${path}`) } catch { /* optional cache */ }
}
function legacyRead(ctx: Context, project: string, path: string): { file: CachedFile; savedAt: number } | undefined {
  try {
    const legacyKey = ctx.legacyPrefix + `${project} ${path}`
    const raw = ctx.storage?.getItem(legacyKey)
    if (!raw) return undefined
    const scopedTimes = JSON.parse(ctx.storage?.getItem('mew:cache-times:v1') ?? '{}') as Record<string, number>
    // Newer maintenance stores physical remote keys in the origin-wide timestamp ledger.
    const physicalPrefix = ctx.database.slice(0, -DB_NAME.length)
    const globalTimes = JSON.parse(globalBrowserStorage().getItem('mew:cache-times:v1') ?? '{}') as Record<string, number>
    const savedAt = globalTimes[physicalPrefix + legacyKey] ?? scopedTimes[legacyKey]
    if (expired({ savedAt } as Meta) || browserStorageBytes(legacyKey, raw) > MAX_ENTRY_BYTES) {
      legacyRemove(ctx, project, path)
      return undefined
    }
    const file = decode(JSON.parse(raw))
    return file ? { file, savedAt } : undefined
  } catch { return undefined }
}
function clearLegacy(ctx: Context, keepIdentity: boolean) {
  try {
    const storage = ctx.storage
    if (!storage) return
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
    for (const id of keys) if (id?.startsWith(PREFIX) && (!keepIdentity || !id.startsWith(`${PREFIX}${ctx.identity}:`))) storage.removeItem(id)
  } catch { /* optional cache */ }
}

/** Memory-only: synchronously opening a file never reads or serializes persistent bodies. */
export function getCachedFile(project: string, path: string): CachedFile | undefined {
  const ctx = context(), id = memoryKey(ctx, key(ctx, project, path))
  const hit = cache.get(id)
  if (hit) remember(id, hit)
  return hit
}

/** Cold restoration is best effort. A concurrent edit, removal, logout or root switch invalidates the result. */
export function loadCachedFile(project: string, path: string): Promise<CachedFile | undefined> {
  const hit = getCachedFile(project, path)
  if (hit) return Promise.resolve(hit)
  const ctx = context(), id = key(ctx, project, path), hotKey = memoryKey(ctx, id)
  const existing = reads.get(hotKey)
  if (existing) return existing.promise
  const pending = { promise: Promise.resolve<CachedFile | undefined>(undefined) }
  pending.promise = enqueue(async () => {
    if (!current(ctx) || reads.get(hotKey) !== pending) return undefined
    let stored: CachedFile | undefined
    let available = false
    try {
      const db = await open(ctx.database)
      available = true
      stored = await transaction<CachedFile | undefined>(db, 'readwrite', (tx, result) => {
        const metaRequest = tx.objectStore('metadata').get(id)
        metaRequest.onsuccess = () => {
          const meta = metaRequest.result as Meta | undefined
          if (!meta || expired(meta)) { if (meta) remove(tx, id); return }
          const fileRequest = tx.objectStore('files').get(id)
          fileRequest.onsuccess = () => result(decode(fileRequest.result))
        }
      }, undefined)
    } catch { /* unavailable IDB: try a bounded legacy cache */ }
    if (!current(ctx) || reads.get(hotKey) !== pending) return undefined
    if (!stored) {
      const legacy = legacyRead(ctx, project, path)
      if (legacy) {
        stored = legacy.file
        if (available && await writeDisk(ctx, id, stored, legacy.savedAt)) legacyRemove(ctx, project, path)
      }
    }
    if (!current(ctx) || reads.get(hotKey) !== pending) return undefined
    if (stored) remember(hotKey, stored)
    return stored
  }).finally(() => { if (reads.get(hotKey) === pending) reads.delete(hotKey) })
  reads.set(hotKey, pending)
  return pending.promise
}

export function putCachedFile(project: string, path: string, file: CachedFile) {
  const ctx = context(), id = key(ctx, project, path), hotKey = memoryKey(ctx, id)
  reads.delete(hotKey)
  const snapshot = { ...file, ...(file.version ? { version: { ...file.version } } : {}) }
  remember(hotKey, snapshot)
  const existing = writes.get(hotKey)
  if (existing && valid(existing.ctx)) { existing.file = snapshot; return }
  const pending = { ctx, file: snapshot }
  writes.set(hotKey, pending)
  void enqueue(async () => {
    if (writes.get(hotKey) !== pending) return
    writes.delete(hotKey)
    if (!valid(ctx)) return
    const latest = pending.file
    const written = await writeDisk(ctx, id, latest)
    // Oversized replacements count as successful removals, including their legacy copy.
    if (written) legacyRemove(ctx, project, path)
  })
}
export function dropCachedFile(project: string, path: string) {
  const ctx = context(), id = key(ctx, project, path), hotKey = memoryKey(ctx, id)
  cache.delete(hotKey)
  reads.delete(hotKey)
  writes.delete(hotKey)
  void enqueue(async () => {
    legacyRemove(ctx, project, path)
    try {
      const db = await open(ctx.database)
      await transaction(db, 'readwrite', tx => remove(tx, id), undefined)
    } catch { /* optional cache */ }
  })
}

/** Clears only this browser account/instance namespace; preferences and drafts remain untouched. */
export function clearPersistedContent(keepScope = false) {
  const ctx = context()
  epochs.set(ctx.database, ctx.epoch + 1)
  clearMemory(ctx.database, keepScope ? ctx.identity : undefined)
  void enqueue(async () => {
    clearLegacy(ctx, keepScope)
    try {
      const db = await open(ctx.database)
      await transaction(db, 'readwrite', tx => {
        const request = tx.objectStore('metadata').getAll()
        request.onsuccess = () => {
          for (const meta of request.result as Meta[]) if (!keepScope || meta.identity !== ctx.identity) remove(tx, meta.key)
        }
      }, undefined)
    } catch { /* optional cache */ }
  })
}
export function clearFileContentCache() { clearPersistedContent() }
export function setContentIdentity(email: string | null) {
  const next = email ?? 'guest'
  if (next === identity) return
  identity = next
  clearPersistedContent(true)
}
/** Root switches retain their own entries in the bounded hot cache. */
export function setContentWorkspace(path: string | null) { workspace = path ?? '' }
