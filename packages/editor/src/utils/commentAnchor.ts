// 파일 댓글의 앵커 — 줄·오프셋이 아니라 **텍스트 문맥**으로 자리를 기억한다.
// 본문은 협업·에이전트·터미널 편집으로 수시로 바뀌므로 고정 오프셋은 금방 낡는다. 대신
// { 선택 텍스트, 앞 문맥(prefix), 만들 당시 줄 }을 저장해 두고, 그릴 때마다 지금 본문에서 다시 찾는다.
// 못 찾으면 null — 하이라이트만 사라지고 댓글 자체는 목록 팝업에 남는다(고아 댓글).
//
// 텍스트 공간은 "그 에디터가 보여 주는 본문"이다: plain(CodeMirror)은 파일 원문, hotview(TipTap)는
// 렌더된 텍스트(docTextWithMap). 두 공간이 달라서 한쪽에서 단 댓글이 다른 쪽에서 안 풀릴 수 있다 —
// 마크다운 문법 문자를 낀 선택이 그렇다. 받아들인 한계다.

export interface CommentAnchor {
  /** 선택했던 텍스트 — 언제나 한 글자 이상이다(빈 선택에는 댓글을 달 수 없다) */
  text: string
  /** 선택 시작 앞의 문맥 — 같은 텍스트가 여러 번 나올 때 가르는 기준 */
  prefix: string
  /** 만들 당시 줄 번호(1부터, 그 텍스트 공간 기준) — prefix까지 같을 때의 동점 처리용 */
  line: number
}

/** index가 몇 번째 줄인지(1부터) — 앞쪽 개행 수 + 1 */
function lineOfIndex(docText: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (docText.charCodeAt(i) === 10) line++
  return line
}

/** 두 문자열의 공통 접미사 길이 — prefix 후보가 저장된 prefix와 얼마나 같은 꼬리를 가졌는지 */
function commonSuffixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = []
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    out.push(idx)
    if (out.length > 500) break // 병적으로 반복되는 텍스트 — 앞쪽 후보로 충분하다
    idx = haystack.indexOf(needle, idx + 1)
  }
  return out
}

/**
 * 지금 본문에서 앵커 자리를 다시 찾는다. 반환은 텍스트 인덱스 [from, to)로 **언제나 한 글자 이상**이다.
 * 선택 텍스트의 모든 등장 위치 중 prefix 꼬리가 가장 길게 맞는 곳, 동점이면 저장된 줄에 가장 가까운 곳.
 *
 * 선택 텍스트가 빈 앵커는 자리가 없다고 본다(null). 예전에는 커서 자리에 작은 네모로 세웠지만
 * 없앴다 — 무엇에 대한 말인지 본문만 보고는 알 수 없었다. 옛 원장에 남은 그런 댓글은 고아가 되어
 * 목록 팝업에만 남는다(ADR 0051).
 */
export function resolveCommentAnchor(docText: string, anchor: CommentAnchor): { from: number; to: number } | null {
  if (!anchor.text) return null
  const candidates = allIndexesOf(docText, anchor.text)
  if (candidates.length === 0) return null
  let best = candidates[0]
  let bestScore = -1
  let bestLineDist = Infinity
  for (const idx of candidates) {
    const before = docText.slice(Math.max(0, idx - anchor.prefix.length), idx)
    const score = commonSuffixLength(before, anchor.prefix)
    const lineDist = Math.abs(lineOfIndex(docText, idx) - anchor.line)
    if (score > bestScore || (score === bestScore && lineDist < bestLineDist)) {
      best = idx
      bestScore = score
      bestLineDist = lineDist
    }
  }
  return { from: best, to: best + anchor.text.length }
}

/**
 * 앵커를 만든다 — from·to는 그 텍스트 공간의 인덱스.
 * **선택이 비어 있으면(from === to) null이다** — 댓글은 고른 글자에만 붙는다.
 */
export function makeCommentAnchor(docText: string, from: number, to: number): CommentAnchor | null {
  if (from >= to) return null
  return {
    text: docText.slice(from, to),
    prefix: docText.slice(Math.max(0, from - 40), from),
    line: lineOfIndex(docText, from),
  }
}
