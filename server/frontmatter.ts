function quote(raw: string): string {
  return `"${raw.replace(/"/g, '\\"')}"`
}

function unquote(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"')
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
    desc는 자동 생성하지 않으므로 작성자(사람·AI)가 직접 채우도록 빈 값으로 둔다. */
export function buildFrontmatter(title: string): string {
  const today = todayDate()
  return `---\ntitle: ${quote(title)}\ncreated: ${today}\nupdated: ${today}\ndesc: ""\n---\n\n`
}
