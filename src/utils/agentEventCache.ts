import { writeBrowserStorage } from '@mew/ui/browser-storage'
import type { AgentEvent } from './agentFold'

const CACHE_PREFIX = 'mew:agent-events:'
const CONTROL_CACHE_PREFIX = 'mew:agent-controls:'
const CACHE_VERSION = 1
/** 전사는 서버에도 있다. 공통 2MiB 캐시 예산 안에서 한 탭의 전사를 512KiB로 제한한다. */
export const AGENT_EVENT_CACHE_MAX_BYTES = 512 * 1024
export const AGENT_EVENT_CACHE_TOTAL_MAX_BYTES = 2 * 1024 * 1024

export type AgentEventCache = {
  sessionId: string | null
  events: AgentEvent[]
}

type PersistedAgentEventCache = AgentEventCache & {
  version: typeof CACHE_VERSION
  savedAt?: number
}

function storageKey(runtime: string, tabId: string, cwd: string): string {
  return `${CACHE_PREFIX}${JSON.stringify([runtime, tabId, cwd])}`
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string')
}

const storageBytes = (key: string, value: string) => (key.length + value.length) * 2

function eventCacheTabId(key: string): string | null {
  if (!key.startsWith(CACHE_PREFIX)) return null
  try {
    const tuple: unknown = JSON.parse(key.slice(CACHE_PREFIX.length))
    return Array.isArray(tuple) && typeof tuple[1] === 'string' ? tuple[1] : null
  } catch {
    return null
  }
}

function controlCacheTabId(key: string): string | null {
  if (!key.startsWith(CONTROL_CACHE_PREFIX)) return null
  const remainder = key.slice(CONTROL_CACHE_PREFIX.length)
  const separator = remainder.indexOf(':')
  if (separator < 0) return null
  const afterRuntime = remainder.slice(separator + 1)
  const tabEnd = afterRuntime.indexOf(':')
  return tabEnd < 0 ? null : afterRuntime.slice(0, tabEnd)
}

/**
 * 서버 계정 원장에 없는 탭의 로컬 전사·컨트롤 캐시를 지우고, 살아 있는 전사 캐시도 origin quota를
 * 독점하지 않게 제한한다. 원본 전사는 ACP 히스토리와 서버 transcript에 있으므로 이는 캐시 정리다.
 */
export function pruneAgentLocalCaches(liveTabIds?: ReadonlySet<string>, reservedBytes = 0): void {
  try {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key) keys.push(key)
    }

    const eventCaches: Array<{ key: string; bytes: number; savedAt: number }> = []
    for (const key of keys) {
      const eventTabId = eventCacheTabId(key)
      const controlTabId = controlCacheTabId(key)
      if (liveTabIds && ((eventTabId && !liveTabIds.has(eventTabId)) || (controlTabId && !liveTabIds.has(controlTabId)))) {
        localStorage.removeItem(key)
        continue
      }
      if (!eventTabId) continue
      const value = localStorage.getItem(key)
      if (value === null) continue
      const bytes = storageBytes(key, value)
      if (bytes > AGENT_EVENT_CACHE_MAX_BYTES) {
        localStorage.removeItem(key)
        continue
      }
      let savedAt = 0
      try {
        const parsed = JSON.parse(value) as { savedAt?: unknown }
        if (typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt)) savedAt = parsed.savedAt
      } catch { /* readAgentEventCache가 깨진 값은 무시한다 */ }
      eventCaches.push({ key, bytes, savedAt })
    }

    eventCaches.sort((left, right) => right.savedAt - left.savedAt)
    let keptBytes = reservedBytes
    for (const cache of eventCaches) {
      keptBytes += cache.bytes
      if (keptBytes > AGENT_EVENT_CACHE_TOTAL_MAX_BYTES) localStorage.removeItem(cache.key)
    }
  } catch {
    /* 사생활 모드·비활성 저장소에서는 캐시 없이 동작한다 */
  }
}

/** 탭을 다시 그리는 첫 프레임에 쓸 브라우저 전사. 깨졌거나 옛 형식이면 조용히 버린다. */
export function readAgentEventCache(runtime: string, tabId: string, cwd: string): AgentEventCache | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(runtime, tabId, cwd)) ?? 'null') as Partial<PersistedAgentEventCache> | null
    if (!value || value.version !== CACHE_VERSION || !Array.isArray(value.events) || !value.events.every(isAgentEvent)) return null
    if (value.sessionId !== null && typeof value.sessionId !== 'string') return null
    return { sessionId: value.sessionId ?? null, events: value.events }
  } catch {
    return null
  }
}

