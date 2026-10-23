// 커서가 있는 "줄"에 클래스를 붙이는 장식 플러그인 — 왼쪽 거터의 Markdown 줄 번호를
// 그 줄만 밝게 하는 데 쓴다. 번호를 그리는 대상과 **정확히 같은 노드**를 골라야 한다:
// 최상위 블록 하나가 한 줄이고, 리스트 안에서는 항목(listItem)이 한 줄이다.
import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import MarkdownIt from 'markdown-it'
import { getIncrementalMarkdown, IncrementalMarkdownSerializer } from './incrementalMarkdown.ts'
import { virtualBlocksKey } from './virtualBlocks.ts'

export const LINE_FOCUS_CLASS = 'mew-line--focus'
export const lineFocusSourceKey = new PluginKey<LineFocusState>('lineFocus')

type LineFocusOptions = {
  getLineOffset?: () => number
  getSource?: () => string | undefined
}

type LineNumberAttr = { pos: number; lineNumbers: string; lineCount: number }
type SourceLineCandidate = { startLine: number; lineCount: number; kind: 'block' | 'code' | 'table' | 'list' }
type NumberedLine = { pos: number; size: number; depth: number; line: number; lineCount: number }
type LineFocusState = {
  source: string | undefined
  canonical: string
  raw: { source: string; candidates: SourceLineCandidate[] } | undefined
  offset: number
  lines: DecorationSet
  decorations: DecorationSet
}
const sourceMarkdown = new MarkdownIt({ html: true, linkify: false, typographer: false })

/**
 * 커서가 있는 줄 노드의 문서 위치. 리스트 안이면 가장 안쪽 항목, 아니면 최상위 블록이다.
 * 문서가 비었거나(깊이 0) 줄을 못 고르면 -1.
 */
export function focusedLinePos(state: EditorState): number {
  const $head = state.selection.$head
  // 손잡이 클릭처럼 블록 자체가 선택된 경우 — $head는 그 블록 **뒤**(깊이 0)를 가리키므로 from을 쓴다
  if ($head.depth < 1) return state.selection instanceof NodeSelection ? state.selection.from : -1
  // 가장 안쪽 항목이 그 줄이다 — 중첩 리스트에서 바깥 항목까지 밝아지면 안 된다
  for (let depth = $head.depth; depth >= 1; depth--)
    if (['listItem', 'taskItem'].includes($head.node(depth).type.name)) return $head.before(depth)
  return $head.before(1)
}

function isListContainer(node: PMNode): boolean {
  return node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList'
}

function lineRange(node: PMNode, pos: number): { from: number; to: number } {
  // 리스트 항목의 줄 번호는 항목 전체가 아니라 첫 블록(보통 paragraph)에 붙은 번호다.
  // 하위 리스트까지 범위에 넣으면 안쪽 항목만 선택해도 바깥 항목 번호가 같이 켜진다.
  if (!['listItem', 'taskItem'].includes(node.type.name)) return { from: pos, to: pos + node.nodeSize }
  const first = node.firstChild
  if (!first) return { from: pos, to: pos + node.nodeSize }
  return { from: pos, to: Math.min(pos + 1 + first.nodeSize, pos + node.nodeSize) }
}

function intersectsSelection(range: { from: number; to: number }, from: number, to: number): boolean {
  return from < range.to && to > range.from
}

/**
 * 선택 범위에 걸친 줄 노드들의 문서 위치. 선택이 비어 있으면 커서 한 줄만 돌려준다.
 * 줄 번호를 그리는 CSS 대상과 같은 노드만 돌려줘야 한다: 최상위 블록 / 리스트 항목.
 */
export function selectedLinePositions(state: EditorState): number[] {
  const { selection } = state
  if (selection.empty) {
    const pos = focusedLinePos(state)
    return pos < 0 ? [] : [pos]
  }

  const positions: number[] = []
  state.doc.descendants((node, pos, parent) => {
    const isLineNode = (node.type.name === 'listItem' || node.type.name === 'taskItem') || (parent === state.doc && !isListContainer(node))
    if (!isLineNode) return true
    if (intersectsSelection(lineRange(node, pos), selection.from, selection.to)) positions.push(pos)
    return true
  })
  return positions
}

