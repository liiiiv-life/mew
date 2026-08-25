import type { AgentEvent } from './agentFold'

const CACHE_PREFIX = 'mew:agent-events:'
const CACHE_VERSION = 1

export type AgentEventCache = {
  sessionId: string | null
  events: AgentEvent[]
}

type PersistedAgentEventCache = AgentEventCache & {
  version: typeof CACHE_VERSION
}

function storageKey(runtime: string, tabId: string, cwd: string): string {
  return `${CACHE_PREFIX}${JSON.stringify([runtime, tabId, cwd])}`
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string')
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
    const value: PersistedAgentEventCache = { version: CACHE_VERSION, ...cache }
    localStorage.setItem(storageKey(runtime, tabId, cwd), JSON.stringify(value))
  } catch {
    // 사생활 모드·용량 제한에서는 실시간 대화가 계속 동작해야 한다. 캐시는 best effort다.
  }
}

export function clearAgentEventCache(runtime: string, tabId: string, cwd: string): void {
  try {
    localStorage.removeItem(storageKey(runtime, tabId, cwd))
  } catch {
    /* 캐시 삭제 실패가 세션 종료를 막아서는 안 된다 */
  }
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
