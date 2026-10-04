// 커서가 있는 "줄"에 클래스를 붙이는 장식 플러그인 — 왼쪽 거터의 Markdown 줄 번호를
// 그 줄만 밝게 하는 데 쓴다. 번호를 그리는 대상과 **정확히 같은 노드**를 골라야 한다:
// 최상위 블록 하나가 한 줄이고, 리스트 안에서는 항목(listItem)이 한 줄이다.
import { createNodeFromContent, Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import MarkdownIt from 'markdown-it'

export const LINE_FOCUS_CLASS = 'mew-line--focus'

type LineFocusOptions = {
  getLineOffset?: () => number
  getSource?: () => string | undefined
}

type LineNumberAttr = { pos: number; lineNumbers: string; lineCount: number }
type SourceLineCandidate = { startLine: number; lineCount: number; kind: 'block' | 'code' | 'table' | 'list' }
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
    let sourceCache: { source: string; canonical: string } | undefined
    let lineCache: { doc: PMNode; source: string | undefined; offset: number; decorations: Decoration[] } | undefined
    return [
      new Plugin({
        key: new PluginKey('lineFocus'),
        props: {
          decorations(state) {
            const markdownStorage = editor.storage as {
              markdown?: {
                serializer?: { serialize: (doc: PMNode) => string }
                parser?: { parse: (source: string) => string }
              }
            }
            const serializer = markdownStorage.markdown?.serializer
            const source = options.getSource?.()
            const offset = options.getLineOffset?.() ?? 0
            if (!lineCache || lineCache.doc !== state.doc || lineCache.source !== source || lineCache.offset !== offset) {
              let currentSource = source
              const parser = markdownStorage.markdown?.parser
              if (serializer && parser && source !== undefined) {
                const serialized = serializer.serialize(state.doc)
                // onUpdate/React보다 decorations가 먼저 실행된다. 원문을 실제 스키마로 정규화해
                // 현재 문서와 같을 때만 원본 줄 간격을 쓴다. 다르면 이번 트랜잭션의 저장 내용을 쓴다.
                if (source === serialized) {
                  sourceCache = { source, canonical: serialized.trimEnd() }
                } else if (sourceCache?.source !== source) {
                  const parsed = createNodeFromContent(parser.parse(source), state.schema, { slice: false }) as PMNode
                  sourceCache = { source, canonical: serializer.serialize(parsed).trimEnd() }
                }
                if (source !== serialized && sourceCache?.canonical !== serialized.trimEnd()) currentSource = serialized
              }
              const decorations = lineNumberAttrs(
                state.doc,
                serializer ? (doc) => serializer.serialize(doc) : undefined,
                offset,
                currentSource,
              ).flatMap(({ pos, lineNumbers, lineCount }) => {
                const node = state.doc.nodeAt(pos)
                if (!node) return []
                return [
                  Decoration.node(pos, pos + node.nodeSize, {
                    'data-mew-line-numbers': lineNumbers,
                    style: `--mew-line-count: ${lineCount}; --mew-list-depth: ${listLevel(state.doc, pos)};`,
                  }),
                ]
              })
              lineCache = { doc: state.doc, source, offset, decorations }
            }
            const focusDecorations = selectedLinePositions(state).flatMap((pos) => {
              const node = state.doc.nodeAt(pos)
              return node ? [Decoration.node(pos, pos + node.nodeSize, { class: LINE_FOCUS_CLASS })] : []
            })
            const decorations = [...lineCache.decorations, ...focusDecorations]
            return decorations.length ? DecorationSet.create(state.doc, decorations) : null
          },
        },
      }),
    ]
  },
})
