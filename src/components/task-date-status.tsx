import { Page } from 'iconoir-react'
import { useTaskDocuments } from './task-documents'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import { TaskRangeCalendar } from './task-range-calendar'
import type { TaskItem } from '../../shared/task-list'
import { taskDateLabel } from '../utils/task-date-label'

export function TaskDateStatus({ task, today, readOnly, onChange, isOpen, onOpenChange }: {
  task: TaskItem; today: string; readOnly: boolean; onChange: (start: string | null, end: string | null) => void; isOpen?: boolean; onOpenChange?: (open: boolean) => void
}) {
  useUiLocale()
  const documents = useTaskDocuments()
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [localOpen, setLocalOpen] = useState(false)
  const open = isOpen ?? localOpen
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next) }
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const close = () => { setOpen(false); if (popup.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true }) }
  useOverlayDismiss(open && close, { outside: () => popup.current })
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!trigger.current || !popup.current) return
      const rect = trigger.current.getBoundingClientRect(), box = popup.current.getBoundingClientRect(), viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? window.innerWidth), bottom = top + (viewport?.height ?? window.innerHeight)
      setPosition({ left: Math.max(left + 8, Math.min(rect.right - box.width, right - box.width - 8)), top: Math.max(top + 8, Math.min(rect.bottom + box.height + 4 <= bottom - 8 ? rect.bottom + 4 : rect.top - box.height - 4, bottom - box.height - 8)) })
    }
    place()
    popup.current?.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place) }
  }, [open])
  const status = taskDateLabel(task, today)
  return <>
    <button ref={trigger} type="button" className="task-date-status" data-tone={status.tone} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{status.label}</button>
    {task.path && documents.open && <button type="button" className="task-tool task-open-document" aria-label={uiText('파일 열기')} data-tip={uiText('파일 열기')} onClick={() => documents.open?.(task.path!)}><Page width={14} height={14} aria-hidden="true" /></button>}
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label={uiText('일정 편집')} tabIndex={-1} className="task-date-popover" style={position}>
      <TaskRangeCalendar start={task.startDate} end={task.date} readOnly={readOnly} onChange={onChange} />
    </div>, document.body)}
  </>
}
