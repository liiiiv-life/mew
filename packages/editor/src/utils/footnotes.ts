// 각주 — 본문의 마커는 **유니코드 아래첨자 글자 그대로**다(`₁₎`, `₁₀₎`). 커스텀 노드도 직렬화기도
// 쓰지 않는다: 저장된 .md를 다른 곳에서 열어도, git diff에서도 사람이 읽는 그대로 보인다.
//
// 내용은 문서 맨 아래 `# References` 구역의 **순서 목록**으로 산다. 문단에 `1) 내용`이라고 쓰는 것은
// 안 된다 — `1)`은 CommonMark의 목록 표시라, 저장했다 다시 열면 목록으로 재파싱돼 구역이 통째로
// 어긋난다(왕복 테스트가 이걸 잡는다). 목록으로 두면 번호를 우리가 매길 필요조차 없다 —
// 항목을 끼우거나 빼면 마크다운·화면이 알아서 다시 센다. 화면에 `1)`로 보이는 것은 CSS가 한다.
//
// **번호는 자리가 정한다.** 문서 순서로 n번째 마커가 n번 각주이고, References의 n번째 줄이 그 내용이다.
// 그래서 중간에 넣거나 지우면 뒤 번호가 통째로 밀린다 — 그 재배치가 planFootnotes 하나에 들어 있다.
// 마커를 훑고 고치는 일은 화면마다 다르므로(tiptap은 PM 노드, 원문 보기는 문자열) 여기서는
// **번호와 내용을 짝짓는 계산만** 한다.

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉'

/** 본문에서 마커를 찾는 정규식 — 아래첨자 숫자 하나 이상 + 아래첨자 닫는 괄호 */
export const FOOTNOTE_MARKER_RE = /[₀-₉]+₎/g

/** References 구역의 제목 줄 — 레벨은 가리지 않는다(이미 쓰던 것을 그대로 쓴다) */
export const REFERENCES_HEADING_RE = /^\s*references\s*$/i

export function toSubscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUB_DIGITS[Number(d)] ?? d)
    .join('')
}

export function fromSubscript(text: string): number {
  const digits = text
    .split('')
    .map((ch) => SUB_DIGITS.indexOf(ch))
    .filter((i) => i >= 0)
  return digits.length === 0 ? 0 : Number(digits.join(''))
}

/** 본문에 박히는 마커 글자 — `markerFor(12)` → `₁₂₎` */
export function markerFor(n: number): string {
  return `${toSubscript(n)}₎`
}

export interface ReferenceEntry {
  num: number
  content: string
}

export interface FootnotePlan {
  /** 문서 순서 그대로, 마커마다 붙일 새 번호(언제나 1..N) */
  numbers: number[]
  /** 같은 순서로 References에 쓸 내용 — 짝이 없으면 빈 문자열 */
  contents: string[]
  /**
   * 이 자리를 채울 **기존 줄의 인덱스**, 새 줄이면 -1.
   * 내용이 빈 기존 줄("3) ")과 새로 생긴 줄을 구별하는 유일한 값이라 반드시 필요하다 —
   * 이걸 보고 "번호만 갈아끼울지, 빈 줄을 끼울지"가 갈린다.
   */
  sources: number[]
}

/**
 * 마커 순서와 지금 References 줄을 받아 새 번호·내용을 짝짓는다.
 *
 * 짝은 **옛 번호**로 맞춘다. 6번 마커를 지우면 남은 마커가 1..5,7..10이 되고, 각자 자기 내용을
 * 그대로 들고 6..9로 당겨진다. 5번 뒤에 새로 넣을 때는 아직 없는 번호(최대+1)로 넣으므로 짝이
 * 없어 빈 내용이 되고, 뒤 번호들은 자기 내용을 들고 한 칸씩 밀린다.
 *
 * 같은 번호가 두 번 나오면(마커를 복사·붙여넣기) 먼저 나온 쪽이 내용을 가져가고 뒤엣것은 빈칸이다.
 */
export function planFootnotes(markerNums: number[], entries: ReferenceEntry[]): FootnotePlan {
  // 옛 번호 → 그 번호를 쓰는 줄들의 인덱스(같은 번호가 여럿이면 먼저 나온 것부터 가져간다)
  const byNum = new Map<number, number[]>()
  for (const [i, entry] of entries.entries()) {
    const queue = byNum.get(entry.num)
    if (queue) queue.push(i)
    else byNum.set(entry.num, [i])
  }
  const numbers: number[] = []
  const contents: string[] = []
  const sources: number[] = []
  for (const [i, oldNum] of markerNums.entries()) {
    const source = byNum.get(oldNum)?.shift() ?? -1
    numbers.push(i + 1)
    sources.push(source)
    contents.push(source >= 0 ? entries[source].content : '')
  }
  return { numbers, contents, sources }
}

/** 새 마커에 쓸 번호 — 아직 아무도 안 쓰는 번호라야 남의 내용을 가로채지 않는다 */
export function nextMarkerNumber(markerNums: number[], entries: ReferenceEntry[]): number {
  const used = [...markerNums, ...entries.map((e) => e.num)]
  return used.length === 0 ? 1 : Math.max(...used) + 1
}

