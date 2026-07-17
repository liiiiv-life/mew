export interface FrontmatterData {
  title: string
  created: string
  updated: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

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
    const m = /^(title|created|updated):\s*(.*)$/.exec(line)
    if (m) data[m[1] as keyof FrontmatterData] = unquote(m[2])
  }
  if (!data.title || !data.created || !data.updated) return { frontmatter: null, body: content }

  return { frontmatter: data as FrontmatterData, body: content.slice(match[0].length) }
}

export function joinFrontmatter(frontmatter: FrontmatterData, body: string): string {
  return `---\ntitle: ${quote(frontmatter.title)}\ncreated: ${frontmatter.created}\nupdated: ${frontmatter.updated}\n---\n\n${body}`
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}
