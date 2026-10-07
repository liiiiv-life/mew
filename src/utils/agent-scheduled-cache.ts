import { remoteStorageName } from '@mew/ui/browser-storage-scope'
import type { AgentScheduledPrompt } from '../api/client.ts'

const DB_NAME = 'mew-agent-scheduled-prompts'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const MAX_BYTES = 4 * 1024 * 1024
type Snapshot = { key: string; jobs: AgentScheduledPrompt[]; savedAt: number; bytes: number }
let opened: Promise<IDBDatabase> | undefined
let openedName = ''

function open(): Promise<IDBDatabase> {
  const name = remoteStorageName(DB_NAME)
  if (opened && openedName === name) return opened
  void opened?.then(db => db.close()).catch(() => {})
  openedName = name
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('lists', { keyPath: 'key' }) }
    request.onerror = () => { if (opened === opening) opened = undefined; reject(request.error) }
    request.onblocked = () => { if (opened === opening) opened = undefined; reject(new Error('예약 저장소 업그레이드 대기')) }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); if (opened === opening) opened = undefined }
      resolve(db)
    }
  })
  opened = opening
  return opening
}

export async function readScheduledCache(key: string): Promise<AgentScheduledPrompt[] | null> {
  try {
    const db = await open()
    return await new Promise(resolve => {
      const tx = db.transaction('lists', 'readonly')
      const request = tx.objectStore('lists').get(key)
      let result: AgentScheduledPrompt[] | null = null
      request.onsuccess = () => {
        const snapshot = request.result as Snapshot | undefined
        if (!snapshot || !Number.isFinite(snapshot.savedAt) || Date.now() - snapshot.savedAt > MAX_AGE
          || !Array.isArray(snapshot.jobs)) return
        const [, runtime, tab, cwd] = JSON.parse(key) as string[]
        if (snapshot.jobs.some(job => !job || typeof job.id !== 'string' || typeof job.text !== 'string'
          || job.runtime !== runtime || job.tab !== tab || job.cwd !== cwd
          || !Number.isFinite(Date.parse(job.at)) || !Number.isFinite(Date.parse(job.createdAt)))) return
        result = snapshot.jobs
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => resolve(null)
    })
  } catch { return null }
}

/** Display cache only: storage failures never cancel or prevent server reservations. */
export async function writeScheduledCache(key: string, jobs: AgentScheduledPrompt[]): Promise<void> {
  try {
    // Keep only display fields, never session IDs or skill payloads returned by the server.
    const value = jobs.map(({ id, runtime, tab, cwd, text, at, createdAt }) => ({ id, runtime, tab, cwd, text, at, createdAt }))
    const bytes = JSON.stringify(value).length * 2
    const db = await open()
    await new Promise<void>(resolve => {
      const tx = db.transaction('lists', 'readwrite')
      const store = tx.objectStore('lists')
      const request = store.getAll()
      request.onsuccess = () => {
        try {
          if (bytes > MAX_BYTES) { store.delete(key); return }
          let total = bytes, count = 1
          for (const item of (request.result as Snapshot[]).filter(item => item.key !== key).sort((a, b) => b.savedAt - a.savedAt)) {
            if (Date.now() - item.savedAt > MAX_AGE || total + item.bytes > MAX_BYTES || count >= 128) store.delete(item.key)
            else { total += item.bytes; count++ }
          }
          store.put({ key, jobs: value, savedAt: Date.now(), bytes } satisfies Snapshot)
        } catch { tx.abort() }
      }
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
    })
  } catch { /* quota/private mode: the server remains authoritative */ }
}
