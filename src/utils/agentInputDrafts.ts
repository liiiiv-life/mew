// 에이전트 입력 초안은 서버 세션이 아니라 브라우저 탭 상태다. 탭 id별로 저장해 창을 닫거나
// 새로고침해도 쓰던 문장이 돌아오게 한다.
const DRAFTS_KEY = 'mew:agent-input-drafts'

type DraftMap = Record<string, string>

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
}
