import { uiText } from '@mew/ui/i18n-core'
export interface FrontmatterField {
  key: string
  value: string
}

export interface FrontmatterData {
  title: string
  // desc/created/updated 포함 title 외 전부 — 사용자가 자유롭게 추가·수정·삭제하는 필드들
  fields: FrontmatterField[]
}

// 닫는 --- 뒤의 개행을 전부 삼킨다 (하나만 삼키면 split→join을 반복할 때마다 빈 줄이 하나씩 늘어남)
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/
// 키가 비어 있어도 허용한다 — 필드명을 지우고 새로 입력하는 도중(빈 키 상태)에도 필드가
// 사라지면 안 된다. 필드 삭제는 오직 × 버튼으로만 한다. 값에 콜론이 있어도 첫 콜론까지만 키로 본다.
const FIELD_LINE_RE = /^([^:\n]*):\s*(.*)$/

function unquote(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"')
  return t
}

function quote(raw: string): string {
  return `"${raw.replace(/"/g, '\\"')}"`
}

/** frontmatter가 없거나 title이 없으면 frontmatter: null, body는 원본 그대로. title 외엔 전부 선택 필드. */
export function splitFrontmatter(content: string): { frontmatter: FrontmatterData | null; body: string } {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return { frontmatter: null, body: content }

  let title: string | undefined
  const fields: FrontmatterField[] = []
  for (const line of match[1].split(/\r?\n/)) {
    const m = FIELD_LINE_RE.exec(line)
    if (!m) continue
    const key = m[1].trim()
    const value = unquote(m[2])
    if (key === 'title') title = value
    else fields.push({ key, value })
  }
  if (title === undefined) return { frontmatter: null, body: content }

  return { frontmatter: { title, fields }, body: content.slice(match[0].length) }
}

export function joinFrontmatter(frontmatter: FrontmatterData, body: string): string {
  const lines = [`title: ${quote(frontmatter.title)}`]
  for (const f of frontmatter.fields) {
    lines.push(`${f.key}: ${quote(f.value)}`)
  }
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** fields 배열에서 다음 "필드N" 형태의 비어있지 않은 새 필드명을 고른다 (충돌 방지) */
export function nextFieldKey(fields: FrontmatterField[]): string {
  const existing = new Set(fields.map((f) => f.key))
  let n = 1
  while (existing.has(uiText("필드{p0}", { p0: n }))) n++
  return uiText("필드{p0}", { p0: n })
}