function normalizedLineOffset(lineOffset: number): number {
  return Math.max(0, Math.floor(Number.isFinite(lineOffset) ? lineOffset : 0))
}

function fallbackLineNumberAttrs(doc: PMNode, lineOffset = 0): LineNumberAttr[] {
  let line = 1 + normalizedLineOffset(lineOffset)
  const attrs: LineNumberAttr[] = []

  doc.descendants((node, pos, parent) => {
    const isLineNode = (node.type.name === 'listItem' || node.type.name === 'taskItem') || (parent === doc && !isListContainer(node))
    if (!isLineNode) return true
    attrs.push({ pos, lineNumbers: String(line), lineCount: 1 })
    line++
    return true
  })

  return attrs
}

function sourceLineCandidates(source: string, lineOffset = 0): SourceLineCandidate[] {
  const candidates: SourceLineCandidate[] = []
  const offset = normalizedLineOffset(lineOffset)
  for (const token of sourceMarkdown.parse(source, {})) {
    if (!token.map) continue
    if (token.type === 'list_item_open') {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: 1, kind: 'list' })
    } else if (token.level === 0 && token.type === 'heading_open') {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: token.map[1] - token.map[0], kind: 'block' })
    } else if (token.level === 0 && token.type === 'paragraph_open') {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: token.map[1] - token.map[0], kind: 'block' })
    } else if (token.level === 0 && token.type === 'blockquote_open') {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: token.map[1] - token.map[0], kind: 'block' })
    } else if (token.level === 0 && (token.type === 'fence' || token.type === 'code_block')) {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: token.map[1] - token.map[0], kind: 'code' })
    } else if (token.level === 0 && token.type === 'table_open') {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: token.map[1] - token.map[0], kind: 'table' })
    } else if (token.level === 0 && token.type === 'hr') {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: 1, kind: 'block' })
    } else if (token.level === 0 && token.type === 'html_block' && token.content.replace(/<!--[\s\S]*?-->/g, '').trim()) {
      candidates.push({ startLine: token.map[0] + 1 + offset, lineCount: token.map[1] - token.map[0], kind: 'block' })
    }
  }
  return candidates
}

function sourceCandidateKind(node: PMNode): SourceLineCandidate['kind'] {
  if ((node.type.name === 'listItem' || node.type.name === 'taskItem')) return 'list'
  if (node.type.name === 'codeBlock') return 'code'
  if (node.type.name === 'table') return 'table'
  return 'block'
}

export function lineNumberAttrs(
  doc: PMNode,
  serialize?: (doc: PMNode) => string,
  lineOffset = 0,
  source?: string,
): LineNumberAttr[] {
  if (source !== undefined) return sourceLineNumberAttrs(doc, source, lineOffset)
  if (!serialize) return fallbackLineNumberAttrs(doc, lineOffset)

  // 저장과 같은 doc 문맥으로 직렬화해야 빈 문단·느슨한 목록·여러 줄 항목도 일치한다.
  return sourceLineNumberAttrs(doc, serialize(doc), lineOffset)
}

function sourceLineNumberAttrs(doc: PMNode, source: string, lineOffset = 0): LineNumberAttr[] {
  const candidates = sourceLineCandidates(source, lineOffset)
  const attrs: LineNumberAttr[] = []
  let index = 0

  doc.descendants((node, pos, parent) => {
    const isLineNode = (node.type.name === 'listItem' || node.type.name === 'taskItem') || (parent === doc && !isListContainer(node))
    if (!isLineNode) return true
    const kind = sourceCandidateKind(node)
    let nextIndex = index
    while (nextIndex < candidates.length && candidates[nextIndex].kind !== kind) nextIndex++
    const candidate = candidates[nextIndex]
    if (!candidate) {
      // 마지막 입력용 문단은 저장된 마지막 줄바꿈 다음의 빈 줄이다.
      if (parent === doc && node === doc.lastChild && node.type.name === 'paragraph' && !node.textContent) {
        const lastContentLine = source.trimEnd().split('\n').length + normalizedLineOffset(lineOffset)
        attrs.push({ pos, lineNumbers: String(source.trim() ? lastContentLine + 1 : 1 + normalizedLineOffset(lineOffset)), lineCount: 1 })
      }
      return true
    }
    index = nextIndex + 1
    // 번호는 원본 범위의 시작 줄에만 붙인다. 범위 안의 번호를 행 높이로 나열하면 긴 원본 한 줄이
    // 화면에서 접힐 때 다음 번호가 그 시각적 이어진 줄 옆에 붙어, 화면 줄을 md 줄로 오인하게 된다.
    attrs.push({
      pos,
      lineNumbers: String(candidate.startLine),
      lineCount: candidate.lineCount,
    })
    return true
  })

  return attrs
}

