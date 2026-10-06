import { uiText } from '@mew/ui/i18n-core'
import { parseDocument } from 'yaml'
export const FRONTMATTER_TYPES = ['text', 'link', 'select', 'multi-select', 'date', 'number'] as const
export type FrontmatterType = typeof FRONTMATTER_TYPES[number]
export interface FrontmatterField {
  key: string
  value: string
  type?: FrontmatterType
  options?: string[]
  source?: { key: string; value: string; yaml: string }
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
  if (t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t) } catch { return t.slice(1, -1).replace(/\\"/g, '"') }
  }
  return t
}

function quote(raw: string): string {
  return JSON.stringify(raw)
}

/** Settings stay attached to their field in a YAML comment, without becoming document properties. */
function parseField(key: string, raw: string): FrontmatterField {
  const tag = ' # mew:field '
  for (let marker = raw.indexOf(tag); marker !== -1; marker = raw.indexOf(tag, marker + tag.length)) {
    try {
      const settings = JSON.parse(raw.slice(marker + tag.length))
      if (settings && FRONTMATTER_TYPES.includes(settings.type)) {
        return { key, value: unquote(raw.slice(0, marker)), type: settings.type,
          ...(Array.isArray(settings.options) ? { options: [...new Set<string>(settings.options.filter((v: unknown) => typeof v === 'string'))] } : {}) }
      }
    } catch { /* A tag in the value/options is text; keep looking for a complete settings comment. */ }
  }
  return { key, value: unquote(raw) }
}

export function frontmatterType(field: FrontmatterField): FrontmatterType {
  if (field.type) return field.type
  if (/^\d{4}-\d{2}-\d{2}$/.test(field.value)) return 'date'
  if (field.value.trim() && Number.isFinite(Number(field.value))) return 'number'
  if (/^https?:\/\/|^\[[^\]]*\]\([^)]+\)$/.test(field.value)) return 'link'
  return 'text'
}

export function frontmatterSelections(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) return [...new Set<string>(parsed)]
  } catch { /* A scalar becomes one choice; commas inside text do not split it. */ }
  return value ? [value] : []
}

export function changeFrontmatterType(field: FrontmatterField, type: FrontmatterType): FrontmatterField {
  const previous = frontmatterType(field)
  const selections = previous === 'multi-select' || field.source && field.value.startsWith('[') ? frontmatterSelections(field.value) : field.value ? [field.value] : []
  const value = type === 'multi-select' ? JSON.stringify(selections)
    : previous === 'multi-select' && selections.length <= 1 ? selections[0] ?? '' : field.value
  return { ...field, type, value,
    ...(['select', 'multi-select'].includes(type) ? { options: [...new Set([...(field.options ?? []), ...selections])] } : {}) }
}

/** frontmatter가 없거나 title이 없으면 frontmatter: null, body는 원본 그대로. title 외엔 전부 선택 필드. */
export function splitFrontmatter(content: string): { frontmatter: FrontmatterData | null; body: string; lineNumbers?: { title: number; fields: number[] } } {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return { frontmatter: null, body: content }

  let title: string | undefined
  const fields: FrontmatterField[] = []
  const lineNumbers = { title: 2, fields: [] as number[] }
  const lines = match[1].split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.trimStart().startsWith('#')) continue
    const m = FIELD_LINE_RE.exec(line)
    if (!m) continue
    const key = m[1].trim()
    const value = unquote(m[2])
    if (key === 'title') {
      title = value
      lineNumbers.title = index + 2
    } else {
      const start = index
      while (index + 1 < lines.length && (/^(?:\s+\S|-(?:\s|$)|#)/.test(lines[index + 1]) || !lines[index + 1].trim())) index++
      const field = parseField(key, m[2])
      if (index > start || m[2].trim().startsWith('[') || m[2].trim().startsWith('{')) {
        const source = lines.slice(start, index + 1).join('\n')
        const parsed = parseDocument(source)
        if (!parsed.errors.length) {
          const value = parsed.toJS()?.[key]
          field.value = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
        }
        field.source = { key, value: field.value, yaml: source }
      }
      fields.push(field)
      lineNumbers.fields.push(start + 2)
    }
  }
  if (title === undefined) return { frontmatter: null, body: content }

  return { frontmatter: { title, fields }, body: content.slice(match[0].length), lineNumbers }
}

export function joinFrontmatter(frontmatter: FrontmatterData, body: string): string {
  const lines = [`title: ${quote(frontmatter.title)}`]
  for (const f of frontmatter.fields) {
    const settings = f.type ? ` # mew:field ${JSON.stringify({ type: f.type, ...(f.options ? { options: f.options } : {}) })}` : ''
    if (f.source && f.source.key === f.key && f.source.value === f.value && !f.type) {
      lines.push(f.source.yaml)
      continue
    }
    lines.push(`${f.key}: ${quote(f.value)}${settings}`)
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
