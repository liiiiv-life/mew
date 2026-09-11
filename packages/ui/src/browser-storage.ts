/** Only disposable data belongs here. Drafts, preferences and account-state fallbacks are never evicted. */
const TIMES_KEY = 'mew:cache-times:v1'
export const BROWSER_CACHE_MAX_BYTES = 2 * 1024 * 1024
export const BROWSER_STORAGE_TARGET_BYTES = 4 * 1024 * 1024
export const BROWSER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const BROWSER_CACHE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 256
const METADATA_RESERVE = 64 * 1024

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
type Times = Record<string, number>
export type StorageCleanup = { removed: number; freedBytes: number; remainingBytes: number }
export const browserStorageBytes = (key: string, value: string): number => (key.length + value.length) * 2

function itemLimit(key: string): number | null {
  if (key.startsWith('mew:agent-events:')) return 512 * 1024
  if (key.startsWith('mew:agent-controls:')) return 32 * 1024
  if (key.startsWith('mew:content:')) return key.endsWith('@order') ? 32 * 1024 : 256 * 1024
  if (key.startsWith('mew:tree-children:')) return 256 * 1024
  if (key === 'mew:agent-input-histories' || key === 'mew:tmux-input-histories') return 256 * 1024
  return null
}

function readTimes(storage: Store): Times {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TIMES_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([key, time]) => (
      itemLimit(key) !== null && typeof time === 'number' && Number.isFinite(time)
    )))
  } catch { return {} }
}

function saveTimes(storage: Store, times: Times) {
  try {
    const keys = Object.keys(times).sort((a, b) => times[b] - times[a])
    let bytes = browserStorageBytes(TIMES_KEY, '{}')
    const bounded: Times = {}
    for (const key of keys.slice(0, MAX_ENTRIES)) {
      const size = JSON.stringify([key, times[key]]).length * 2 + 4
      if (bytes + size > METADATA_RESERVE) continue
      bounded[key] = times[key]
      bytes += size
    }
    if (Object.keys(bounded).length) storage.setItem(TIMES_KEY, JSON.stringify(bounded))
    else storage.removeItem(TIMES_KEY)
  } catch {
    // Missing timestamps make the next sweep expire caches; they never justify removing user state.
  }
}

/** Size accounting uses UTF-16 bytes, including keys, across all roots and features. */
export function pruneBrowserStorage(options: {
  storage?: Store; now?: number; reservedBytes?: number; replacingKey?: string; aggressive?: boolean
} = {}): StorageCleanup {
  const result = { removed: 0, freedBytes: 0, remainingBytes: 0 }
  try {
    const storage = options.storage ?? localStorage
    const now = options.now ?? Date.now()
    const times = readTimes(storage)
    const nextTimes: Times = {}
    const caches: Array<{ key: string; bytes: number; time: number }> = []
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => key !== null)
    const remove = (key: string, bytes: number) => {
      storage.removeItem(key)
      result.removed++
      result.freedBytes += bytes
      result.remainingBytes -= bytes
    }
    for (const key of keys) {
      const value = storage.getItem(key)
      if (value === null) continue
      const bytes = browserStorageBytes(key, value)
      result.remainingBytes += bytes
      const limit = itemLimit(key)
      if (limit === null || key === options.replacingKey) continue
      // Old event caches already had savedAt; all other undated legacy caches are disposable.
      let time = times[key]
      if (time === undefined && key.startsWith('mew:agent-events:') && bytes <= limit) {
        try { time = JSON.parse(value)?.savedAt } catch { /* invalid cache */ }
      }
      if (options.aggressive || bytes > limit || !Number.isFinite(time) || time > now || now - time >= BROWSER_CACHE_MAX_AGE_MS) {
        remove(key, bytes)
      } else caches.push({ key, bytes, time })
    }
    caches.sort((a, b) => b.time - a.time || a.key.localeCompare(b.key))
    let cacheBytes = options.reservedBytes ?? 0
    let count = options.replacingKey ? 1 : 0
    // Oldest entries go first if settings/other apps already occupy most of the origin.
    let projectedBytes = result.remainingBytes + (options.reservedBytes ?? 0) + METADATA_RESERVE
    if (options.replacingKey) {
      const previous = storage.getItem(options.replacingKey)
      if (previous !== null) projectedBytes -= browserStorageBytes(options.replacingKey, previous)
    }
    while (caches.length && projectedBytes > BROWSER_STORAGE_TARGET_BYTES) {
      const old = caches.pop()!
      remove(old.key, old.bytes)
      projectedBytes -= old.bytes
    }
    for (const entry of caches) {
      if (count >= MAX_ENTRIES || cacheBytes + entry.bytes > BROWSER_CACHE_MAX_BYTES) remove(entry.key, entry.bytes)
      else {
        cacheBytes += entry.bytes
        count++
        nextTimes[entry.key] = entry.time
      }
    }
    if (options.replacingKey && times[options.replacingKey] !== undefined) nextTimes[options.replacingKey] = times[options.replacingKey]
    saveTimes(storage, nextTimes)
    result.remainingBytes = 0
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key) result.remainingBytes += browserStorageBytes(key, storage.getItem(key) ?? '')
    }
  } catch {
    // Disabled storage must not stop rendering or background work.
  }
  return result
}

/** Sent inputs are a convenience history, not drafts. Keep whole recent entries within 128KiB. */
export function trimInputHistory(histories: Record<string, string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  let remaining = 128 * 1024 - 4
  for (const [id, items] of Object.entries(histories).reverse()) {
    const kept: string[] = []
    let cost = (JSON.stringify(id).length + 4) * 2
    for (const text of items.slice(-100).reverse()) {
      const size = (JSON.stringify(text).length + 1) * 2
      if (size > 16 * 1024 || cost + size > remaining) continue
      kept.push(text)
      cost += size
    }
    if (kept.length) {
      result[id] = kept.reverse()
      remaining -= cost
    }
  }
  return Object.fromEntries(Object.entries(result).reverse())
}

/** Ordinary state is retained. On failure, reclaim only known caches and retry once. */
export function writeBrowserStorage(key: string, value: string): boolean {
  try {
    const storage = localStorage
    const limit = itemLimit(key)
    if (limit !== null) {
      if (browserStorageBytes(key, value) > limit) {
        storage.removeItem(key)
        return false
      }
      pruneBrowserStorage({ storage, replacingKey: key, reservedBytes: browserStorageBytes(key, value) })
      // Non-cache data can exceed the target on its own. Do not compete with it by adding more caches.
      let bytes = browserStorageBytes(key, value) + METADATA_RESERVE
      for (let i = 0; i < storage.length; i++) {
        const other = storage.key(i)
        if (other && other !== key) bytes += browserStorageBytes(other, storage.getItem(other) ?? '')
      }
      if (bytes > BROWSER_STORAGE_TARGET_BYTES) { storage.removeItem(key); return false }
    }
    try { storage.setItem(key, value) } catch {
      pruneBrowserStorage({ storage, aggressive: true, replacingKey: key })
      storage.setItem(key, value)
    }
    if (limit !== null) {
      const times = readTimes(storage)
      times[key] = Date.now()
      saveTimes(storage, times)
    }
    return true
  } catch { return false }
}

/** Run before the first React render. Page lifecycle hooks supplement (never replace) write-time limits. */
export function startBrowserStorageMaintenance(): () => void {
  const clean = () => { pruneBrowserStorage() }
  clean()
  const timer = window.setInterval(clean, BROWSER_CACHE_CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', clean)
  window.addEventListener('pagehide', clean)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', clean)
    window.removeEventListener('pagehide', clean)
  }
}
