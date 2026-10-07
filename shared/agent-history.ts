/** Transport ranges are half-open: [start, end). A generation changes whenever history is replaced. */
export type HistoryCursor = { generation: string; end: number }
export type HistoryRequest = { generation?: string; after?: number; before?: number }
export type HistoryPage<T> = {
  generation: string; sessionId: string; start: number; end: number; total: number
  usersBefore: number; mode: 'replace' | 'append' | 'prepend'; events: T[]; controls: T[]
}
export type HistoryPosition = { generation: string; seq: number }
export const HISTORY_PAGE_TURNS = 20

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
    } else if (['turn_start', 'permission', 'error', 'fatal'].includes(event.type)
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
    const recent = this.boundaries.length > HISTORY_PAGE_TURNS ? this.boundaries[this.boundaries.length - HISTORY_PAGE_TURNS] : 0
    let start = recent, end = this.length, mode: HistoryPage<T>['mode'] = 'replace'
    if (request.generation === this.generation) {
      if (Number.isSafeInteger(request.after) && request.after! >= recent && request.after! <= end) {
        start = request.after!; mode = 'append'
      } else if (Number.isSafeInteger(request.before) && request.before! > 0 && request.before! <= end) {
        const boundary = boundaryIndex(request.before!)
        if (this.boundaries[boundary] === request.before) {
          end = request.before!
          start = boundary > HISTORY_PAGE_TURNS ? this.boundaries[boundary - HISTORY_PAGE_TURNS] : 0
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
  return result
}
