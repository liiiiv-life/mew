/** Transport ranges are half-open: [start, end). A generation changes whenever history is replaced. */
export type HistoryCursor = { generation: string; end: number }
export type HistoryRequest = { generation?: string; after?: number; before?: number; deferWork?: boolean; turns?: number }
export type HistoryWorkPending = { type: 'work_pending'; count: number }
export type HistoryDetailsRequest = { generation: string; start: number; end: number }
export type HistoryDetails<T> = HistoryDetailsRequest & { events: T[] }
export type HistoryPage<T> = {
  generation: string; sessionId: string; start: number; end: number; total: number
  usersBefore: number; mode: 'replace' | 'append' | 'prepend'; events: T[]; controls: T[]
}
export type HistoryPosition = { generation: string; seq: number }
/** Display-only saved records; never a session pointer or a reconnect cursor. */
export type HistoryPreview<T> = { sessionId: string; start: number; events: T[] }
export const HISTORY_PAGE_TURNS = 20
export const HISTORY_DETAILS_EVENTS = 256

/** A compact run occupies its original number of sequence positions after decoding. */
export function expandHistoryWork<T extends { type: string }>(events: readonly (T | HistoryWorkPending)[]): (T | HistoryWorkPending)[] {
  const expanded: (T | HistoryWorkPending)[] = []
  for (const event of events) {
    if (event.type === 'work_pending' && 'count' in event && Number.isSafeInteger(event.count) && event.count > 0) {
      const pending: HistoryWorkPending = { type: 'work_pending', count: 1 }
      for (let i = 0; i < event.count; i++) expanded.push(pending)
    } else expanded.push(event)
  }
  return expanded
}

type EventShape = { type: string; update?: { sessionUpdate: string; messageId?: string } }

/** Maintains user boundaries incrementally; never splits a streamed question or its answer. */
export class HistoryIndex<T extends EventShape> {
  generation: string
  boundaries: number[] = []
  controls = new Map<string, T>()
  length = 0
  private lastUser = false
  private messageId: string | undefined
  constructor(generation: string) { this.generation = generation }
  push(event: T) {
    if (event.type === 'update' && event.update?.sessionUpdate === 'user_message_chunk') {
      if (!this.lastUser || event.update.messageId && event.update.messageId !== this.messageId) {
        this.boundaries.push(this.length)
        this.messageId = event.update.messageId
      }
      this.lastUser = true
    } else if (['turn_start', 'permission', 'error', 'fatal', 'work_pending'].includes(event.type)
      || event.type === 'update' && ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'].includes(event.update?.sessionUpdate ?? '')) {
      this.lastUser = false
    }
    if (['models', 'modes', 'thinking'].includes(event.type)) this.controls.set(event.type, event)
    this.length++
  }
  range(request: HistoryRequest = {}) {
    const boundaryIndex = (seq: number) => {
      let lo = 0, hi = this.boundaries.length
      while (lo < hi) {
        const middle = (lo + hi) >>> 1
        if (this.boundaries[middle] < seq) lo = middle + 1
        else hi = middle
      }
      return lo
    }
    const turns = Number.isSafeInteger(request.turns) && request.turns! >= 1 && request.turns! <= HISTORY_PAGE_TURNS ? request.turns! : HISTORY_PAGE_TURNS
    const recent = this.boundaries.length > turns ? this.boundaries[this.boundaries.length - turns] : 0
    let start = recent, end = this.length, mode: HistoryPage<T>['mode'] = 'replace'
    if (request.generation === this.generation) {
      if (Number.isSafeInteger(request.after) && request.after! >= recent && request.after! <= end) {
        start = request.after!; mode = 'append'
      } else if (Number.isSafeInteger(request.before) && request.before! > 0 && request.before! <= end) {
        const boundary = boundaryIndex(request.before!)
        if (this.boundaries[boundary] === request.before) {
          end = request.before!
          start = boundary > turns ? this.boundaries[boundary - turns] : 0
          mode = 'prepend'
        }
      }
    }
    const usersBefore = boundaryIndex(start)
    return { generation: this.generation, start, end, total: this.length, usersBefore, mode }
  }
  page(events: T[], sessionId: string, request: HistoryRequest = {}): HistoryPage<T> {
    const range = this.range(request)
    return { ...range, sessionId, events: events.slice(range.start, range.end), controls: [...this.controls.values()] }
  }
}

export function validHistoryRequest(value: unknown): HistoryRequest {
  if (!value || typeof value !== 'object') return {}
  const input = value as HistoryRequest
  const result: HistoryRequest = {}
  if (typeof input.generation === 'string' && input.generation.length <= 100) result.generation = input.generation
  for (const key of ['after', 'before'] as const) if (Number.isSafeInteger(input[key]) && input[key]! >= 0) result[key] = input[key]
  if (input.deferWork === true) result.deferWork = true
  if (Number.isSafeInteger(input.turns) && input.turns! >= 1 && input.turns! <= HISTORY_PAGE_TURNS) result.turns = input.turns
  return result
}

export function validHistoryDetailsRequest(value: unknown): HistoryDetailsRequest | null {
  if (!value || typeof value !== 'object') return null
  const input = value as HistoryDetailsRequest
  if (typeof input.generation !== 'string' || !input.generation.length || input.generation.length > 100
    || !Number.isSafeInteger(input.start) || !Number.isSafeInteger(input.end)
    || input.start < 0 || input.end <= input.start || input.end - input.start > HISTORY_DETAILS_EVENTS) return null
  return { generation: input.generation, start: input.start, end: input.end }
}
