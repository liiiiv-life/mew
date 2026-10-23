import type { AgentEvent } from './agentFold.ts'

export type AgentWorkRequest = {
  type: 'history_details'
  requestId: string
  generation: string
  start: number
  end: number
}

export type AgentWorkResponse = {
  requestId: string
  generation: string
  start: number
  end: number
  events?: AgentEvent[]
  error?: string
}

type Job = {
  key: string
  generation: string
  end: number
  next: number
  events: AgentEvent[]
  priority: boolean
  request?: AgentWorkRequest
  timer?: ReturnType<typeof setTimeout>
  promise: Promise<AgentEvent[]>
  resolve(events: AgentEvent[]): void
  reject(error: Error): void
}

type Range = { promise: Promise<AgentEvent[]>; chunks: Set<string> }
const CHUNK_SIZE = 256
const TIMEOUT_MS = 10_000
let requestSequence = 0

/** Socket-scoped work details; reset before changing the history generation or connection. */
export class AgentWorkLoader {
  private send: (request: AgentWorkRequest) => void
  private concurrency: number
  private generation?: string
  private revision = 0
  private disposed = false
  private paused = false
  private pumping = false
  private ranges = new Map<string, Range>()
  private cache = new Map<string, AgentEvent[]>()
  private jobs = new Map<string, Job>()
  private active = new Map<string, Job>()
  private priority = new Set<Job>()
  private background = new Set<Job>()

  constructor(options: { send(request: AgentWorkRequest): void; concurrency?: number }) {
    const concurrency = options.concurrency ?? 2
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('Invalid work request concurrency')
    this.send = options.send
    this.concurrency = Math.min(concurrency, 2)
  }

  request(generation: string, start: number, end: number, options: { priority?: boolean } = {}): Promise<AgentEvent[]> {
    if (this.disposed) return Promise.reject(new Error('Agent work loader disposed'))
    if (!generation || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      return Promise.reject(new RangeError('Invalid agent work range'))
    }
    if (this.generation !== undefined && this.generation !== generation) {
      return Promise.reject(new Error('Agent work generation changed'))
    }
    this.generation = generation
    const key = this.key(generation, start, end)
    const existing = this.ranges.get(key)
    if (existing) {
      if (options.priority) for (const chunk of existing.chunks) this.promote(this.jobs.get(chunk))
      return existing.promise
    }

    const chunks = new Set<string>()
    const pending: Promise<AgentEvent[]>[] = []
    for (let offset = start; offset < end; offset += CHUNK_SIZE) {
      const chunkEnd = Math.min(end, offset + CHUNK_SIZE)
      const chunkKey = this.key(generation, offset, chunkEnd)
      chunks.add(chunkKey)
      const cached = this.cache.get(chunkKey)
      if (cached) { pending.push(Promise.resolve(cached)); continue }
      let job = this.jobs.get(chunkKey)
      if (!job) {
        let resolve!: Job['resolve'], reject!: Job['reject']
        const promise = new Promise<AgentEvent[]>((res, rej) => { resolve = res; reject = rej })
        job = { key: chunkKey, generation, end: chunkEnd, next: offset, events: [],
          priority: !!options.priority, promise, resolve, reject }
        this.jobs.set(chunkKey, job)
        this.enqueue(job)
      } else if (options.priority) this.promote(job)
      pending.push(job.promise)
    }
    const revision = this.revision
    const promise = Promise.all(pending).then(parts => {
      if (revision !== this.revision) throw new Error('Agent work loading reset')
      return parts.flat()
    }, error => {
      if (this.ranges.get(key)?.promise === promise) this.ranges.delete(key)
      throw error
    })
    this.ranges.set(key, { promise, chunks })
    this.pump()
    return promise
  }

  /** Returns false for replies from a reset, a timed-out attempt, or another loader. */
  accept(response: AgentWorkResponse): boolean {
    const job = this.active.get(response.requestId)
    if (!job) return false
    const request = job.request!
    if (response.generation !== request.generation || response.start !== request.start
      || !Number.isSafeInteger(response.end) || response.end <= request.start || response.end > request.end) {
      this.fail(job, new Error('Invalid agent work response range'))
      return true
    }
    if (response.error !== undefined) {
      this.fail(job, new Error(response.error || 'Agent work request failed'))
      return true
    }
    if (!Array.isArray(response.events) || response.events.length !== response.end - response.start) {
      this.fail(job, new Error('Invalid agent work response length'))
      return true
    }
    this.release(job)
    for (const event of response.events) job.events.push(event)
    job.next = response.end
    if (job.next < job.end) this.enqueue(job)
    else {
      this.jobs.delete(job.key)
      this.cache.set(job.key, job.events)
      job.resolve(job.events)
    }
    this.pump()
    return true
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused) this.pump()
  }

  reset(generation?: string): void {
    const jobs = [...this.jobs.values()]
    this.revision++
    this.generation = generation
    this.ranges.clear()
    this.cache.clear()
    this.jobs.clear()
    this.priority.clear()
    this.background.clear()
    for (const job of jobs) {
      this.release(job)
      job.reject(new Error('Agent work loading reset'))
    }
  }

  dispose(): void {
    this.disposed = true
    this.reset()
  }

  private key(generation: string, start: number, end: number): string {
    return JSON.stringify([generation, start, end])
  }

  private enqueue(job: Job): void {
    ;(job.priority ? this.priority : this.background).add(job)
  }

  private promote(job: Job | undefined): void {
    if (!job || job.priority) return
    job.priority = true
    if (this.background.delete(job)) this.priority.add(job)
  }

  private release(job: Job): void {
    if (job.timer !== undefined) clearTimeout(job.timer)
    if (job.request) this.active.delete(job.request.requestId)
    job.timer = undefined
    job.request = undefined
  }

  private fail(job: Job, error: Error): void {
    this.release(job)
    this.jobs.delete(job.key)
    this.priority.delete(job)
    this.background.delete(job)
    for (const [key, range] of this.ranges) if (range.chunks.has(job.key)) this.ranges.delete(key)
    job.reject(error)
    this.pump()
  }

  private pump(): void {
    if (this.pumping || this.disposed || this.paused) return
    this.pumping = true
    try {
      while (!this.paused && this.active.size < this.concurrency) {
        const job = this.priority.values().next().value ?? this.background.values().next().value
        if (!job) break
        this.priority.delete(job)
        this.background.delete(job)
        const request: AgentWorkRequest = { type: 'history_details', requestId: `agent-work-${++requestSequence}`,
          generation: job.generation, start: job.next, end: job.end }
        job.request = request
        this.active.set(request.requestId, job)
        job.timer = setTimeout(() => {
          if (this.active.get(request.requestId) === job) this.fail(job, new Error('Agent work request timed out'))
        }, TIMEOUT_MS)
        try { this.send(request) }
        catch (error) { this.fail(job, error instanceof Error ? error : new Error(String(error))) }
      }
    } finally { this.pumping = false }
  }
}
