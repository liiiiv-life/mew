import type { HistoryPage, HistoryPosition, HistoryPreview, HistoryWorkPending } from './agent-history.ts'

type DisplayEvent = { type: string; update?: { sessionUpdate: string } }
type DisplayMessage = DisplayEvent & {
  page?: HistoryPage<DisplayEvent>
  preview?: HistoryPreview<DisplayEvent>
  events?: DisplayEvent[]
  event?: DisplayEvent
  position?: HistoryPosition
}
const TOOL_FIELDS = new Set(['sessionUpdate', 'toolCallId', 'title', 'status', 'kind'])

export function isHistoryWorkEvent(event: DisplayEvent): boolean {
  return event.type === 'update' && !!event.update
    && ['agent_thought_chunk', 'tool_call'].includes(event.update.sessionUpdate)
}

/** Defer historical work only; visible replies, approvals and sequence positions remain intact. */
export function compactHistoryWork<T extends DisplayEvent>(events: readonly (T | HistoryWorkPending)[]): (T | HistoryWorkPending)[] {
  const compacted: (T | HistoryWorkPending)[] = []
  for (const event of events) {
    if (event.type === 'work_pending' && 'count' in event || isHistoryWorkEvent(event)) {
      const count = event.type === 'work_pending' && 'count' in event ? event.count : 1
      const last = compacted.at(-1)
      if (last?.type === 'work_pending' && 'count' in last) compacted[compacted.length - 1] = { type: 'work_pending', count: last.count + count }
      else compacted.push({ type: 'work_pending', count })
    } else compacted.push(agentDisplayEvent(event))
  }
  return compacted
}

/** Keep storage and ACP records intact; the conversation UI only reads tool identity and state. */
export function agentDisplayEvent<T extends DisplayEvent>(event: T): T {
  if (event.type !== 'update' || !event.update
    || !['tool_call', 'tool_call_update'].includes(event.update.sessionUpdate)) return event
  const source = event.update as Record<string, unknown>
  if (Object.keys(source).every(key => TOOL_FIELDS.has(key))) return event
  const update = Object.fromEntries(Object.entries(source).filter(([key]) => TOOL_FIELDS.has(key)))
  return { ...event, update }
}

/** Apply the same display contract to paged, preview, live and legacy WS messages. */
export function agentDisplayMessage<T extends DisplayMessage>(message: T): T {
  if (message.type === 'history' && message.page) return {
    ...message, page: { ...message.page, events: message.page.events.map(agentDisplayEvent), controls: message.page.controls.map(agentDisplayEvent) },
  }
  if (message.type === 'history_preview' && message.preview) return {
    ...message, preview: { ...message.preview, events: message.preview.events.map(agentDisplayEvent) },
  }
  if (message.type === 'replay' && message.events) return { ...message, events: message.events.map(agentDisplayEvent) }
  if ((message.type === 'history_event' || message.type === 'event') && message.event) return { ...message, event: agentDisplayEvent(message.event) }
  return agentDisplayEvent(message)
}
