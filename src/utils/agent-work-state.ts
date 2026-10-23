import type { CachedHistory } from './agent-history-cache.ts'
import type { AgentEvent } from './agentFold.ts'

/** Only fill deferred slots. Live records and the reconnect cursor are never replaced. */
export function hydrateHistoryWork(history: CachedHistory, generation: string,
  pages: { start: number; events: AgentEvent[] }[]): boolean {
  if (history.generation !== generation) return false
  let changed = false
  for (const page of pages) for (const [offset, event] of page.events.entries()) {
    const index = page.start + offset - history.start
    if (index < 0 || index >= history.events.length || history.events[index].type !== 'work_pending') continue
    history.events[index] = event
    changed = true
  }
  return changed
}
