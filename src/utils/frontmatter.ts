export interface FrontmatterData {
  title: string
  created: string
  updated: string
  desc?: string
}

// 닫는 --- 뒤의 개행을 전부 삼킨다 (하나만 삼키면 split→join을 반복할 때마다 빈 줄이 하나씩 늘어남)
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/

function unquote(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"')
  return t
}

function quote(raw: string): string {
  return `"${raw.replace(/"/g, '\\"')}"`
}

/** frontmatter가 없거나 title/created/updated 중 하나라도 없으면 frontmatter: null, body는 원본 그대로 */
export function splitFrontmatter(content: string): { frontmatter: FrontmatterData | null; body: string } {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return { frontmatter: null, body: content }

  const data: Partial<FrontmatterData> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^(title|created|updated|desc):\s*(.*)$/.exec(line)
    if (m) data[m[1] as keyof FrontmatterData] = unquote(m[2])
  }
  if (!data.title || !data.created || !data.updated) return { frontmatter: null, body: content }

  return { frontmatter: data as FrontmatterData, body: content.slice(match[0].length) }
}

export function joinFrontmatter(frontmatter: FrontmatterData, body: string): string {
  const descLine = frontmatter.desc ? `desc: ${quote(frontmatter.desc)}\n` : ''
  return `---\ntitle: ${quote(frontmatter.title)}\n${descLine}created: ${frontmatter.created}\nupdated: ${frontmatter.updated}\n---\n\n${body}`
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

const MAX_DESC_LENGTH = 200

/**
 * 본문 맨 앞 문단에서 desc 후보를 뽑는다 — title은 이제 body에 H1으로 중복되지 않으므로
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
