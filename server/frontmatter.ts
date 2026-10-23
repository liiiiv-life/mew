function quote(raw: string): string {
  return JSON.stringify(raw)
}

function unquote(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t) as string }
    catch { return t.slice(1, -1).replace(/\\"/g, '"') }
  }
  return t
}

/** frontmatter 블록에서 title 값을 뽑는다 — 링크 라벨 동기화용 (없으면 null) */
export function parseTitle(content: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!m) return null
  for (const line of m[1].split(/\r?\n/)) {
    const f = /^title:\s*(.*)$/.exec(line)
    if (f) return unquote(f[1])
  }
  return null
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 새 문서용 YAML frontmatter 블록 — tags는 정책상 넣지 않는다 (docs/README.md 참고).
    description은 제목으로 시작하고 작성자가 본문 범위에 맞춰 구체화한다. */
export function buildFrontmatter(title: string): string {
  const today = todayDate()
  return `---\ntitle: ${quote(title)}\ncreated: ${today}\nupdated: ${today}\ndescription: ${quote(title.trim() || "제목 없는 문서")}\n---\n\n`
}
