import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DateField, useOverlayDismiss } from '@mew/ui'
import { localToday } from '@mew/ui/date-value'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import type { TaskItem } from '../../shared/task-list'
import { taskDateLabel } from '../utils/task-date-label'

export function TaskDateStatus({ task, readOnly, onChange }: {
  task: TaskItem; readOnly: boolean; onChange: (field: 'startDate' | 'date', value: string | null) => void
}) {
  useUiLocale()
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [today, setToday] = useState(localToday)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const close = () => { setOpen(false); if (popup.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true }) }
  useOverlayDismiss(open && close, { outside: () => popup.current })
  useEffect(() => {
    const refresh = () => setToday(localToday())
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
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
    <button ref={trigger} type="button" className="task-date-status" data-tone={status.tone} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>{status.label === '시작 전' || status.label === '일정 없음' ? uiText(status.label) : status.label}</button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label={uiText('일정 편집')} tabIndex={-1} className="task-date-popover" style={position}>
      <div className="task-date-row"><span>{uiText('시작일')}</span><DateField value={task.startDate} label={uiText('태스크 시작 날짜')} readOnly={readOnly} onChange={value => onChange('startDate', value)} /></div>
      <div className="task-date-row"><span>{uiText('완료일')}</span><DateField value={task.date} label={uiText('태스크 날짜')} readOnly={readOnly} onChange={value => onChange('date', value)} /></div>
    </div>, document.body)}
  </>
}
