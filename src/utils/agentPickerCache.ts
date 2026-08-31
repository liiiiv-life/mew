import {
  fetchAgentRuntimes,
  fetchAgentSets,
  type AgentRuntimeStatus,
  type AgentSet,
} from '../api/client'

// 새 탭 선택기는 탭마다 다시 마운트된다. 마지막 목록을 모듈에 들고 먼저 그린 뒤,
// 백그라운드 요청이 끝나면 모든 열린 선택기에 최신값을 알린다.
let runtimeCache: AgentRuntimeStatus[] | null = null
let setCache: AgentSet[] | null = null
let runtimeRequest: Promise<AgentRuntimeStatus[]> | null = null
let setRequest: Promise<AgentSet[]> | null = null
const runtimeListeners = new Set<(items: AgentRuntimeStatus[]) => void>()
const setListeners = new Set<(items: AgentSet[]) => void>()

export const cachedAgentRuntimes = () => runtimeCache
export const cachedAgentSets = () => setCache

function publishRuntimes(items: AgentRuntimeStatus[]) {
  runtimeCache = items
  for (const listener of runtimeListeners) listener(items)
}

function publishSets(items: AgentSet[]) {
  setCache = items
  for (const listener of setListeners) listener(items)
}

export function refreshAgentRuntimes(): Promise<AgentRuntimeStatus[]> {
  if (!runtimeRequest) {
    runtimeRequest = fetchAgentRuntimes()
      .then(({ runtimes }) => {
        publishRuntimes(runtimes)
        return runtimes
      })
      .finally(() => { runtimeRequest = null })
  }
  return runtimeRequest
}

export function refreshAgentSets(): Promise<AgentSet[]> {
  if (!setRequest) {
    setRequest = fetchAgentSets()
      .then(({ sets }) => {
        publishSets(sets)
        return sets
      })
      .finally(() => { setRequest = null })
  }
  return setRequest
}

export function updateAgentSetsCache(items: AgentSet[]) {
  publishSets(items)
}

export function updateAgentRuntimesCache(items: AgentRuntimeStatus[]) {
  publishRuntimes(items)
}

export function subscribeAgentRuntimes(listener: (items: AgentRuntimeStatus[]) => void): () => void {
  runtimeListeners.add(listener)
  return () => runtimeListeners.delete(listener)
}

export function subscribeAgentSets(listener: (items: AgentSet[]) => void): () => void {
  setListeners.add(listener)
  return () => setListeners.delete(listener)
}
