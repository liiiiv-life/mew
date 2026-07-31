// 문서별 스크롤 위치를 기기(브라우저)에 저장한다 — 탭을 오가거나 새로고침한 뒤에도
// 마지막으로 보던 자리로 돌아온다. 열린 탭 복원(App.tsx OPEN_TABS_KEY)과 같은 발상이라
// 같은 프로젝트 스코프 규칙을 쓰고, 위치는 localStorage에 남겨 세션을 넘겨도 유지한다.
//
// 키는 뷰 모드까지 구분한다 — 같은 .md라도 hotview(tiptap)와 plain(CodeMirror)은 스크롤
// 좌표계가 다르므로 호출부가 'h:'/'p:' 접두사를 붙여 넘긴다.
import { getProject } from '../api/client'

// 프로젝트는 앱 안에서 바뀌므로(프로젝트 탭) 키는 읽고 쓰는 그 순간에 만든다.
// docs는 예전 키를 그대로 써서 이미 저장된 위치를 잃지 않는다 (열린 탭 복원 키와 같은 규칙).
function key(): string {
  const project = getProject()
  return project === 'docs' ? 'mew:scroll-offsets' : `mew:scroll-offsets:${project}`
}

// "모든 글"의 위치를 담되 무한정 커지지 않게 상한을 둔다 — 넘으면 가장 오래된 것부터 버린다.
// JS 객체는 문자열 키 삽입 순서를 보존하므로 그 순서를 LRU 근사로 쓴다.
const MAX_ENTRIES = 300

type OffsetMap = Record<string, number>

function load(): OffsetMap {
  try {
    const raw = localStorage.getItem(key())
    return raw ? (JSON.parse(raw) as OffsetMap) : {}
  } catch {
    return {}
  }
}

function persist(map: OffsetMap) {
  try {
    localStorage.setItem(key(), JSON.stringify(map))
  } catch {
    // 용량 초과 등 — 위치 저장은 편의 기능이라 실패해도 조용히 넘어간다
  }
}

export function getScrollOffset(key: string): number {
  return load()[key] ?? 0
}

export function setScrollOffset(key: string, offset: number) {
  if (!key) return
  const map = load()
  // 재삽입으로 최근성 갱신(LRU) — 기존 키를 지우고 끝에 다시 넣는다
  delete map[key]
  const value = Math.max(0, Math.round(offset))
  // 맨 위(0)는 기본값과 같으니 굳이 저장하지 않는다 — 잠깐 열어만 본 글로 LRU를 채워
  // 실제로 스크롤해 둔 위치를 밀어내지 않게 한다
  if (value > 0) map[key] = value
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[stale]
  }
  persist(map)
}
