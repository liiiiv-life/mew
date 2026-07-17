function quote(raw: string): string {
  return `"${raw.replace(/"/g, '\\"')}"`
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 새 문서용 YAML frontmatter 블록 (title/created/updated) — tags는 정책상 넣지 않는다 (docs/README.md 참고) */
export function buildFrontmatter(title: string): string {
  const today = todayDate()
  return `---\ntitle: ${quote(title)}\ncreated: ${today}\nupdated: ${today}\n---\n\n`
}
