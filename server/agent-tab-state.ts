import { closeExistingAgentHost } from './agentHost.ts'
import { readAgentTabs, writeAgentTabs, type StoredAgentTab } from './userUiState.ts'

function connectionsFor(tab: StoredAgentTab, workspacePath: string): Array<[string, string]> {
  const connections = new Map<string, [string, string]>()
  const add = (runtime: string, cwd: string) => connections.set(JSON.stringify([runtime, cwd]), [runtime, cwd])
  if (tab.runtime) add(tab.runtime, tab.cwd || workspacePath)
  for (const slot of Object.keys(tab.sessionIds ?? {})) {
    try {
      const pair: unknown = JSON.parse(slot)
      if (Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) add(pair[0], pair[1])
    } catch { /* Older pointers may not use runtime/cwd keys. */ }
  }
  return [...connections.values()]
}

export async function saveAgentTabs(email: string, workspacePath: string, input: unknown) {
  const previous = readAgentTabs(email, workspacePath)
  const state = writeAgentTabs(email, workspacePath, input)
  const remaining = new Set(state.tabs.map(tab => tab.id))
  const removed = previous?.tabs.filter(tab => !remaining.has(tab.id)) ?? []
  await Promise.all(removed.flatMap(tab => connectionsFor(tab, workspacePath).map(async ([runtime, cwd]) => {
    try { await closeExistingAgentHost(runtime, tab.id, cwd) }
    catch (err) { console.error('[mew:agent-tabs] 닫힌 탭의 감독 종료 실패:', err) }
  })))
  return state
}
