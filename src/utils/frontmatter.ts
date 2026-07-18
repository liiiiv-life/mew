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
// 키에 콜론만 없으면 뭐든 허용(공백·한글 포함) — 값에 콜론이 있어도 첫 콜론까지만 키로 본다
const FIELD_LINE_RE = /^([^:\n]+):\s*(.*)$/

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
    if (!f.key.trim()) continue // 키를 지우는 중인 빈 행은 저장하지 않는다
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
  while (existing.has(`필드${n}`)) n++
  return `필드${n}`
}

const MAX_DESC_LENGTH = 200

/**
 * 본문 맨 앞 문단에서 desc 후보를 뽑는다 — title은 body에 H1으로 중복되지 않으므로
 * (frontmatter가 유일한 출처) 그냥 첫 줄부터 본다. 목록·인용·표·코드블록·제목 등이면
 * (항상 그런 건 아니라서) 후보 없음으로 취급하고 undefined를 반환한다.
 */
export function extractDescription(body: string): string | undefined {
  const lines = body.split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length) return undefined

  const first = lines[i].trim()
  if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||`{3,}|~{3,}|---|<!--)/.test(first)) return undefined

  let paragraph = first
  let j = i + 1
  while (j < lines.length && lines[j].trim() !== '') {
    paragraph += ' ' + lines[j].trim()
    j++
  }
  paragraph = paragraph.trim()
  if (!paragraph) return undefined

  const sentenceEnd = paragraph.search(/[.!?](?=\s|$)/)
  let desc = sentenceEnd >= 0 ? paragraph.slice(0, sentenceEnd + 1) : paragraph
  if (desc.length > MAX_DESC_LENGTH) desc = desc.slice(0, MAX_DESC_LENGTH - 1).trimEnd() + '…'
  return desc
}
