import { appendEventFold, createEventFold, type AgentEvent, type EventFold } from './agentFold.ts'

export type AgentEventState = { events: AgentEvent[]; fold: EventFold }

export function createAgentEventState(events: AgentEvent[], locale: EventFold['locale'], baseIndex: number): AgentEventState {
  return { events, fold: appendEventFold(createEventFold(locale, baseIndex), events) }
}

export function appendAgentEventState(previous: AgentEventState, batch: AgentEvent[], swap: boolean,
  locale: EventFold['locale'], baseIndex: number): AgentEventState {
  const reset = batch.findLastIndex(event => event.type === 'reset')
  const tail = reset >= 0 ? batch.slice(reset + 1) : batch
  const replace = swap || reset >= 0
  const events = replace ? tail.slice() : previous.events.concat(tail)
  const same = !replace && previous.fold.locale === locale && previous.fold.baseIndex === baseIndex
  return { events, fold: same ? appendEventFold(previous.fold, tail)
    : appendEventFold(createEventFold(locale, baseIndex), events) }
}