/**
 * 그 자리의 노드가 리스트 항목이면 중첩 깊이(맨 바깥이 1), 아니면 0.
 * 항목은 한 단마다 24px 들여쓰이므로, 거터의 줄 번호와 그 위에 포개지는 투명 손잡이를
 * 이 값만큼 왼쪽으로 되돌려 다른 줄과 같은 세로줄에 세운다 (editor.css의 li::before와 짝).
 */
export function listLevel(doc: PMNode, pos: number): number {
  if (pos < 0 || pos > doc.content.size) return 0
  if (!['listItem', 'taskItem'].includes(doc.nodeAt(pos)?.type.name ?? '')) return 0
  const $pos = doc.resolve(pos)
  let level = 1
  for (let depth = 1; depth <= $pos.depth; depth++) if (['listItem', 'taskItem'].includes($pos.node(depth).type.name)) level++
  return level
}

function lineNodes(doc: PMNode): { pos: number; node: PMNode; depth: number; tail: boolean }[] {
  const result: { pos: number; node: PMNode; depth: number; tail: boolean }[] = []
  const visit = (parent: PMNode, from: number, depth: number, top: boolean) => {
    parent.forEach((node, offset, index) => {
      const pos = from + offset
      const item = node.type.name === 'listItem' || node.type.name === 'taskItem'
      const nextDepth = depth + (item ? 1 : 0)
      if (item || (top && !isListContainer(node))) {
        result.push({ pos, node, depth: nextDepth, tail: top && index === parent.childCount - 1 })
      }
      if (node.childCount) visit(node, pos + 1, nextDepth, false)
    })
  }
  visit(doc, 0, 0, true)
  return result
}

function numberedLines(doc: PMNode, source: string, candidates: SourceLineCandidate[], offset: number): NumberedLine[] {
  let index = 0
  let lastContentLine: number | undefined
  return lineNodes(doc).flatMap(({ pos, node, depth, tail }) => {
    const kind = sourceCandidateKind(node)
    let nextIndex = index
    while (nextIndex < candidates.length && candidates[nextIndex].kind !== kind) nextIndex++
    const candidate = candidates[nextIndex]
    if (candidate) {
      index = nextIndex + 1
      return [{ pos, size: node.nodeSize, depth, line: candidate.startLine + offset, lineCount: candidate.lineCount }]
    }
    if (!tail || node.type.name !== 'paragraph' || node.textContent) return []
    lastContentLine ??= source.trimEnd().split('\n').length
    return [{ pos, size: node.nodeSize, depth, line: offset + (source.trim() ? lastContentLine + 1 : 1), lineCount: 1 }]
  })
}

function numberedDecoration(line: NumberedLine): Decoration {
  return Decoration.node(line.pos, line.pos + line.size, {
    'data-mew-line-numbers': String(line.line),
    style: `--mew-line-count: ${line.lineCount}; --mew-list-depth: ${line.depth};`,
  }, { line: line.line, lineCount: line.lineCount, depth: line.depth })
}

