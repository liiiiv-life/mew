import type { Editor } from '@tiptap/core'
import { TextSelection, type Selection, type Transaction } from '@tiptap/pm/state'
import { scanAnnotations } from './annotations.ts'
import { readEditorClipboard, writeEditorClipboard, type EditorContextTarget } from './contextTarget.ts'

export function prepareProseMirrorContext(editor: Editor, x: number, y: number): EditorContextTarget | null {
  if (editor.isDestroyed) return null
  const view = editor.view
  const element = view.dom.ownerDocument.elementFromPoint?.(x, y)
  if (element?.closest('input, textarea, select, button, [role="dialog"], [role="menu"]')) return null
  const bounds = view.dom.getBoundingClientRect()
  const annotations = scanAnnotations(editor.state.doc)
  const trailingSection = annotations.sections.find((section) => section.to === editor.state.doc.content.size)
  const visibleEnd = trailingSection ? Math.max(0, trailingSection.from - 1) : editor.state.doc.content.size
  const hit = view.posAtCoords({ left: Math.max(bounds.left + 1, Math.min(x, bounds.right - 1)), top: Math.max(bounds.top + 1, Math.min(y, bounds.bottom - 1)) })
  let pos = Math.max(0, Math.min(y < bounds.top ? 0 : y > bounds.bottom ? visibleEnd : hit?.pos ?? visibleEnd, editor.state.doc.content.size))
  const hiddenSection = annotations.sections.find((section) => pos >= section.from && pos < section.to)
  if (hiddenSection) pos = Math.max(0, hiddenSection.from - 1)
  const selected = editor.state.selection
  if (selected.empty || pos < selected.from || pos > selected.to) {
    view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))))
  }
  let bookmark = editor.state.selection.getBookmark()
  let disposed = false
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (!disposed && transaction.docChanged) bookmark = bookmark.map(transaction.mapping)
  }
  editor.on('transaction', onTransaction)
  const active = () => !disposed && !editor.isDestroyed
  const selection = (): Selection | null => {
    if (!active()) return null
    try { return bookmark.resolve(editor.state.doc) }
    catch { return null }
  }
  const restoreSelection = () => {
    const current = selection()
    if (!current) return false
    if (!current.eq(editor.state.selection)) view.dispatch(editor.state.tr.setSelection(current))
    view.focus()
    return true
  }
  const currentText = () => {
    const current = selection()
    if (!current) return ''
    return current.empty ? current.$from.parent.textContent : editor.state.doc.textBetween(current.from, current.to, '\n')
  }
  const deleteSelection = () => {
    if (!active() || !editor.isEditable || !restoreSelection() || editor.state.selection.empty) return false
    view.dispatch(editor.state.tr.deleteSelection().scrollIntoView())
    return true
  }
  const copyContent = () => {
    if (!restoreSelection() || editor.state.selection.empty) return null
    const slice = editor.state.selection.content()
    const serialized = view.serializeForClipboard(slice)
    return { slice, text: serialized.text, html: serialized.dom.innerHTML }
  }
  return {
    hasSelection: !editor.state.selection.empty,
    editable: editor.isEditable,
    canComment: !!currentText().trim(),
    restoreSelection,
    selectCommentTarget() {
      if (!restoreSelection()) return false
      const current = editor.state.selection
      if (current.empty) {
        if (!current.$from.parent.isTextblock || !current.$from.parent.textContent.trim()) return false
        view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, current.$from.start(), current.$from.end())))
      }
      return !!editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n').trim()
    },
    async copy() {
      const content = copyContent()
      return !!content && await writeEditorClipboard(content)
    },
    async cut() {
      if (!active() || !editor.isEditable) return false
      const content = copyContent()
      if (!content || !await writeEditorClipboard(content) || !active() || !editor.isEditable) return false
      const current = selection()
      if (!current || !current.content().eq(content.slice)) return false
      return deleteSelection()
    },
    async paste() {
      if (!active() || !editor.isEditable) return false
      const content = await readEditorClipboard()
      if (!content || !active() || !editor.isEditable || !restoreSelection()) return false
      if (typeof DataTransfer !== 'undefined' && typeof ClipboardEvent !== 'undefined') {
        const data = new DataTransfer()
        data.setData('text/plain', content.text)
        if (content.html) data.setData('text/html', content.html)
        for (const file of content.files ?? []) data.items.add(file)
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
        const before = editor.state.doc
        view.dom.dispatchEvent(event)
        return event.defaultPrevented || editor.state.doc !== before
      }
      if (content.files?.length) return false
      return content.html ? view.pasteHTML(content.html) : view.pasteText(content.text)
    },
    deleteSelection,
    selectAll() {
      if (!active()) return false
      view.focus()
      return editor.commands.selectAll()
    },
    dispose() {
      if (disposed) return
      disposed = true
      editor.off('transaction', onTransaction)
    },
  }
}
