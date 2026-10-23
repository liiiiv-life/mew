import MarkdownIt from 'markdown-it'

export interface SourceAnnotation { num: number; content: string }
interface Span { from: number; to: number }
interface Marker extends Span { num: number }
interface Entry extends Span, SourceAnnotation { raw: string }
interface Section extends Span { headingTo: number; list: Span | null; entries: Entry[] }
interface Scan { markers: Marker[]; section: Section | null; protected: Span[]; newline: string }
interface Edit extends Span { text: string }

const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false })
markdown.inline.ruler.before('emphasis', 'mew_source_annotation', (state, silent) => {
  const match = /^\^\[([1-9]\d*)\]/.exec(state.src.slice(state.pos))
  if (!match || !Number.isSafeInteger(Number(match[1]))) return false
  if (!silent) {
    const token = state.push('mew_source_annotation', '', 0)
    token.content = match[0]
    token.meta = { num: Number(match[1]), offset: state.pos }
  }
  state.pos += match[0].length
  return true
})

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1)
  return starts
}

function frontmatterEnd(text: string): number {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text)
  if (!match) return 0
  const end = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm
  end.lastIndex = match[0].length
  const closing = end.exec(text)
  return closing ? closing.index + closing[0].length : text.length
}

function inlineText(tokens: ReturnType<typeof markdown.parse>): string {
  let result = ''
  for (const token of tokens) {
    if (token.type === 'softbreak' || token.type === 'hardbreak') result += '\n'
    else if (token.type === 'image') result += token.content
    else if (token.type === 'html_inline' && /^<br\s*\/?\s*>$/i.test(token.content)) continue
    else if (token.type === 'text' || token.type === 'code_inline' || token.type === 'html_inline') result += token.content
    else if (token.type === 'mew_source_annotation') result += token.content
    else if (token.children) result += inlineText(token.children)
  }
  return result
}

function tableLineSource(line: string): { content: string; positions: number[] } {
  let content = ''
  const positions: number[] = []
  for (let index = 0; index < line.length; index++) {
    // markdown-it removes the backslash before a table cell's escaped pipe.
    if (line[index] === '\\' && line[index + 1] === '|') continue
    content += line[index]
    positions.push(index)
  }
  return { content, positions }
}