function updateLineDecorations(doc: PMNode, previous: DecorationSet, entries: NumberedLine[]): DecorationSet {
  const existing = previous.find()
  const byPosition = new Map(existing.map(decoration => [decoration.from, decoration]))
  const keep = new Set<Decoration>()
  const added: Decoration[] = []
  for (const line of entries) {
    const decoration = byPosition.get(line.pos)
    if (decoration && decoration.to === line.pos + line.size && decoration.spec.line === line.line
      && decoration.spec.lineCount === line.lineCount && decoration.spec.depth === line.depth) keep.add(decoration)
    else added.push(numberedDecoration(line))
  }
  const removed = existing.filter(decoration => !keep.has(decoration))
  const retained = removed.length ? previous.remove(removed) : previous
  return added.length ? retained.add(doc, added) : retained
}

function focusedDecorations(state: EditorState, lines: DecorationSet): DecorationSet {
  const focus = selectedLinePositions(state).flatMap((pos) => {
    const node = state.doc.nodeAt(pos)
    return node ? [Decoration.node(pos, pos + node.nodeSize, { class: LINE_FOCUS_CLASS })] : []
  })
  return focus.length ? lines.add(state.doc, focus) : lines
}

export function lineFocusPositionAtLine(state: EditorState, line: number): number | null {
  const current = lineFocusSourceKey.getState(state)
  if (!current || !Number.isFinite(line) || line < current.offset + 1) return null
  let first: { line: number; pos: number } | undefined
  let previous: { line: number; pos: number } | undefined
  for (const decoration of current.lines.find()) {
    const start = decoration.spec.line as number
    if (!first || start < first.line) first = { line: start, pos: decoration.from }
    if (start <= line && (!previous || start > previous.line)) previous = { line: start, pos: decoration.from }
  }
  return previous?.pos ?? first?.pos ?? null
}

