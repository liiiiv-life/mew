import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Xmark } from 'iconoir-react'
import { Editor } from '@mew/editor'
import { getBinding, matchesShortcut } from '@mew/shortcuts'
import { useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { SHARED_MEMO_PATH, SHARED_MEMO_PROJECT } from '../../shared/shared-memo'
import { editorApi } from '../api/client'
import { useCollab } from '../hooks/useCollab'
import { identityColor } from '../utils/collabColor'
import { PresenceDots } from './PresenceDots'
import './shared-memo.css'

// Table widths already travel in the shared CRDT; no project-relative layout file.
const memoApi = { ...editorApi, fetchTableLayout: undefined, saveTableLayout: undefined }

export function SharedMemo({ authEmail, open: controlledOpen, onOpenChange, focusSignal = 0 }: {
  authEmail: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  focusSignal?: number
}) {
  useUiLocale()
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const [activated, setActivated] = useState(false)
  const [value, setValue] = useState('')
  const [colors, setColors] = useState<string[]>([])
  const [position, setPosition] = useState({ x: 24, y: 80 })
  const root = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  // Keep unsent edits and undo state when the popup closes; hidden clients publish no presence.
  const collab = useCollab(SHARED_MEMO_PROJECT, activated ? SHARED_MEMO_PATH : null, authEmail)
  const focusEditor = useCallback(() => {
    const editor = root.current?.querySelector<HTMLElement>('.tiptap[contenteditable="true"]')
    ;(editor ?? root.current)?.focus({ preventScroll: true })
  }, [])
  const close = useCallback(() => {
    const restore = root.current?.contains(document.activeElement)
    setOpen(false)
    if (restore && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
  }, [setOpen])
  useOverlayDismiss(open && close, {
    escapePhase: 'bubble',
    closeOnEscape: event => !event.isComposing && !!root.current?.contains(document.activeElement),
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || !matchesShortcut(event, getBinding('toggleMemo'))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat) return
      if (open && root.current?.contains(document.activeElement)) { close(); return }
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (open) focusEditor()
      else { setActivated(true); setOpen(true) }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, close, focusEditor, setOpen])

  useLayoutEffect(() => {
    if (!open) return
    setActivated(true)
    if (!root.current?.contains(document.activeElement)) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    focusEditor()
  }, [open, activated, focusSignal, focusEditor])
  useEffect(() => {
    if (!open || !collab?.connected || !root.current?.contains(document.activeElement)) return
    const frame = requestAnimationFrame(focusEditor)
    return () => cancelAnimationFrame(frame)
  }, [open, collab?.connected, focusEditor])

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

  const clamp = useCallback((x: number, y: number) => {
    const viewport = window.visualViewport
    const left = (viewport?.offsetLeft ?? 0) + 8, top = (viewport?.offsetTop ?? 0) + 8
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
    const rect = root.current?.getBoundingClientRect()
    return { x: Math.max(left, Math.min(x, left + width - (rect?.width ?? 0) - 16)), y: Math.max(top, Math.min(y, top + height - (rect?.height ?? 0) - 16)) }
  }, [])
  useLayoutEffect(() => {
    if (!open || !root.current) return
    const fit = () => {
      root.current?.style.setProperty('--memo-viewport-height', `${window.visualViewport?.height ?? window.innerHeight}px`)
      setPosition(current => clamp(current.x, current.y))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(root.current)
    window.addEventListener('resize', fit)
    window.visualViewport?.addEventListener('resize', fit)
    window.visualViewport?.addEventListener('scroll', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
      window.visualViewport?.removeEventListener('resize', fit)
      window.visualViewport?.removeEventListener('scroll', fit)
    }
  }, [open, clamp])

  if (!activated) return null
  return createPortal(
    <div ref={root} role="dialog" data-workspace-panel="memo" aria-label={uiText('메모')} tabIndex={-1} hidden={!open}
      className="shared-memo fixed z-40 flex flex-col overflow-hidden rounded-xl bg-surface-deep text-ink shadow-xl"
      style={{ left: position.x, top: position.y }}>
      <div className="flex shrink-0 items-center gap-1 bg-surface px-2">
        <div role="button" tabIndex={0} aria-label={uiText('메모 위치 이동')}
          className="flex min-h-10 min-w-0 flex-1 cursor-move touch-none items-center gap-1 px-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return
            event.preventDefault()
            event.currentTarget.focus({ preventScroll: true })
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: position.x, top: position.y }
          }}
          onPointerMove={event => {
            const start = drag.current
            if (start?.id === event.pointerId) setPosition(clamp(start.left + event.clientX - start.x, start.top + event.clientY - start.y))
          }}
          onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
          onKeyDown={event => {
            if (!event.key.startsWith('Arrow')) return
            event.preventDefault(); event.stopPropagation()
            setPosition(current => clamp(current.x + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), current.y + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0)))
          }}>
          <span>{uiText('메모')}</span><PresenceDots colors={colors} />
        </div>
        <button type="button" onClick={close} aria-label={uiText('닫기')} title={uiText('닫기')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          <Xmark width={16} height={16} />
        </button>
      </div>
      {!collab?.connected && <div role="status" className="px-4 py-2 text-xs text-ink-muted">{uiText(collab?.synced ? '재연결 중…' : '연결 중…')}</div>}
      <div className="min-h-0 flex-1">
        {collab && <Editor value={value} onChange={setValue} api={memoApi} collab={collab} readOnly={!collab.connected} />}
      </div>
    </div>, document.body,
  )
}