function scanSource(text: string): Scan {
  const starts = lineStarts(text)
  const offset = (line: number) => starts[line] ?? text.length
  const frontmatterTo = frontmatterEnd(text)
  // Blank the frontmatter without changing source line numbers.
  const source = text.slice(0, frontmatterTo).replace(/[^\r\n]/g, ' ') + text.slice(frontmatterTo)
  const tokens = markdown.parse(source, {})
  const protectedSpans: Span[] = frontmatterTo ? [{ from: 0, to: frontmatterTo }] : []
  let section: Section | null = null
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.type !== 'heading_open' || token.level !== 0 || !token.map) continue
    if (section) { section.to = offset(token.map[0]); break }
    if (token.tag === 'h1' && tokens[index + 1]?.content === '$Annotations$') {
      section = { from: offset(token.map[0]), to: text.length, headingTo: offset(token.map[1]), list: null, entries: [] }
    }
  }
  // Code after an annotation section is still protected.
  for (const token of tokens) {
    if ((token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') && token.map) {
      protectedSpans.push({ from: offset(token.map[0]), to: offset(token.map[1]) })
    }
  }
  if (section) {
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      if (token.type !== 'ordered_list_open' || token.level !== 0 || !token.map) continue
      const from = offset(token.map[0])
      if (from < section.headingTo || from >= section.to) continue
      section.list = { from, to: offset(token.map[1]) }
      const start = Number(token.attrGet('start')) || 1
      for (let itemIndex = index + 1; itemIndex < tokens.length; itemIndex++) {
        const item = tokens[itemIndex]
        if (item.type === 'ordered_list_close' && item.level === 0) break
        if (item.type !== 'list_item_open' || item.level !== 1 || !item.map) continue
        const from = offset(item.map[0])
        const to = offset(item.map[1])
        const parts: string[] = []
        for (let childIndex = itemIndex + 1; childIndex < tokens.length; childIndex++) {
          const child = tokens[childIndex]
          if (child.type === 'list_item_close' && child.level === 1) break
          if (child.type === 'inline') parts.push(inlineText(child.children ?? []))
          else if (child.type === 'fence' || child.type === 'code_block') parts.push(child.content.replace(/\n$/, ''))
          else if (child.type === 'html_block') parts.push(/^<br\s*\/?\s*>\s*$/i.test(child.content) ? '' : child.content.trimEnd())
        }
        section.entries.push({ from, to, raw: text.slice(from, to), num: start + section.entries.length, content: parts.join('\n') })
      }
      break
    }
  }
  const markers: Marker[] = []
  let row: [number, number] | null = null
  let rowCursor = 0
  for (const token of tokens) {
    if (token.type === 'tr_open' && token.map) { row = token.map; rowCursor = offset(row[0]) }
    if (token.type !== 'inline') continue
    const map = token.map ?? row
    if (!map) continue
    const contentLines = token.content.split('\n')
    for (const child of token.children ?? []) {
      if (child.type !== 'mew_source_annotation') continue
      const local = Number(child.meta.offset)
      const preceding = token.content.slice(0, local)
      const lineIndex = preceding.split('\n').length - 1
      const column = local - (preceding.lastIndexOf('\n') + 1)
      const lineFrom = offset(map[0] + lineIndex)
      const lineTo = offset(map[0] + lineIndex + 1)
      const originalLine = text.slice(lineFrom, lineTo).replace(/\r?\n$/, '')
      const localLine = contentLines[lineIndex]
      const table = token.map ? null : tableLineSource(originalLine)
      const searchFrom = table ? table.positions.findIndex((position) => position >= rowCursor - lineFrom) : 0
      const prefix = (table?.content ?? originalLine).indexOf(localLine, Math.max(0, searchFrom))
      if (prefix < 0) continue
      const from = lineFrom + (table?.positions[prefix + column] ?? prefix + column)
      const to = from + child.content.length
      if (section && from >= section.from && from < section.to) continue
      markers.push({ from, to, num: Number(child.meta.num) })
    }
    if (!token.map && row) {
      const rowFrom = offset(row[0])
      const table = tableLineSource(text.slice(rowFrom, offset(row[1])))
      const searchFrom = table.positions.findIndex((position) => position >= rowCursor - rowFrom)
      const found = table.content.indexOf(token.content, Math.max(0, searchFrom))
      if (found >= 0) rowCursor = rowFrom + (table.positions[found + token.content.length - 1] ?? found) + 1
    }
  }
  // Inline code offsets also guard insertion even when there are no markers nearby.
  const inlineRanges = tokens.filter((token) => (token.type === 'inline' || token.type === 'tr_open') && token.map)
    .map((token) => ({ from: offset(token.map![0]), to: offset(token.map![1]) }))
  const code = /`+/g
  for (let match = code.exec(text); match; match = code.exec(text)) {
    const from = match.index
    if (protectedSpans.some((span) => from >= span.from && from < span.to)) continue
    const range = inlineRanges.find((span) => from >= span.from && from < span.to)
    if (!range) continue
    let slashes = 0
    for (let at = from - 1; at >= 0 && text[at] === '\\'; at--) slashes++
    if (slashes % 2) continue
    const close = new RegExp('`+', 'g')
    close.lastIndex = code.lastIndex
    for (let end = close.exec(text); end; end = close.exec(text)) {
      if (end.index >= range.to) break
      if (end[0].length !== match[0].length) continue
      protectedSpans.push({ from, to: end.index + end[0].length })
      code.lastIndex = end.index + end[0].length
      break
    }
  }
  return { markers, section, protected: protectedSpans, newline: text.includes('\r\n') ? '\r\n' : '\n' }
}

function applyEdits(text: string, edits: Edit[]): string {
  for (const edit of edits.sort((a, b) => b.from - a.from || b.to - a.to)) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
  return text
}

function escapeText(text: string): string {
  return text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&')
}

function serializeEntry(num: number, text: string, newline: string): string {
  const indent = ' '.repeat(String(num).length + 2)
  return text.replace(/\r\n?/g, '\n').split('\n').map((line, index) => {
    const escaped = escapeText(line).replace(/^[ \t]+|[ \t]+$/g, (spaces) => [...spaces].map((char) => char === '\t' ? '&#9;' : '&#32;').join(''))
    return `${index ? indent : `${num}. `}${line ? escaped : '<br/>'}`
  }).join(newline + newline)
}

function numberedRaw(entry: Entry, num: number): string {
  const match = /^( {0,3})(\d+)([.)])([ \t]*)([^]*)$/.exec(entry.raw)
  if (!match) return entry.raw
  const delta = String(num).length - match[2].length
  const tail = delta ? match[5].replace(/(\r?\n)( +)(?=\S)/g, (_all, newline: string, indent: string) => `${newline}${' '.repeat(Math.max(0, indent.length + delta))}`) : match[5]
  return `${match[1]}${num}${match[3]}${match[4]}${tail}`
}

