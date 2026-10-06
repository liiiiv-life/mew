import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, CheckCircle, Page, Trash } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText } from '@mew/ui/i18n-core'
import type { TaskItem } from '../../shared/task-list'

export type TaskMenuAnchor = { x: number; y: number; trigger: HTMLElement | SVGElement }

export function TaskActionMenu({ anchor, task, onOpenDocument, onEditDates, onToggleDone, onDelete, onClose }: {
  anchor: TaskMenuAnchor; task: TaskItem; onOpenDocument?: () => void; onEditDates?: () => void; onToggleDone?: () => void; onDelete?: () => void; onClose: () => void
}) {
  useUiLocale()
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y, maxHeight: 0, maxWidth: 0 })
  const close = (restore = true) => {
    if (restore && menu.current?.contains(document.activeElement) && anchor.trigger.isConnected) anchor.trigger.focus({ preventScroll: true })
    onClose()
  }
  useOverlayDismiss(() => close())
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return
      event.preventDefault(); event.stopPropagation(); onClose()
      const clear = () => { document.removeEventListener('click', swallow, true); document.removeEventListener('pointerdown', clear, true); clearTimeout(timer) }
      const swallow = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); clear() }
      document.addEventListener('click', swallow, { capture: true, once: true })
      document.addEventListener('pointerdown', clear, { capture: true, once: true })
      const timer = setTimeout(clear, 1000)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [onClose])
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    const place = () => {
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 4, top = (viewport?.offsetTop ?? 0) + 4
      const right = left + (viewport?.width ?? window.innerWidth) - 8
      let bottom = top + (viewport?.height ?? window.innerHeight) - 8
      if (window.matchMedia('(width < 768px)').matches) {
        const dock = document.querySelector('.mobile-dock:not([hidden])')?.getBoundingClientRect()
        if (dock && dock.width && dock.height) bottom = Math.min(bottom, dock.top - 4)
      }
      const maxHeight = Math.max(0, bottom - top), maxWidth = Math.max(0, right - left)
      element.style.maxHeight = `${maxHeight}px`; element.style.maxWidth = `${maxWidth}px`
      const rect = element.getBoundingClientRect()
      setPosition({ left: Math.max(left, Math.min(anchor.x, right - rect.width)), top: Math.max(top, Math.min(anchor.y, bottom - rect.height)), maxHeight, maxWidth })
    }
    place()
    element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const observer = new ResizeObserver(place)
    observer.observe(element)
    const dock = document.querySelector('.mobile-dock')
    if (dock) observer.observe(dock)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place) }
  }, [anchor])
  const select = (action: () => void, restore = false) => { close(restore); action() }
  return createPortal(<div ref={menu} role="menu" aria-label={uiText('태스크')} className="task-action-menu" style={position}
    onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
      if (next !== null) { event.preventDefault(); items[next]?.focus() }
      else if (event.key === 'Tab') { event.preventDefault(); close() }
    }}>
    {onOpenDocument && <button type="button" role="menuitem" onClick={() => select(onOpenDocument)}><Page width={16} height={16} aria-hidden="true" />{uiText('문서 열기')}</button>}
    {onEditDates && <button type="button" role="menuitem" onClick={() => select(onEditDates)}><Calendar width={16} height={16} aria-hidden="true" />{uiText('일정 편집')}</button>}
    {onToggleDone && <button type="button" role="menuitemcheckbox" aria-checked={task.done} onClick={() => select(onToggleDone, true)}><CheckCircle width={16} height={16} aria-hidden="true" />{uiText('완료')}</button>}
    {onDelete && <button type="button" role="menuitem" className="task-action-danger" onClick={() => select(onDelete)}><Trash width={16} height={16} aria-hidden="true" />{uiText('태스크 삭제')}</button>}
  </div>, document.body)
}
