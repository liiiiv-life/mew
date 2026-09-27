import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { clipboardImages } from '../utils/clipboard-images'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as inputPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

/** Shared cursor operations for the plain textarea and the image-capable composer. */
export interface MentionInputHandle {
  readonly selectionStart: number
  readonly selectionEnd: number
  focus(): void
  setSelectionRange(start: number, end: number): void
  readonly element?: HTMLElement
  isOnVisualBoundary?(direction: 'up' | 'down'): boolean
}

export function AgentComposerInput(props: {
  value: string
  onChange: (value: string, caret: number) => void
  onKeyDown: (event: KeyboardEvent) => void
  onImagesPasted?: (files: File[]) => void
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
  latest.current = props

  useLayoutEffect(() => {
    const host = hostRef.current!
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
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          EditorView.lineWrapping,
          history(),
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
              latest.current.onChange(update.state.doc.toString(), update.state.selection.main.head)
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
      get selectionStart() { return view.state.selection.main.from },
      get selectionEnd() { return view.state.selection.main.to },
      focus: () => view.focus(),
      setSelectionRange(start, end) {
        const length = view.state.doc.length
        view.dispatch({ selection: { anchor: Math.min(start, length), head: Math.min(end, length) }, scrollIntoView: true })
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
    if (latest.current.autoFocus) view.focus()
    return () => {
      if (inputRef.current === handle) inputRef.current = null
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== props.value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } })
    }
    view.contentDOM.setAttribute('aria-label', props.label ?? props.placeholder ?? '')
  }, [props.value, props.label, props.placeholder])

  return <div ref={hostRef} className={props.className} style={props.style} />
}
