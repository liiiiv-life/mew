export type DemoRepositoryEntry = { oid: string; size: number; binary: boolean }
export type DemoRepositoryIndex = { format: string; revision: string; files: Record<string, DemoRepositoryEntry> }
export type DemoRepositoryPayload = { content: string } | { base64: string }
export type DemoRepositoryLoader = (oid: string, signal?: AbortSignal) => Promise<DemoRepositoryPayload>

const encoder = new TextEncoder()
export const DEMO_REPOSITORY_CACHE_BYTES = 8 * 1024 * 1024

/** Immutable source bytes are separate from visitor edits and virtual Git history. */
export class DemoRepository {
  readonly index: DemoRepositoryIndex
  private loader: DemoRepositoryLoader
  private cache = new Map<string, string | Uint8Array<ArrayBuffer>>()
  private pending = new Map<string, { promise: Promise<void>; controller: AbortController; waiters: number }>()
  private bytes = 0
  private generation = 0
  private controller = new AbortController()

  constructor(index: DemoRepositoryIndex, loader: DemoRepositoryLoader, privateBudget = DEMO_REPOSITORY_CACHE_BYTES) {
    this.index = index; this.loader = loader; this.budget = privateBudget
  }
  private budget: number
  get cachedBytes(): number { return this.bytes }
  get cachedObjects(): number { return this.cache.size }
  peek(entry: DemoRepositoryEntry): string | Uint8Array<ArrayBuffer> | undefined {
    const value = this.cache.get(entry.oid)
    if (value !== undefined) { this.cache.delete(entry.oid); this.cache.set(entry.oid, value) }
    return value
  }
  async load(entry: DemoRepositoryEntry, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.peek(entry) !== undefined) return
    let pending = this.pending.get(entry.oid)
    if (!pending) {
      const generation = this.generation, controller = new AbortController()
      const operation = { promise: Promise.resolve(), controller, waiters: 0 }
      operation.promise = this.loader(entry.oid, AbortSignal.any([this.controller.signal, controller.signal])).then(payload => {
        if (generation !== this.generation || controller.signal.aborted) throw new DOMException('데모 세션이 종료됐습니다.', 'AbortError')
        let value: string | Uint8Array<ArrayBuffer>
        if (!entry.binary && 'content' in payload && typeof payload.content === 'string') value = payload.content
        else if (entry.binary && 'base64' in payload && typeof payload.base64 === 'string') value = Uint8Array.from(atob(payload.base64), char => char.charCodeAt(0))
        else throw new Error('데모 파일 형식이 올바르지 않습니다.')
        const size = typeof value === 'string' ? encoder.encode(value).byteLength : value.byteLength
        if (size !== entry.size) throw new Error('데모 파일 크기가 목록과 다릅니다.')
        if (size > this.budget) throw new Error('이 파일은 데모의 메모리 한도를 초과합니다. 다운로드로 확인해 주세요.')
        while (this.bytes + size > this.budget && this.cache.size) {
          const first = this.cache.entries().next().value!
          this.cache.delete(first[0]); this.bytes -= typeof first[1] === 'string' ? encoder.encode(first[1]).byteLength : first[1].byteLength
        }
        this.cache.set(entry.oid, value); this.bytes += size
      }).finally(() => { if (this.pending.get(entry.oid) === operation) this.pending.delete(entry.oid) })
      pending = operation
      this.pending.set(entry.oid, pending)
    }
    const operation = pending
    operation.waiters++
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true; signal?.removeEventListener('abort', aborted)
        operation.waiters--
        if (!operation.waiters && this.pending.get(entry.oid) === operation) {
          this.pending.delete(entry.oid); operation.controller.abort()
        }
        if (error !== undefined) reject(error); else resolve()
      }
      const aborted = () => finish(signal?.reason ?? new DOMException('요청을 취소했습니다.', 'AbortError'))
      signal?.addEventListener('abort', aborted, { once: true })
      operation.promise.then(() => finish(), error => finish(error))
      if (signal?.aborted) aborted()
    })
    signal?.throwIfAborted()
  }

  clear(): void {
    this.generation++; this.controller.abort(); this.controller = new AbortController()
    this.cache.clear(); this.pending.clear(); this.bytes = 0
  }
}

/** Only pinned objects below the demo static path can make a real fetch. */
export function createDemoRepositoryLoader(base: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): DemoRepositoryLoader {
  return async (oid, signal) => {
    if (!/^[a-f0-9]{64}$/.test(oid)) throw new Error('데모 파일 주소가 올바르지 않습니다.')
    const response = await fetcher(`${base.replace(/\/$/, '')}/repository/${oid}.json`, { signal, credentials: 'omit', redirect: 'error' })
    if (!response.ok) throw new Error('데모 파일을 불러오지 못했습니다. 다시 열어 주세요.')
    const body = await response.text()
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(body)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (digest !== oid) throw new Error('데모 파일 내용이 목록과 다릅니다.')
    return JSON.parse(body) as DemoRepositoryPayload
  }
}
