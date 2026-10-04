import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getBinding, matchesShortcut } from '@mew/shortcuts'
import { SHARED_MEMO_PATH, SHARED_MEMO_PROJECT } from '../../shared/shared-memo'
import { useCollab } from './useCollab'
import { useMobileKeyboard } from './use-mobile-keyboard'
import { identityColor } from '../utils/collabColor'

/** Owned above the project-keyed dock: closing or switching projects keeps the CRDT and pending edits. */
export function useSharedMemo({ authEmail, open, onOpenChange, focusSignal = 0, onFocus }: {
  authEmail: string; open: boolean; onOpenChange: (open: boolean) => void; focusSignal?: number; onFocus?: () => void
}) {
  const keyboardOpen = useMobileKeyboard()
  const [activated, setActivated] = useState(false)
  const [value, setValue] = useState('')
  const [viewMode, setViewMode] = useState<'hotview' | 'plain'>('hotview')
  const [colors, setColors] = useState<string[]>([])
  const root = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const collab = useCollab(SHARED_MEMO_PROJECT, activated && authEmail ? SHARED_MEMO_PATH : null, authEmail)
  const focusEditor = useCallback(() => {
    const editor = root.current?.querySelector<HTMLElement>(viewMode === 'plain' ? '.cm-content[contenteditable="true"]' : '.tiptap[contenteditable="true"]')
    ;(editor ?? root.current)?.focus({ preventScroll: true })
  }, [viewMode])
  const close = useCallback(() => {
    const restore = root.current?.contains(document.activeElement)
    onOpenChange(false)
    if (restore && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
  }, [onOpenChange])
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!authEmail || event.isComposing || !matchesShortcut(event, getBinding('toggleMemo'))) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.repeat) return
      if (open && root.current?.contains(document.activeElement)) { close(); return }
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (open) { onFocus?.(); focusEditor(); requestAnimationFrame(focusEditor) }
      else { setActivated(true); onOpenChange(true) }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [authEmail, open, close, focusEditor, onOpenChange, onFocus])
  useLayoutEffect(() => {
    if (!open) return
    setActivated(true)
    if (!root.current?.contains(document.activeElement)) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => root.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open, activated, focusSignal])
  useEffect(() => {
    const awareness = collab?.awareness
    if (!awareness) return
    awareness.setLocalState(open ? { user: { name: authEmail.split('@')[0], color: identityColor(authEmail), memoViewer: authEmail } } : null)
    const update = () => {
      const viewers = new Map<string, string>()
      if (open && collab.connected) for (const state of awareness.getStates().values()) {
        const user = state.user
        if (typeof user?.memoViewer === 'string' && typeof user.color === 'string') viewers.set(user.memoViewer, user.color)
      }
      setColors([...viewers.values()])
    }
    update()
    awareness.on('change', update)
    return () => { awareness.off('change', update) }
  }, [collab?.awareness, collab?.connected, open, authEmail])

  return { root, value, setValue, viewMode, setViewMode, colors, collab, keyboardOpen, close, activated }
}
export type SharedMemoSession = ReturnType<typeof useSharedMemo>
