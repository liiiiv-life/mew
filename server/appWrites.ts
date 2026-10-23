// 앱(에디터 자동저장·커밋·되돌리기)이 방금 디스크에 쓴 내용을 잠깐 기억해 둔다.
// collabAgent의 파일 감시(server/collabAgent.ts)가 이 기록과 정확히 일치하는 변경을 "우리가 낸
// 메아리"로 보고 무시하게 하기 위함 — 외부(AI·터미널이 직접 쓴) 변경만 협업 방에 주입한다.
//
// 왜 필요한가: 사용자가 한 자씩 타이핑하면 방(room)이 먼저 바뀌고 자동저장이 뒤늦게 디스크에 쓴다.
// 감시자가 그 디스크(방보다 살짝 과거인 스냅샷)를 도로 방에 주입하면, 방금 친 마지막 글자들이
// 되돌려진다. 앱 자신의 쓰기를 정확히 걸러내야 정상 타이핑이 에이전트와 싸우지 않는다.
// api.ts(순수 HTTP 계층)가 tiptap/happy-dom을 끌어오지 않도록, 이 아주 작은 원장만 공유한다.

interface Recent {
  content: string
  at: number
}

// 절대경로 → 최근 앱이 쓴 내용들(빠른 연속 저장을 대비해 여러 개 보관)
const recent = new Map<string, Recent[]>()
const TTL_MS = 15_000
const MAX_PER_PATH = 8

function prune(list: Recent[], now: number): Recent[] {
  return list.filter((r) => now - r.at < TTL_MS)
}

/** 앱이 absPath에 content를 썼음을 기록한다 (fs.writeFileSync 직후 호출) */
export function noteAppWrite(absPath: string, content: string): void {
  const now = Date.now()
  const list = prune(recent.get(absPath) ?? [], now)
  list.push({ content, at: now })
  // 오래된 것부터 버려 상한을 유지 — 원장이 무한정 자라지 않게 한다
  recent.set(absPath, list.slice(-MAX_PER_PATH))
}

/** 이 디스크 내용이 앱이 방금 쓴 메아리면 true — 소비(제거)한다. 외부 변경이면 false. */
export function consumeAppWrite(absPath: string, content: string): boolean {
  const now = Date.now()
  const list = prune(recent.get(absPath) ?? [], now)
  const idx = list.findIndex((r) => r.content === content)
  if (idx === -1) {
    recent.set(absPath, list)
    return false
  }
  list.splice(idx, 1)
  recent.set(absPath, list)
  return true
}
