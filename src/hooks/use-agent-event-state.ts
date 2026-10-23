import { useCallback, useMemo, useRef, useState, type SetStateAction } from 'react'
import { createAgentEventState, appendAgentEventState } from '../utils/agent-event-state.ts'
import type { AgentEvent, EventFold } from '../utils/agentFold.ts'

export function useAgentEventState(locale: EventFold['locale'], baseIndex: number) {
  const options = useRef({ locale, baseIndex })
  options.current = { locale, baseIndex }
  const [state, setState] = useState(() => createAgentEventState([], locale, baseIndex))
  const setEvents = useCallback((action: SetStateAction<AgentEvent[]>) => {
    const { locale, baseIndex } = options.current
    setState(previous => createAgentEventState(typeof action === 'function' ? action(previous.events) : action, locale, baseIndex))
  }, [])
  const appendEvents = useCallback((batch: AgentEvent[], swap: boolean) => {
    const { locale, baseIndex } = options.current
    setState(previous => appendAgentEventState(previous, batch, swap, locale, baseIndex))
  }, [])
  const fold = useMemo(() => state.fold.locale === locale && state.fold.baseIndex === baseIndex
    ? state.fold : createAgentEventState(state.events, locale, baseIndex).fold, [state, locale, baseIndex])
  return { events: state.events, items: fold.items, hasError: fold.hasError,
    lastAccessError: fold.lastAccessError, setEvents, appendEvents }
}
