import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { AgentWorkLoader } from '../utils/agent-work-loader.ts'
import { hydrateHistoryWork } from '../utils/agent-work-state.ts'
import type { CachedHistory } from '../utils/agent-history-cache.ts'
import type { AgentEvent, Item } from '../utils/agentFold.ts'

type Turn = Extract<Item, { kind: 'turn' }>
function workRanges(turn: Turn) {
  const deferred = turn.children.filter(child => child.kind === 'deferred_work')
  // Batch across small status/answer records instead of one network round trip per tool.
  return deferred.length ? [{ start: deferred[0].start, end: deferred.at(-1)!.end }] : []
}
type Options = {
  history: RefObject<CachedHistory | null>
  socket: RefObject<WebSocket | null>
  items: Item[]
  expanded: Set<string>
  enabled: boolean
  publish: () => void
}

export function useAgentWorkHistory({ history, socket, items, expanded, enabled, publish }: Options) {
  const [loader] = useState(() => new AgentWorkLoader({ send: request => {
    if (socket.current?.readyState !== WebSocket.OPEN) throw new Error('Connection closed')
    socket.current.send(JSON.stringify(request))
  } }))
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const generationRef = useRef<string | undefined>(undefined)
  const revisionRef = useRef(0)
  const opening = useRef(new Set<string>())
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled && pageVisible

  const reset = useCallback((generation?: string) => {
    generationRef.current = generation
    revisionRef.current++
    loader.reset(generation)
    opening.current.clear()
    setErrors({})
  }, [loader])
  const accept = useCallback((response: Extract<AgentEvent, { type: 'history_details' }>) => loader.accept(response), [loader])
  const load = useCallback((turn: Turn) => {
    const current = history.current
    if (!enabledRef.current || !current || opening.current.has(turn.key)) return
    const generation = current.generation
    const revision = revisionRef.current
    const ranges = workRanges(turn)
    if (!ranges.length) return
    opening.current.add(turn.key)
    setErrors(previous => { const next = { ...previous }; delete next[turn.key]; return next })
    void Promise.all(ranges.map(range => loader.request(generation, range.start, range.end, { priority: true })
      .then(events => ({ start: range.start, events })))).then(pages => {
      const latest = history.current
      if (revisionRef.current !== revision || generationRef.current !== generation || !latest) return
      if (hydrateHistoryWork(latest, generation, pages)) publish()
    }).catch(error => {
      if (revisionRef.current === revision) setErrors(previous => ({ ...previous, [turn.key]: String(error?.message ?? error) }))
    }).finally(() => { if (revisionRef.current === revision) opening.current.delete(turn.key) })
  }, [history, loader, publish])

  useEffect(() => {
    loader.setPaused(!enabled || !pageVisible)
    if (!enabled || !pageVisible) return
    const generation = history.current?.generation
    if (!generation) return
    if (generationRef.current !== generation) reset(generation)
    const opened = setTimeout(() => {
      for (const item of items) if (item.kind === 'turn' && expanded.has(`${item.key}:details`) && !errors[item.key]) load(item)
    }, 0)
    // Give the first conversation paint and input a head start. Hidden tabs do not prefetch.
    const timer = setTimeout(() => {
      if (document.visibilityState === 'hidden') return
      let remaining = 2048
      for (const item of items.filter(item => item.kind === 'turn').slice(-3).reverse()) {
        if (item.kind !== 'turn') continue
        for (const range of workRanges(item)) if (remaining > 0) {
          const end = Math.min(range.end, range.start + remaining)
          remaining -= end - range.start
          void loader.request(generation, range.start, end).catch(() => {})
        }
      }
    }, 200)
    return () => { clearTimeout(opened); clearTimeout(timer) }
  }, [enabled, pageVisible, items, expanded, errors, history, loader, load, reset])

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => () => loader.reset(), [loader])
  return { accept, reset, load, errors }
}
