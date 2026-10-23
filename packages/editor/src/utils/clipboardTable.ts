import { TextSelection, type Selection } from '@tiptap/pm/state'

/** 한 셀 안에서 선택한 글자는 표의 Markdown/HTML 래퍼 없이 복사한다. */
export function selectedTableCellText(selection: Selection): string | null {
  if (!(selection instanceof TextSelection) || selection.empty) return null
  const { $from, $to } = selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name
    if (name !== 'tableCell' && name !== 'tableHeader') continue
    if ($to.depth < depth || $from.start(depth) !== $to.start(depth)) return null
    return $from.doc.textBetween(selection.from, selection.to, '\n', node =>
      node.type.name === 'hardBreak' ? '\n' : (node.type.spec.leafText?.(node) ?? ''),
    )
  }
  return null
}
