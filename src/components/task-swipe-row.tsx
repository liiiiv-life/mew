import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Trash } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import type { TaskMenuAnchor } from './task-action-menu'
import { uiText } from '@mew/ui/i18n-core'

const actionWidth = 40

type Gesture = { pointer: number; x: number; y: number; initial: number; horizontal: boolean }

export function TaskSwipeRow({ id, done, dragging, dropBefore, children, enabled, open, onReveal, onDelete, onMenu }: {
  id: string; done: boolean; dragging?: boolean; dropBefore?: boolean; children: ReactNode; enabled: boolean; open: boolean; onReveal: (open: boolean) => void; onDelete: () => void; onMenu?: (anchor: TaskMenuAnchor) => void
}) {
  const row = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null)
  const gesture = useRef<Gesture | null>(null), suppressClick = useRef(false)
  const [offset, setOffset] = useState<number | null>(null)
  const revealed = enabled && open
  useOverlayDismiss(revealed && (() => onReveal(false)), { outside: () => row.current })
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    gesture.current = null
    if (current.horizontal) {
      event.preventDefault()
      event.stopPropagation()
      if (!cancelled) onReveal(Math.max(0, Math.min(actionWidth, current.initial + current.x - event.clientX)) >= actionWidth / 2)
    }
    setOffset(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div ref={row} className="task-line task-swipe" data-task-id={id} data-done={done} data-dragging={dragging || undefined} data-drop-before={dropBefore || undefined} data-delete-open={revealed || undefined} data-swiping={offset !== null || undefined}
    style={{ '--task-swipe-offset': `${enabled ? offset ?? (revealed ? actionWidth : 0) : 0}px` } as CSSProperties}
    onContextMenu={event => {
      if (!onMenu || dragging) return
      event.preventDefault(); event.stopPropagation(); onReveal(false)
      onMenu({ x: event.clientX, y: event.clientY, trigger: event.currentTarget.querySelector<HTMLButtonElement>('.task-date-status') ?? event.currentTarget })
    }}
    onPointerDown={event => {
      suppressClick.current = false
      if (!enabled || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('.task-check, .task-tags, .task-delete') || event.pointerType === 'mouse' && (event.target as Element).closest('textarea')) return
      gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, initial: revealed ? actionWidth : 0, horizontal: false }
    }}
    onPointerMove={event => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      const dx = event.clientX - current.x, dy = event.clientY - current.y
      if (!current.horizontal) {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { gesture.current = null; return }
        if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.5) return
        current.horizontal = true
        suppressClick.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      event.preventDefault()
      event.stopPropagation()
      setOffset(Math.max(0, Math.min(actionWidth, current.initial - dx)))
    }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => { if (event.target === event.currentTarget) { gesture.current = null; setOffset(null) } }}
    onClickCapture={event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation() } }}
    onKeyDown={event => {
      if (onMenu && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); event.stopPropagation(); onReveal(false)
        const rect = event.currentTarget.getBoundingClientRect()
        onMenu({ x: rect.left + 24, y: rect.bottom, trigger: event.target as HTMLElement })
      } else if (enabled && event.altKey && event.key === 'Delete') {
        event.preventDefault(); event.stopPropagation(); onReveal(true)
        requestAnimationFrame(() => button.current?.focus({ preventScroll: true }))
      }
    }}>
    <div className="task-row-content">{children}</div>
    {enabled && <button ref={button} type="button" className="task-delete" hidden={!revealed && offset === null} tabIndex={revealed ? 0 : -1}
      aria-label={uiText('태스크 삭제')} aria-keyshortcuts="Alt+Delete" data-tip={uiText('태스크 삭제')}
      onClick={() => { if (revealed) onDelete() }}><Trash width={16} height={16} aria-hidden="true" /></button>}
  </div>
}
