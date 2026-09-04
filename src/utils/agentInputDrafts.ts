// 에이전트 입력 초안은 서버 세션이 아니라 브라우저 탭 상태다. 탭 id별로 저장해 창을 닫거나
// 새로고침해도 쓰던 문장이 돌아오게 한다.
const DRAFTS_KEY = 'mew:agent-input-drafts'
const HISTORIES_KEY = 'mew:agent-input-histories'
const MAX_HISTORY_ITEMS = 100

type DraftMap = Record<string, string>
type HistoryMap = Record<string, string[]>

function readAll(): DraftMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const out: DraftMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(map: DraftMap): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(DRAFTS_KEY)
    else localStorage.setItem(DRAFTS_KEY, JSON.stringify(map))
  } catch {
    // 저장 실패는 편의 기능 상실로만 끝낸다.
  }
}

function readHistories(): HistoryMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORIES_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const out: HistoryMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) out[key] = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    }
    return out
  } catch {
    return {}
  }
}

function writeHistories(map: HistoryMap): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(HISTORIES_KEY)
    else localStorage.setItem(HISTORIES_KEY, JSON.stringify(map))
  } catch { /* 히스토리는 편의 기능이다. */ }
}

export function readAgentInputDraft(tabId: string): string {
  return readAll()[tabId] ?? ''
}

export function writeAgentInputDraft(tabId: string, text: string): void {
  const map = readAll()
  if (text) map[tabId] = text
  else delete map[tabId]
  writeAll(map)
}

export function clearAgentInputDraft(tabId: string): void {
  writeAgentInputDraft(tabId, '')
  const histories = readHistories()
  delete histories[tabId]
  writeHistories(histories)
}

export function readAgentInputHistory(tabId: string): string[] {
  return readHistories()[tabId] ?? []
}

/** 전송에 성공한 입력만 최근 100개까지 탭별로 보관한다. */
export function recordAgentInputHistory(tabId: string, text: string): void {
  if (!text.trim()) return
  const histories = readHistories()
  const previous = histories[tabId] ?? []
  histories[tabId] = previous[previous.length - 1] === text
    ? previous
    : [...previous, text].slice(-MAX_HISTORY_ITEMS)
  writeHistories(histories)
}