function normalize(text: string, scan: Scan, removed = new Set<number>(), replacements = new Map<number, string>()): string {
  const entries = scan.section?.entries ?? []
  const used = new Set<number>()
  const ordered: { entry?: Entry; content?: string }[] = []
  const edits: Edit[] = []
  for (const marker of scan.markers) {
    if (removed.has(marker.num)) { edits.push({ ...marker, text: '' }); continue }
    const entry = entries.find((entry) => entry.num === marker.num)
    const num = ordered.length + 1
    ordered.push({ entry, content: replacements.get(marker.num) })
    if (entry) used.add(entry.num)
    if (marker.num !== num) edits.push({ ...marker, text: `^[${num}]` })
  }
  for (const entry of entries) if (!used.has(entry.num) && !removed.has(entry.num)) ordered.push({ entry, content: replacements.get(entry.num) })
  const list = ordered.map(({ entry, content }, index) => {
    if (content === undefined && entry) return numberedRaw(entry, index + 1)
    const ending = entry?.raw.match(/(?:\r?\n[ \t]*)*$/)?.[0] ?? scan.newline
    return serializeEntry(index + 1, content ?? '', scan.newline) + ending
  }).map((raw, index) => index < ordered.length - 1 && !raw.endsWith('\n') ? raw + scan.newline : raw).join('')
  const section = scan.section
  if (section) {
    const remainder = text.slice(section.headingTo, section.list?.from ?? section.to) + (section.list ? text.slice(section.list.to, section.to) : '')
    if (!list && !remainder.trim()) edits.push({ from: section.from, to: section.to, text: '' })
    else if (section.list) edits.push({ ...section.list, text: list })
    else if (list) edits.push({ from: section.headingTo, to: section.headingTo, text: scan.newline + list + scan.newline })
  } else if (list) {
    const separator = !text ? '' : text.endsWith(scan.newline + scan.newline) ? '' : text.endsWith(scan.newline) ? scan.newline : scan.newline + scan.newline
    edits.push({ from: text.length, to: text.length, text: `${separator}# $Annotations$${scan.newline}${scan.newline}${list}` })
  }
  return applyEdits(text, edits)
}

export function readSourceAnnotations(text: string): SourceAnnotation[] {
  if (!text.includes('$Annotations$')) return []
  return (scanSource(text).section?.entries ?? []).map(({ num, content }) => ({ num, content }))
}

export function findSourceAnnotation(text: string, num: number): number | null {
  return scanSource(text).markers.find((marker) => marker.num === num)?.from ?? null
}

/** A metadata edit keeps this identity; replacing or renumbering body markers changes it. */
export function sourceAnnotationIdentity(text: string, num: number): string | null {
  const scan = scanSource(text)
  const marker = scan.markers.find((marker) => marker.num === num)
  if (!marker) return null
  const section = scan.section
  const body = section ? text.slice(0, section.from) + text.slice(section.to) : text
  const bodyOffset = (at: number) => section && at >= section.to ? at - (section.to - section.from) : at
  const markers = scan.markers.map((item) => [item.num, bodyOffset(item.from), bodyOffset(item.to)])
  const last = scan.markers[scan.markers.length - 1]
  return JSON.stringify([num, bodyOffset(marker.from), markers, body.slice(0, bodyOffset(last.to))])
}

/** Returns null inside code, frontmatter, or the annotation metadata section. */
export function insertSourceAnnotation(text: string, at: number): { content: string; num: number; at: number } | null {
  const scan = scanSource(text)
  if (!Number.isInteger(at) || at < 0 || at > text.length || scan.protected.some((span) => at >= span.from && at < span.to) || (scan.section && at >= scan.section.from && at < scan.section.to)) return null
  const oldNum = Math.max(0, ...scan.markers.map((marker) => marker.num), ...(scan.section?.entries.map((entry) => entry.num) ?? [])) + 1
  if (!Number.isSafeInteger(oldNum)) return null
  const inserted = text.slice(0, at) + `^[${oldNum}]` + text.slice(at)
  const insertedScan = scanSource(inserted)
  const index = insertedScan.markers.findIndex((marker) => marker.from === at && marker.num === oldNum)
  if (index < 0) return null
  const content = normalize(inserted, insertedScan)
  const num = index + 1
  const marker = scanSource(content).markers.find((marker) => marker.num === num)
  return { content, num, at: marker?.to ?? at }
}

export function updateSourceAnnotation(text: string, num: number, content: string): string {
  const scan = scanSource(text)
  if (!scan.markers.some((marker) => marker.num === num) && !scan.section?.entries.some((entry) => entry.num === num)) return text
  return normalize(text, scan, new Set(), new Map([[num, content]]))
}

export function deleteSourceAnnotation(text: string, num: number): string {
  const scan = scanSource(text)
  if (!scan.markers.some((marker) => marker.num === num) && !scan.section?.entries.some((entry) => entry.num === num)) return text
  return normalize(text, scan, new Set([num]))
}
