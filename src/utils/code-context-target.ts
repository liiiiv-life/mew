import { EditorSelection, type ChangeDesc } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { clipboardPlainText, readEditorClipboard, writeEditorClipboard, type EditorContextTarget } from '@mew/editor/context-target'

export interface CodeContextSession {
  target: EditorContextTarget
  map(changes: ChangeDesc): void
}

export function prepareCodeContext(view: EditorView, x: number, y: number, isCurrent: () => boolean, onDispose: () => void): CodeContextSession {
  const bounds = view.contentDOM.getBoundingClientRect()
  const position = y < bounds.top ? 0 : y > bounds.bottom ? view.state.doc.length
    : view.posAtCoords({ x: Math.max(bounds.left + 1, Math.min(x, bounds.right - 1)), y }, false) ?? view.state.selection.main.head
  if (!view.state.selection.ranges.some((range) => !range.empty && position >= range.from && position <= range.to)) {
    view.dispatch({ selection: { anchor: position } })
  }
  let savedSelection = view.state.selection
  let disposed = false
  const active = () => !disposed && isCurrent()
  const restoreSelection = () => {
    if (!active()) return false
    if (!savedSelection.eq(view.state.selection)) view.dispatch({ selection: savedSelection })
    view.focus()
    return true
  }
  const selectedText = () => savedSelection.ranges.filter((range) => !range.empty).map((range) => view.state.sliceDoc(range.from, range.to)).join(view.state.lineBreak)
  const deleteSelection = () => {
    if (!active() || view.state.readOnly || !savedSelection.ranges.some((range) => !range.empty) || !restoreSelection()) return false
    view.dispatch({ ...view.state.replaceSelection(''), userEvent: 'delete.selection', scrollIntoView: true })
    return true
  }
  const current = savedSelection.main
  const commentText = current.empty ? view.state.doc.lineAt(current.head).text : view.state.sliceDoc(current.from, current.to)
  return {
    map(changes) { if (!disposed) savedSelection = savedSelection.map(changes) },
    target: {
      hasSelection: savedSelection.ranges.some((range) => !range.empty),
      editable: !view.state.readOnly,
      canComment: !!commentText.trim(),
      restoreSelection,
      selectCommentTarget() {
        if (!restoreSelection()) return false
        const current = view.state.selection.main
        if (current.empty) {
          const line = view.state.doc.lineAt(current.head)
          if (!line.text.trim()) return false
          view.dispatch({ selection: { anchor: line.from, head: line.to } })
        }
        return !!view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to).trim()
      },
      async copy() {
        if (!active() || !savedSelection.ranges.some((range) => !range.empty) || !restoreSelection()) return false
        return writeEditorClipboard({ text: selectedText() })
      },
      async cut() {
        if (!active() || view.state.readOnly || !savedSelection.ranges.some((range) => !range.empty) || !restoreSelection()) return false
        const text = selectedText()
        if (!await writeEditorClipboard({ text }) || !active() || view.state.readOnly || selectedText() !== text) return false
        return deleteSelection()
      },
      async paste() {
        if (!active() || view.state.readOnly) return false
        const content = await readEditorClipboard()
        if (!content || !active() || view.state.readOnly || !restoreSelection()) return false
        const text = clipboardPlainText(content)
        if (!text) return false
        view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.paste', scrollIntoView: true })
        view.focus()
        return true
      },
      deleteSelection,
      selectAll() {
        if (!active()) return false
        view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) })
        view.focus()
        return true
      },
      dispose() {
        if (disposed) return
        disposed = true
        onDispose()
      },
    },
  }
}
