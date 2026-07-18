function quote(raw: string): string {
  return `"${raw.replace(/"/g, '\\"')}"`
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
