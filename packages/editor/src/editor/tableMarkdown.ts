import { Table } from '@tiptap/extension-table'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'

// ── 표 마크다운 직렬화 (tiptap-markdown 기본을 두 가지만 고친 것) ──────────────
// 1) 셀 안 문단 여러 개는 <br>로 이어 파이프 표를 유지한다 — 기본 구현은 문단 2개만 돼도
//    표 전체를 HTML로 덤프해 md 파일이 더러워진다 (셀에서 Enter 한 번이면 재현).
// 2) 그래도 HTML로 갈 수밖에 없는 구조(병합 셀·헤더 없는 표)는 colwidth를 벗기고 낸다 —
//    열 너비는 .mew/table-layout.json이 담당하는 레이아웃이라 md에 남기지 않는다.
// 클라이언트(Editor.tsx)와 서버(serverExtensions.ts)가 반드시 같이 써야 협업 병합에서
// 문서가 재포맷되지 않는다.

type SerializerState = {
  write(text: string): void
  ensureNewLine(): void
  closeBlock(node: PMNode): void
  renderInline(node: PMNode): void
  inTable: boolean
}

function hasSpan(cell: PMNode): boolean {
  return (cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1
}

function cellIsInlineable(cell: PMNode): boolean {
  let ok = cell.childCount > 0
  cell.forEach((child) => {
    if (child.type.name !== 'paragraph') ok = false
  })
  return ok
}

// tiptap-markdown의 판정에서 "문단 여러 개" 금지만 "문단 아닌 블록 금지"로 완화한 것
function isPipeSerializable(table: PMNode): boolean {
  let ok = true
  table.forEach((row, _offset, i) => {
    row.forEach((cell) => {
      const wantHeader = i === 0
      if ((cell.type.name === 'tableHeader') !== wantHeader) ok = false
      if (hasSpan(cell) || !cellIsInlineable(cell)) ok = false
    })
  })
  return ok
}

function stripColwidth(table: PMNode): PMNode {
  const json = table.toJSON() as { content?: Array<{ content?: Array<{ attrs?: Record<string, unknown> }> }> }
  for (const row of json.content ?? []) {
    for (const cell of row.content ?? []) {
      if (cell.attrs) cell.attrs = { ...cell.attrs, colwidth: null }
    }
  }
  return table.type.schema.nodeFromJSON(json)
}

export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          if (!isPipeSerializable(node)) {
            const dom = DOMSerializer.fromSchema(node.type.schema).serializeNode(stripColwidth(node)) as unknown as {
              outerHTML: string
            }
            state.write(dom.outerHTML)
            state.closeBlock(node)
            return
          }
          state.inTable = true
          node.forEach((row, _offset, i) => {
            state.write('| ')
            row.forEach((cell, _cellOffset, j) => {
              if (j) state.write(' | ')
              cell.forEach((para, _paraOffset, k) => {
                if (k) state.write('<br>')
                if (para.textContent.trim()) state.renderInline(para)
              })
            })
            state.write(' |')
            state.ensureNewLine()
            if (!i) {
              state.write(`| ${Array.from({ length: row.childCount }, () => '---').join(' | ')} |`)
              state.ensureNewLine()
            }
          })
          state.closeBlock(node)
          state.inTable = false
        },
        // parse는 없음 — tiptap-markdown이 기본 Table 스펙의 parse(markdown-it)와 병합해 준다
      },
    }
  },
})
