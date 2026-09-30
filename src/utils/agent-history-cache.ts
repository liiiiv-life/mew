import { HistoryIndex } from '../../shared/agent-history.ts'
import type { HistoryPage } from '../../shared/agent-history.ts'
import type { AgentEvent } from './agentFold.ts'

export type CachedHistory = Omit<HistoryPage<AgentEvent>, 'controls' | 'mode'>
type Meta = Omit<CachedHistory, 'events'> & { key: string; tab: string; savedAt: number; bytes: number }
const DB_NAME = 'mew-agent-history'
const MAX_BYTES = 32 * 1024 * 1024
const MAX_ENTRY_BYTES = 4 * 1024 * 1024
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const queues = new Map<string, Promise<void>>()
const pending = new Map<string, { tab: string; value: CachedHistory }>()
let opened: Promise<IDBDatabase> | undefined

export function historyCacheKey(account: string, runtime: string, tab: string, cwd: string) {
  return JSON.stringify([account, runtime, tab, cwd])
}
function open(): Promise<IDBDatabase> {
  if (opened) return opened
  opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'key' })
      request.result.createObjectStore('events', { keyPath: ['key', 'seq'] })
    }
    request.onerror = () => { opened = undefined; reject(request.error) }
    request.onblocked = () => { opened = undefined; reject(new Error('대화 저장소 업그레이드 대기')) }
    request.onsuccess = () => {
      const db = request.result
      const cleanup = db.transaction(['sessions', 'events'], 'readwrite')
      const records = cleanup.objectStore('sessions').getAll()
      records.onsuccess = () => {
        for (const meta of records.result as Meta[]) if (Date.now() - meta.savedAt > MAX_AGE) drop(cleanup, meta.key)
      }
      cleanup.onerror = cleanup.onabort = () => {}
      db.onversionchange = () => { db.close(); opened = undefined }
      resolve(db)
    }
  })
  return opened
}
function rows(key: string, start = 0, end = Number.MAX_SAFE_INTEGER) {
  return IDBKeyRange.bound([key, start], [key, end], false, true)
}
function drop(tx: IDBTransaction, key: string) {
  tx.objectStore('sessions').delete(key)
  tx.objectStore('events').delete(rows(key))
}

/** A failed/evicted cache never changes the server session pointer or the input draft. */
export async function readHistoryCache(key: string): Promise<CachedHistory | null> {
  try {
    const db = await open()
    return await new Promise((resolve) => {
      const tx = db.transaction(['sessions', 'events'], 'readonly')
      let result: CachedHistory | null = null
      const request = tx.objectStore('sessions').get(key)
      request.onsuccess = () => {
        const meta = request.result as Meta | undefined
        if (!meta || typeof meta.generation !== 'string' || typeof meta.sessionId !== 'string'
          || !Number.isSafeInteger(meta.start) || !Number.isSafeInteger(meta.end) || meta.start < 0 || meta.end < meta.start
          || !Number.isFinite(meta.savedAt) || Date.now() - meta.savedAt > MAX_AGE) return
        const records = tx.objectStore('events').getAll(rows(key, meta.start, meta.end))
        records.onsuccess = () => {
          const values = records.result as { seq: number; event: AgentEvent }[]
          if (values.length !== meta.end - meta.start || values.some((row, i) => row.seq !== meta.start + i)) return
          result = { generation: meta.generation, sessionId: meta.sessionId, start: meta.start, end: meta.end,
            total: meta.total, usersBefore: meta.usersBefore, events: values.map(row => row.event) }
        }
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => resolve(null)
    })
  } catch { return null }
}

export function recentHistory(value: CachedHistory): CachedHistory {
  const index = new HistoryIndex<AgentEvent>(value.generation)
  for (const event of value.events) index.push(event)
  const range = index.range()
  return { ...value, start: value.start + range.start, usersBefore: value.usersBefore + range.usersBefore, events: value.events.slice(range.start) }
}

export function writeHistoryCache(key: string, tab: string, input: CachedHistory): Promise<void> {
  const value = recentHistory(input)
  pending.set(key, { tab, value })
  const running = queues.get(key)
  if (running) return running
  const next = Promise.resolve().then(async () => {
    while (pending.has(key)) {
      const { tab, value } = pending.get(key)!
      pending.delete(key)
      try {
        const db = await open()
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['sessions', 'events'], 'readwrite')
          const sessions = tx.objectStore('sessions'), events = tx.objectStore('events')
          const request = sessions.getAll()
          request.onsuccess = () => {
            try {
              const all = request.result as Meta[]
              const old = all.find(meta => meta.key === key)
              const same = old?.generation === value.generation && old.sessionId === value.sessionId
                && old.start === value.start && old.end <= value.end
              let bytes = same ? old.bytes : 0
              if (!same) drop(tx, key)
              for (let seq = same ? old.end : value.start; seq < value.end; seq++) {
                const event = value.events[seq - value.start]
                bytes += JSON.stringify(event).length * 2 + 64
                if (bytes > MAX_ENTRY_BYTES) { drop(tx, key); return }
                events.put({ key, seq, event })
              }
              let total = bytes, count = 1
              for (const meta of all.filter(item => item.key !== key).sort((a, b) => b.savedAt - a.savedAt)) {
                if (Date.now() - meta.savedAt > MAX_AGE || total + meta.bytes > MAX_BYTES || count >= 128) drop(tx, meta.key)
                else { total += meta.bytes; count++ }
              }
              const { events: _events, ...metadata } = value
              sessions.put({ ...metadata, key, tab, bytes, savedAt: Date.now() } satisfies Meta)
            } catch { tx.abort() }
          }
          tx.oncomplete = () => resolve()
          tx.onerror = tx.onabort = () => reject(tx.error)
        })
      } catch { /* best effort: quota/private mode must not stop the conversation */ }
    }
  })
  queues.set(key, next)
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key) })
  return next
}

export async function clearHistoryTab(tab: string, account?: string): Promise<void> {
  // Wait for this document's pending writes so closing a tab cannot resurrect it.
  await Promise.all([...queues.values()])
  try {
    const db = await open()
    await new Promise<void>(resolve => {
      const tx = db.transaction(['sessions', 'events'], 'readwrite')
      const request = tx.objectStore('sessions').getAll()
      request.onsuccess = () => {
        for (const meta of request.result as Meta[]) {
          const ownTab = meta.tab === tab && (account === undefined || meta.key.startsWith(`[${JSON.stringify(account)},`))
          if (ownTab || Date.now() - meta.savedAt > MAX_AGE) drop(tx, meta.key)
        }
      }
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
    })
  } catch { /* unavailable storage */ }
}