export const LineFocus = Extension.create<LineFocusOptions>({
  name: 'lineFocus',
  addOptions() {
    return {
      getLineOffset: () => 0,
      getSource: () => undefined,
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    const options = this.options
    let fallbackSerializer: IncrementalMarkdownSerializer | undefined
    const serializer = () => {
      const incremental = getIncrementalMarkdown(editor)
      if (incremental) return incremental
      const markdown = (editor.storage as unknown as {
        markdown?: { serializer?: ConstructorParameters<typeof IncrementalMarkdownSerializer>[0] }
      }).markdown
      if (markdown?.serializer) fallbackSerializer ??= new IncrementalMarkdownSerializer(markdown.serializer)
      return fallbackSerializer
    }
    const blockCache = new WeakMap<PMNode, { text: string; lines: NumberedLine[]; lastLine: number; hasContent: boolean }>()
    let visibleCache: { source: DecorationSet; visible: Set<number>; blocks: object; result: DecorationSet } | undefined
    const canonicalLines = (doc: PMNode, offset: number): NumberedLine[] => {
      const blocks = serializer()?.blocks(doc)
      if (!blocks) {
        return fallbackLineNumberAttrs(doc, offset).map(attr => ({
          pos: attr.pos, size: doc.nodeAt(attr.pos)!.nodeSize, depth: listLevel(doc, attr.pos),
          line: Number(attr.lineNumbers), lineCount: attr.lineCount,
        }))
      }
      const entries: NumberedLine[] = []
      let lastContentLine = 0
      for (const block of blocks) {
        let cached = blockCache.get(block.node)
        if (!cached || cached.text !== block.text) {
          const blockDoc = doc.type.create(doc.attrs, block.node)
          const content = block.text.trimEnd()
          const leadingLines = /^\n*/.exec(block.text)![0].length
          const singleLine = ['paragraph', 'heading', 'horizontalRule'].includes(block.node.type.name)
            && block.text.length > leadingLines && !block.text.includes('\n', leadingLines)
          cached = {
            text: block.text,
            lines: singleLine
              ? [{ pos: 0, size: block.node.nodeSize, depth: 0, line: leadingLines + 1, lineCount: 1 }]
              : numberedLines(blockDoc, block.text, sourceLineCandidates(block.text), 0),
            lastLine: content.match(/\n/g)?.length ?? 0,
            hasContent: !!content,
          }
          blockCache.set(block.node, cached)
        }
        if (cached.hasContent) lastContentLine = block.sourceStartLine + cached.lastLine
        const tail = block.node === doc.lastChild && block.node.type.name === 'paragraph' && !block.node.textContent
        for (const line of cached.lines) {
          entries.push({
            ...line,
            pos: block.from + line.pos,
            line: offset + (tail && !cached.hasContent ? lastContentLine + 1 : block.sourceStartLine - 1 + line.line),
          })
        }
      }
      return entries
    }
    const createState = (state: EditorState): LineFocusState => {
      const source = options.getSource?.()
      const offset = normalizedLineOffset(options.getLineOffset?.() ?? 0)
      const canonical = serializer()?.serialize(state.doc) ?? ''
      const canonicalEntries = canonicalLines(state.doc, offset)
      const raw = source === undefined ? undefined : { source, candidates: sourceLineCandidates(source) }
      const entries = raw ? numberedLines(state.doc, raw.source, raw.candidates, offset) : canonicalEntries
      const lines = DecorationSet.create(state.doc, entries.map(numberedDecoration))
      return { source, canonical, raw, offset, lines, decorations: focusedDecorations(state, lines) }
    }
    return [
      new Plugin<LineFocusState>({
        key: lineFocusSourceKey,
        state: {
          init: (_config, state) => createState(state),
          apply: (transaction, previous, oldState, state) => {
            const refresh = transaction.getMeta(lineFocusSourceKey) as { source?: string; offset?: number } | undefined
            const explicitSource = refresh !== undefined && Object.hasOwn(refresh, 'source')
            const source = explicitSource ? refresh!.source : options.getSource?.()
            const offset = normalizedLineOffset(refresh?.offset ?? options.getLineOffset?.() ?? 0)
            const sourceChanged = source !== previous.source
            const echo = sourceChanged && source === previous.canonical
            const external = explicitSource || (sourceChanged && !echo)
            const docChanged = transaction.docChanged && !oldState.doc.eq(state.doc)
            if (!docChanged && !external && offset === previous.offset) {
              const sameFocus = oldState.selection.empty && state.selection.empty
                && focusedLinePos(oldState) === focusedLinePos(state)
              return sourceChanged || !oldState.selection.eq(state.selection)
                ? { ...previous, source, decorations: sameFocus ? previous.decorations : focusedDecorations(state, previous.lines) }
                : previous
            }
            const canonical = docChanged ? serializer()?.serialize(state.doc) ?? '' : previous.canonical
            const raw = external
              ? source === undefined ? undefined : { source, candidates: sourceLineCandidates(source) }
              : previous.raw && previous.canonical.trimEnd() === canonical.trimEnd() ? previous.raw : undefined
            const entries = raw ? numberedLines(state.doc, raw.source, raw.candidates, offset) : canonicalLines(state.doc, offset)
            const mapped = previous.lines.map(transaction.mapping, state.doc)
            const lines = updateLineDecorations(state.doc, mapped, entries)
            return { source, canonical, raw, offset, lines, decorations: focusedDecorations(state, lines) }
          },
        },
        props: {
          decorations(state) {
            const current = lineFocusSourceKey.getState(state)
            if (!current) return null
            const virtual = virtualBlocksKey.getState(state)
            if (!virtual?.active) return current.decorations
            if (visibleCache?.source === current.decorations && visibleCache.blocks === virtual.blocks
              && (visibleCache.visible === virtual.visible || (visibleCache.visible.size === virtual.visible.size
                && [...virtual.visible].every(pos => visibleCache!.visible.has(pos))))) return visibleCache.result
            const decorations: Decoration[] = []
            for (const pos of virtual.visible) {
              let low = 0, high = virtual.blocks.length - 1
              while (low <= high) {
                const middle = (low + high) >>> 1
                const block = virtual.blocks[middle]
                if (block.pos < pos) low = middle + 1
                else if (block.pos > pos) high = middle - 1
                else {
                  const end = pos + block.node.nodeSize
                  decorations.push(...current.decorations.find(pos, end)
                    .filter(decoration => decoration.from >= pos && decoration.to <= end))
                  break
                }
              }
            }
            const result = DecorationSet.create(state.doc, decorations)
            visibleCache = { source: current.decorations, blocks: virtual.blocks, visible: virtual.visible, result }
            return result
          },
        },
      }),
    ]
  },
})
