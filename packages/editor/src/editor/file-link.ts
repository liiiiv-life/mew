import Link from '@tiptap/extension-link'
import type { LinkOptions } from '@tiptap/extension-link'
import { getMarkRange } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { isExternalHref } from '../utils/fuzzy.ts'

export const isFileLinkHref = (href: string) => {
  const value = href.trim()
  return value !== '' && !value.startsWith('#') && !value.startsWith('?') && !isExternalHref(value)
}

export interface FileLinkContext { path: string; docsRoot: string }

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

export function fileLinkKind(href: string, context?: FileLinkContext): 'document' | 'subdocument' | 'outside-docs' | null {
  if (!isFileLinkHref(href)) return null
  if (!context) return 'document'
  let decoded: string
  try { decoded = decodeURIComponent(href.trim().split(/[?#]/)[0]) } catch { return 'document' }
  const source = normalizePath(context.path)
  const directory = source.slice(0, source.lastIndexOf('/'))
  const target = normalizePath(decoded.startsWith('/') ? decoded : `${directory}/${decoded}`)
  const docsRoot = normalizePath(context.docsRoot)
  if (!target.startsWith(`${docsRoot === '/' ? '' : docsRoot}/`)) return 'outside-docs'
  const name = source.slice(source.lastIndexOf('/') + 1)
  const representative = name === `_${directory.split('/').at(-1)}.md` || name === 'MOC.md' || name === '_MOC.md'
  const childRoot = representative ? directory : source.replace(/\.md$/i, '')
  return target !== source && /\.md$/i.test(target) && target.startsWith(`${childRoot}/`) ? 'subdocument' : 'document'
}

// Derive presentation from href without adding persisted mark attributes or changing Markdown.
export const EditorLink = Link.extend<LinkOptions & { getFileLinkContext: () => FileLinkContext | undefined }>({
  addOptions() {
    return { ...this.parent!(), getFileLinkContext: () => undefined }
  },
  addProseMirrorPlugins() {
    const deleteLink = (view: EditorView, backward: boolean) => {
      const { selection, doc } = view.state
      if (!view.editable || !selection.empty) return false
      const adjacent = backward ? selection.$from.nodeBefore : selection.$from.nodeAfter
      const link = adjacent?.marks.find((mark) => mark.type === this.type)
      if (!link || !isFileLinkHref(link.attrs.href ?? '')) return false
      const range = getMarkRange(doc.resolve(backward ? selection.from - 1 : selection.from), this.type, link.attrs)
      if (!range) return false
      view.dispatch(view.state.tr.delete(range.from, range.to))
      return true
    }
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        view: (view) => {
          const update = () => {
            for (const anchor of view.dom.querySelectorAll('a[data-file-link]')) {
              const kind = fileLinkKind(anchor.getAttribute('href') ?? '', this.options.getFileLinkContext())
              if (kind && anchor.getAttribute('data-file-link-kind') !== kind) anchor.setAttribute('data-file-link-kind', kind)
            }
          }
          update()
          return { update }
        },
        props: {
          handleKeyDown: (view, event) => {
            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.altKey && !event.ctrlKey && !event.metaKey) {
              const { selection, doc } = view.state
              if (!(selection instanceof TextSelection) || (!selection.empty && !event.shiftKey)) return false
              const backward = event.key === 'ArrowLeft'
              const adjacent = backward ? selection.$head.nodeBefore : selection.$head.nodeAfter
              const link = adjacent?.marks.find(mark => mark.type === this.type)
              if (!link || !isFileLinkHref(link.attrs.href ?? '')) return false
              const range = getMarkRange(doc.resolve(backward ? selection.head - 1 : selection.head), this.type, link.attrs)
              if (!range) return false
              const next = backward ? range.from : range.to
              view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, event.shiftKey ? selection.anchor : next, next)).removeStoredMark(this.type).scrollIntoView())
              if (!event.shiftKey) {
                // A mark boundary can resolve to its text DOM, even though the
                // anchor is contenteditable=false. Keep the native caret outside.
                const native = view.dom.ownerDocument.getSelection()
                const node = native?.focusNode
                const element = node?.nodeType === 1 ? node as typeof view.dom : node?.parentElement
                const anchor = element?.closest('a[data-file-link]')
                if (native && anchor && view.dom.contains(anchor)) {
                  const caret = view.dom.ownerDocument.createRange()
                  if (backward) caret.setStartBefore(anchor)
                  else caret.setStartAfter(anchor)
                  caret.collapse(true)
                  native.removeAllRanges()
                  native.addRange(caret)
                }
              }
              return true
            }
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false
            return deleteLink(view, event.key === 'Backspace')
          },
          handleDOMEvents: {
            beforeinput: (view, event) => {
              const input = event as { inputType?: string }
              if (input.inputType !== 'deleteContentBackward' && input.inputType !== 'deleteContentForward') return false
              if (!deleteLink(view, input.inputType === 'deleteContentBackward')) return false
              event.preventDefault()
              return true
            },
          },
        },
        appendTransaction: (_transactions, oldState, state) => {
          const selection = state.selection
          if (!(selection instanceof TextSelection)) return null
          const ranges: { from: number; to: number; href: string }[] = []
          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            const link = node.marks.find((mark) => mark.type.name === this.name)
            if (!link || !isFileLinkHref(link.attrs.href ?? '')) return
            const previous = ranges.at(-1)
            if (previous?.to === pos && previous.href === link.attrs.href) previous.to += node.nodeSize
            else ranges.push({ from: pos, to: pos + node.nodeSize, href: link.attrs.href })
          })
          const snap = (pos: number, lower: boolean) => {
            const range = ranges.find(({ from, to }) => from < pos && pos < to)
            return range ? (lower ? range.from : range.to) : pos
          }
          // Treat the label as one item, including when navigating with arrow keys
          // or selecting across it. Deleting the whole link remains possible.
          const forward = selection.anchor <= selection.head
          const anchor = snap(selection.anchor, selection.empty ? selection.head < oldState.selection.head : forward)
          const head = selection.empty ? anchor : snap(selection.head, !forward)
          if (anchor === selection.anchor && head === selection.head) return null
          return state.tr.setSelection(TextSelection.create(state.doc, anchor, head)).removeStoredMark(this.type)
        },
      }),
    ]
  },
  renderHTML(props) {
    const href = String(props.HTMLAttributes.href ?? '').trim()
    const fileLink = isFileLinkHref(href)
    // Keep the standard Link renderer's URI validation and anchor semantics.
    return this.parent!({
      ...props,
      HTMLAttributes: {
        ...props.HTMLAttributes,
        'data-file-link': fileLink ? '' : null,
        'data-file-link-kind': fileLinkKind(href, this.options.getFileLinkContext()),
        contenteditable: fileLink ? 'false' : null,
      },
    })
  },
})
