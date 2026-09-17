/** Short-lived, account-session-local UI snapshots. Never use this to prefetch files from another root. */
export class WorkspaceSnapshotCache<T> {
  private entries = new Map<string, { value: T; expires: number; bytes: number }>()
  private pending = new Map<string, Promise<T>>()
  private generation = 0

  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly ttlMs: number

  constructor(maxEntries = 12, maxBytes = 1024 * 1024, ttlMs = 60_000) {
    this.maxEntries = maxEntries
    this.maxBytes = maxBytes
    this.ttlMs = ttlMs
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) { this.entries.delete(key); return undefined }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    const bytes = JSON.stringify(value).length * 2 + key.length * 2
    this.entries.delete(key)
    if (bytes > this.maxBytes) return
    this.entries.set(key, { value, bytes, expires: Date.now() + this.ttlMs })
    let total = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    while (this.entries.size > this.maxEntries || total > this.maxBytes) {
      const first = this.entries.keys().next().value!
      total -= this.entries.get(first)!.bytes
      this.entries.delete(first)
    }
  }

  load(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const existing = this.pending.get(key)
    if (existing) return existing
    const generation = this.generation
    const request = read().then(value => {
      if (generation !== this.generation) return value
      // A local edit while GET was in flight is newer than its server snapshot.
      const newer = this.get(key)
      if (newer !== undefined) return newer
      this.set(key, value)
      return value
    }).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key)
    })
    this.pending.set(key, request)
    return request
  }

  clear(): void {
    this.generation++
    this.entries.clear()
    this.pending.clear()
  }
}
