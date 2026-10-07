import type { HistoryPage, HistoryPosition } from '../../shared/agent-history.ts'
import type { AgentEvent } from './agentFold.ts'
import type { CachedHistory } from './agent-history-cache.ts'

/** Reject gaps; never advance a reconnect cursor beyond records actually held by the browser. */
export function mergeHistoryPage(current: CachedHistory | null, page: HistoryPage<AgentEvent>): CachedHistory | null {
  if (page.events.length !== page.end - page.start || page.start < 0 || page.end > page.total) return null
  const same = current?.generation === page.generation && current.sessionId === page.sessionId
  if (page.mode === 'prepend') {
    if (!same || page.end !== current.start) return null
    return { ...current, start: page.start, usersBefore: page.usersBefore, events: [...page.events, ...current.events] }
  }
  if (page.mode === 'append') {
    if (!same || page.start > current.end || page.end < current.end || page.start < current.start) return null
    return { ...current, end: page.end, total: page.total, events: [...current.events, ...page.events.slice(current.end - page.start)] }
  }
  const tail = same && current.end > page.end && current.start <= page.end ? current.events.slice(page.end - current.start) : []
  return { generation: page.generation, sessionId: page.sessionId, start: page.start, end: page.end + tail.length,
    total: Math.max(page.total, page.end + tail.length), usersBefore: page.usersBefore, events: [...page.events, ...tail] }
}

export function appendHistoryEvent(current: CachedHistory | null, event: AgentEvent, position: HistoryPosition): CachedHistory | null {
  if (!current || current.generation !== position.generation) return null
  if (position.seq < current.end) return current
  if (position.seq !== current.end) return null
  return { ...current, end: current.end + 1, total: current.end + 1, events: [...current.events, event] }
}

/** Only for the socket-owned buffer; render state must receive a separate array snapshot. */
export function appendHistoryEventInPlace(current: CachedHistory | null, event: AgentEvent,
  position: HistoryPosition): 'append' | 'duplicate' | 'gap' {
  if (!current || current.generation !== position.generation) return 'gap'
  if (position.seq < current.end) return 'duplicate'
  if (position.seq !== current.end) return 'gap'
  current.events.push(event)
  current.end++
  current.total = current.end
  return 'append'
}
