// 하단 입력칸(전송 전 임시 입력)을 tmux 세션별로 브라우저에 저장한다 — 탭을 옮기거나 터미널을
// 닫았다 열어도, 새로고침해도 쓰던 내용이 남아 있게 한다. TmuxTerminal이 key={session}으로 세션마다
// 새로 마운트돼 state가 초기화되기 때문. 서버(tmux)엔 초안 개념이 없으므로 탭 순서(TAB_ORDER_KEY)와
// 마찬가지로 localStorage에만 둔다.
const DRAFTS_KEY = 'mew:tmux-input-drafts'

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
    // 사파리 프라이빗 모드 등 저장 실패는 무시 — 초안 보존은 편의 기능이지 필수가 아니다
  }
}

export function readInputDraft(session: string): string {
  return readAll()[session] ?? ''
}

/** 빈 문자열이면 초안을 지운다(전송 후 호출되면 자연히 정리됨) */
export function writeInputDraft(session: string, text: string): void {
  const map = readAll()
  if (text) map[session] = text
  else delete map[session]
  writeAll(map)
}

/** 세션 종료 시 남은 초안을 정리한다 — 같은 이름으로 새 세션을 만들 때 옛 초안이 되살아나지 않도록 */
export function clearInputDraft(session: string): void {
  writeInputDraft(session, '')
}

/** 세션 이름을 바꾸면 초안도 새 이름을 따라가게 한다 */
export function renameInputDraft(oldName: string, newName: string): void {
  const map = readAll()
  if (!(oldName in map)) return
  map[newName] = map[oldName]
  delete map[oldName]
  writeAll(map)
}
