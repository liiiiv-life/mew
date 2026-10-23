import { canAutoFocusInput } from '@mew/ui'
import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { clipboardImages } from '../utils/clipboard-images'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder as inputPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands'
import { composerAttachmentPattern, composerAttachments, refreshComposerAttachments, type ComposerAttachment } from './agent-composer-attachments'
import { ComposerDocument } from '../utils/agent-composer-document'

/** Shared cursor operations for the plain textarea and the image-capable composer. */
export interface MentionInputHandle {
  readonly value?: string
  readonly selectionStart: number
  readonly selectionEnd: number
  focus(): void
  setSelectionRange(start: number, end: number): void
  readonly element?: HTMLElement
  isOnVisualBoundary?(direction: 'up' | 'down'): boolean
  insertText?(text: string): void
}

export function AgentComposerInput(props: {
  value: string
  onChange: (value: string, caret: number) => void
  onKeyDown: (event: KeyboardEvent) => void
  onImagesPasted?: (files: File[]) => void
  attachmentForToken?: (token: string) => ComposerAttachment
  resolvePendingToken?: (token: string) => string | undefined
  inputRef: RefObject<MentionInputHandle | null>
  placeholder?: string
  label?: string
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef(props)
  const documentRef = useRef<ComposerDocument | null>(null)
  latest.current = props

  useLayoutEffect(() => {
    const host = hostRef.current!
    const document = new ComposerDocument(token => latest.current.resolvePendingToken?.(token))
    documentRef.current = document
    document.remember(latest.current.value)
    const receiveImages = (event: ClipboardEvent | InputEvent) => {
      if (!latest.current.onImagesPasted) return false
      const files = clipboardImages('clipboardData' in event ? event.clipboardData : event.dataTransfer)
      if (!files.length) return false
      event.preventDefault()
      latest.current.onImagesPasted(files)
      return true
    }
    const view = new EditorView({
      parent: host,
      dispatchTransactions(transactions, view) {
        view.update(transactions)
        if (!transactions.some(transaction => transaction.docChanged)) return
        const changes = [...view.state.doc.toString().matchAll(/\[\[mew-upload:[^\]\n]+\]\]/g)].flatMap(match => {
          const result = latest.current.resolvePendingToken?.(match[0])
          return result === '' ? [{ from: match.index, to: match.index + match[0].length, insert: '' }] : []
        })
        // Failed uploads cannot be revived by undo. Successful uploads keep their
        // editing identity, so resolving a path never rewrites either history branch.
        if (changes.length) view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) })
      },
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          EditorView.lineWrapping,
          history(),
          composerAttachments(token => {
            const result = latest.current.resolvePendingToken?.(token)
            return latest.current.attachmentForToken?.(result || token)
          }),
          EditorView.clipboardOutputFilter.of(text => document.canonical(text)),
          EditorView.clipboardInputFilter.of(text => document.editor(text)),
          EditorView.domEventHandlers({
            keydown(event) {
              latest.current.onKeyDown(event)
              return event.defaultPrevented
            },
            paste: receiveImages,
            // Android keyboards can commit an image through beforeinput without a paste event.
            beforeinput(event) {
              return event.inputType === 'insertFromPaste' && receiveImages(event)
            },
          }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of(() => ({
            'aria-label': latest.current.label ?? latest.current.placeholder ?? '',
            'aria-placeholder': latest.current.placeholder ?? '',
            'aria-multiline': 'true',
            autocapitalize: 'sentences',
          })),
          inputPlaceholder(latest.current.placeholder ?? ''),
          EditorView.updateListener.of(update => {
            if (update.docChanged || update.selectionSet) {
              const text = update.state.doc.toString()
              document.remember(text)
              latest.current.onChange(document.canonical(text), document.canonicalPosition(text, update.state.selection.main.head))
            }
          }),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent' },
            '&.cm-focused': { outline: 'none' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },
            '.cm-content': { padding: '0', minHeight: '100%', caretColor: 'var(--color-ink)' },
            '.cm-line': { padding: '0' },
            '.cm-placeholder': { color: 'var(--color-ink-muted)' },
          }),
        ],
      }),
    })
    viewRef.current = view
    const handle: MentionInputHandle = {
      element: view.contentDOM,
      get value() { return document.canonical(view.state.doc.toString()) },
      get selectionStart() { return document.canonicalPosition(view.state.doc.toString(), view.state.selection.main.from) },
      get selectionEnd() { return document.canonicalPosition(view.state.doc.toString(), view.state.selection.main.to) },
      focus: () => view.focus(),
      setSelectionRange(start, end) {
        const length = view.state.doc.length
        const text = view.state.doc.toString()
        view.dispatch({ selection: { anchor: Math.min(document.editorPosition(text, start), length), head: Math.min(document.editorPosition(text, end), length) }, scrollIntoView: true })
      },
      insertText(text) {
        view.dispatch(view.state.replaceSelection(document.editor(text)), { scrollIntoView: true, userEvent: 'input', annotations: isolateHistory.of('full') })
      },
      isOnVisualBoundary(direction) {
        const { head, empty } = view.state.selection.main
        if (!empty) return false
        const boundary = direction === 'up' ? 0 : view.state.doc.length
        // Explicit newlines (including blank lines) always belong to cursor navigation.
        if (view.state.doc.lineAt(head).number !== view.state.doc.lineAt(boundary).number) return false
        const caret = view.coordsAtPos(head), edge = view.coordsAtPos(boundary)
        return !!caret && !!edge && Math.abs(caret.top - edge.top) < view.defaultLineHeight / 2
      },
    }
    const inputRef = latest.current.inputRef
    inputRef.current = handle
    if (latest.current.autoFocus && canAutoFocusInput()) view.focus()
    return () => {
      if (inputRef.current === handle) inputRef.current = null
      viewRef.current = null
      documentRef.current = null
      view.destroy()
    }
  }, [])

  useLayoutEffect(() => {
    const view = viewRef.current
    const document = documentRef.current
    if (!view || !document) return
    const editorValue = document.editor(props.value)
    if (view.state.doc.toString() !== editorValue) {
      const previous = view.state.doc.toString()
      let from = 0, end = previous.length, nextEnd = editorValue.length
      while (from < end && from < nextEnd && previous[from] === editorValue[from]) from++
      while (end > from && nextEnd > from && previous[end - 1] === editorValue[nextEnd - 1]) { end--; nextEnd-- }
      let suffix = previous.length - end
      for (const [text, boundary] of [[previous, end], [editorValue, nextEnd]] as const) {
        for (const match of text.matchAll(composerAttachmentPattern)) {
          const to = match.index + match[0].length
          if (match.index < from && from < to) from = match.index
          if (match.index < boundary && boundary < to) suffix = Math.min(suffix, text.length - to)
        }
      }
      end = previous.length - suffix
      nextEnd = editorValue.length - suffix
      view.dispatch({ changes: { from, to: end, insert: editorValue.slice(from, nextEnd) }, annotations: Transaction.addToHistory.of(false) })
    }
    view.dispatch({ effects: refreshComposerAttachments.of(null) })
    view.contentDOM.setAttribute('aria-label', props.label ?? props.placeholder ?? '')
  }, [props.value, props.label, props.placeholder, props.attachmentForToken])

  return <div ref={hostRef} className={props.className} style={props.style} />
}
