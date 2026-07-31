import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { TableWidths } from '../types'

// ── 표 열 너비 (마크다운 밖 레이아웃) ────────────────────────────────────────
// md 표는 열 너비를 담지 못하고, HTML <table>로 바꾸면 plain 모드가 지저분해진다. 그래서 본문은
// 순수 md로 두고 너비만 호스트(api.fetchTableLayout/saveTableLayout)가 프로젝트의 .mew/에 저장한다.
// 표는 "문서 안 등장 순서"로만 식별하므로 표를 추가·삭제하면 어긋날 수 있다 — 다시 끌면 덮어써진다.
// 0은 "그 열은 아직 조절 안 함"이다(prosemirror-tables는 실제로 끌린 열에만 colwidth를 심는다).

/** 문서 안 모든 표의 열 너비를 등장 순서대로 읽는다 — 첫 행이 열 구성을 대표한다 */
export function readTableWidths(doc: PMNode): TableWidths {
  const out: TableWidths = []
  doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    const widths: number[] = []
    node.firstChild?.forEach((cell) => {
      const colwidth = cell.attrs.colwidth as number[] | null
      const span: number = cell.attrs.colspan ?? 1
      for (let i = 0; i < span; i++) widths.push(colwidth?.[i] ?? 0)
    })
    out.push(widths.some((w) => w > 0) ? widths : null)
    return false // 중첩 표는 다루지 않는다
  })
  while (out.length && out[out.length - 1] === null) out.pop()
  return out
}

/**
 * 저장된 너비를 현재 문서의 표들에 입히는 트랜잭션을 만든다 — 바꿀 게 없으면 null.
 * 열 단위 너비는 그 열의 **모든 행**의 셀에 들어가야 prosemirror-tables가 일관되게 본다.
 */
export function tableWidthsTransaction(state: EditorState, widths: TableWidths): Transaction | null {
  const tr = state.tr
  let tableIndex = 0
  let changed = false
  state.doc.descendants((table, tablePos) => {
    if (table.type.name !== 'table') return true
    const saved = widths[tableIndex++]
    if (!saved?.length) return false
    table.forEach((row, rowOffset) => {
      let col = 0
      row.forEach((cell, cellOffset) => {
        const span: number = cell.attrs.colspan ?? 1
        const next = saved.slice(col, col + span)
        col += span
        if (next.length !== span || next.some((w) => !w)) return // 저장 안 된 열은 건드리지 않는다
        const current = cell.attrs.colwidth as number[] | null
        if (current && current.length === span && current.every((w, i) => w === next[i])) return
        // 셀 위치 = 표 content 시작(+1) + 행 offset + 행 content 시작(+1) + 셀 offset
        tr.setNodeAttribute(tablePos + 1 + rowOffset + 1 + cellOffset, 'colwidth', next)
        changed = true
      })
    })
    return false
  })
  if (!changed) return null
  return tr.setMeta('addToHistory', false) // 복원은 사용자의 되돌리기 대상이 아니다
}

export function docHasTable(doc: PMNode): boolean {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === 'table') found = true
    return !found
  })
  return found
}
