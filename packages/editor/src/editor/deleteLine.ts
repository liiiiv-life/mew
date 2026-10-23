import { Extension, type Editor } from '@tiptap/core'

// Shift+Ctrl+Backspace — 커서가 있는 줄을 통째로 지운다. 일반 블록은 deleteRange가 빈 껍데기가 되는
// 부모(리스트 항목, 항목 하나뿐인 리스트)까지 알아서 함께 지워 준다. 커서는 지워진 자리 근처에 남는다.
export function deleteCurrentLine(editor: Editor): boolean {
  const { state } = editor
  const { $from } = state.selection
  const tr = state.tr

  if ($from.parent.type.name === 'codeBlock') {
    // 코드블록은 블록 하나가 여러 줄 — 커서가 있는 텍스트 한 줄만 개행까지 지운다
    const text = $from.parent.textContent
    const offset = $from.parentOffset
    const lineStart = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
    const nl = text.indexOf('\n', offset)
    // 마지막 줄이면 앞 개행을 함께 지워 빈 줄이 남지 않게 한다
    const from = nl === -1 && lineStart > 0 ? lineStart - 1 : lineStart
    const to = nl === -1 ? text.length : nl + 1
    if (from < to) tr.delete($from.start() + from, $from.start() + to)
  } else if (editor.isActive('table')) {
    // 표 안: 셀을 지우면 열이 밀리므로 줄 내용만 비운다
    if ($from.parent.content.size) tr.delete($from.start(), $from.end())
  } else {
    tr.deleteRange($from.before(), $from.after())
  }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export const DeleteLine = Extension.create({
  name: 'deleteLine',
  addKeyboardShortcuts() {
    return { 'Shift-Mod-Backspace': () => deleteCurrentLine(this.editor) }
  },
})