export function writeAgentEventCache(
  runtime: string,
  tabId: string,
  cwd: string,
  cache: AgentEventCache,
): void {
  try {
    const key = storageKey(runtime, tabId, cwd)
    // 뒤에서부터 직렬화해 오래된 거대 전사 전체를 매번 stringify하지 않는다.
    // 이벤트는 변형하지 않아 서버 replay와 정확히 겹침을 비교할 수 있다.
    const header = JSON.stringify({ version: CACHE_VERSION, savedAt: Date.now(), sessionId: cache.sessionId })
    const parts: string[] = []
    let bytes = storageBytes(key, header) + 32
    for (let index = cache.events.length - 1; index >= 0; index -= 1) {
      const part = JSON.stringify(cache.events[index])
      const nextBytes = (part.length + 1) * 2
      if (bytes + nextBytes > AGENT_EVENT_CACHE_MAX_BYTES) break
      parts.push(part)
      bytes += nextBytes
    }
    const serialized = `${header.slice(0, -1)},"events":[${parts.reverse().join(',')}]}`
    writeBrowserStorage(key, serialized)
  } catch {
    // 사생활 모드·용량 제한에서는 실시간 대화가 계속 동작해야 한다. 캐시는 best effort다.
    pruneAgentLocalCaches()
  }
}

export function clearAgentEventCache(runtime: string, tabId: string, cwd: string): void {
  try {
    localStorage.removeItem(storageKey(runtime, tabId, cwd))
  } catch {
    /* 캐시 삭제 실패가 세션 종료를 막아서는 안 된다 */
  }
}

/** Explicit tab close removes every runtime/cwd cache belonging to that tab. */
export function clearAgentTabCaches(tabId: string): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    for (const key of keys) {
      if (key && (eventCacheTabId(key) === tabId || controlCacheTabId(key) === tabId)) localStorage.removeItem(key)
    }
  } catch { /* Closing a tab must not depend on available storage. */ }
}

/**
 * 감독의 replay는 최근 500개뿐이다. 같은 세션이면 브라우저가 이미 본 앞부분을 보존하고 겹치는
 * 꼬리만 제거해 최신분을 잇는다. 브라우저가 꺼진 사이 500개 넘게 흘러 겹침이 없어도 기존 앞부분은
 * 남긴다. 세션이 달라졌거나 서버 전사가 비었으면 서버 상태가 기준이다.
 */
export function mergeAgentReplay(
  cached: AgentEvent[],
  replayed: AgentEvent[],
  sameSession: boolean,
  restored = false,
): AgentEvent[] {
  // session/load가 만든 전사는 turn_start/end 등 살아 있던 감독의 UI 이벤트가 없다.
  // 같은 대화여도 바이트 겹침을 찾을 수 없으므로 캐시에 덧붙이지 않고 교체한다.
  if (restored) return replayed
  if (!sameSession || replayed.length === 0) return replayed

  // 제한된 로컬 꼬리보다 서버 snapshot이 더 길면 서버가 가진 앞부분도 되살린다.
  if (cached.length > 0 && replayed.length >= cached.length) {
    const local = cached.map((event) => JSON.stringify(event))
    const remote = replayed.map((event) => JSON.stringify(event))
    for (let start = remote.length - local.length; start >= 0; start -= 1) {
      if (remote[start] === local[0] && local.every((value, index) => value === remote[start + index])) return replayed
    }
  }

  const maxOverlap = Math.min(cached.length, replayed.length)
  const cachedTail = cached.slice(cached.length - maxOverlap).map((event) => JSON.stringify(event))
  const replayHead = replayed.slice(0, maxOverlap).map((event) => JSON.stringify(event))
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true
    for (let i = 0; i < overlap; i += 1) {
      if (cachedTail[maxOverlap - overlap + i] !== replayHead[i]) {
        matches = false
        break
      }
    }
    if (matches) return [...cached, ...replayed.slice(overlap)]
  }
  return [...cached, ...replayed]
}
