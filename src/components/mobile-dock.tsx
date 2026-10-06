import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { HoverTipLayer, useReorderAnimation, reorderLayoutRect } from '@mew/ui'
import { useI18n } from '../i18n'
import { dockIcons, useDockLabel } from './dock-items'
import { useDockPreferences, setDockOrder } from '../hooks/use-dock-preferences'
import { visibleDockPanels, moveDockPanel, type DockDirection, type MobileDockPanel } from '../utils/mobile-dock'



type DragPreview = { x: number; y: number; width: number; height: number }

export function MobileDock({ active, openPanels, available, hidden, portalTarget, vertical = false, onSelect, onNavigate }: {
  openPanels?: readonly MobileDockPanel[]
  active: string; available: readonly MobileDockPanel[]; hidden: boolean
  vertical?: boolean
  portalTarget?: HTMLElement | null
  onSelect: (panel: MobileDockPanel) => void
  onNavigate: (direction: DockDirection, order: MobileDockPanel[]) => void
}) {
  const { t } = useI18n()
  const labelFor = useDockLabel()
  const preferences = useDockPreferences()
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const verticalLayout = desktop && vertical
  const [draftOrder, setOrder] = useState(preferences.order)
  const [dragging, setDragging] = useState<MobileDockPanel | null>(null)
  const order = dragging ? draftOrder : preferences.order
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const [notice, setNotice] = useState<MobileDockPanel | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clearNotice = () => { clearTimeout(noticeTimer.current); setNotice(null) }
  const root = useRef<HTMLElement>(null)
  const captureReorder = useReorderAnimation(() => root.current?.querySelectorAll<HTMLElement>('[data-dock-item]') ?? [])
  const gesture = useRef<{ id: number; x: number; y: number; item?: MobileDockPanel; box?: DOMRect; capture: HTMLElement; moved: boolean; dragging: boolean; order: MobileDockPanel[]; original: MobileDockPanel[] } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressClick = useRef(false)
  const visible = visibleDockPanels(order, available, preferences.hidden)
  const cancel = () => {
    clearNotice()
    clearTimeout(timer.current)
    const current = gesture.current
    if (current?.dragging) { captureReorder(); setOrder(current.original) }
    gesture.current = null
    setDragging(null)
    setPreview(null)
    if (current?.capture.hasPointerCapture(current.id)) current.capture.releasePointerCapture(current.id)
  }
  useEffect(() => {
    const dismiss = () => cancel()
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      suppressClick.current = true
      cancel()
    }
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', key, true)
    document.addEventListener('visibilitychange', dismiss)
    return () => { clearTimeout(noticeTimer.current); clearTimeout(timer.current); window.removeEventListener('blur', dismiss); window.removeEventListener('resize', dismiss); window.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', dismiss) }
  }, [])
  useEffect(() => { cancel() }, [preferences.order])
  const availableKey = available.join(',') + ':' + preferences.hidden.join(',')
  useEffect(() => { cancel() }, [hidden, portalTarget, availableKey])
  const commit = (next: MobileDockPanel[]) => { setOrder(next); setDockOrder(next) }
  const updatePreview = (x: number, y: number) => {
    const current = gesture.current, dock = root.current
    if (!current?.box || !dock) return
    const bounds = dock.getBoundingClientRect()
    setPreview({ x: current.box.left + x - current.x - bounds.left - dock.clientLeft + dock.scrollLeft, y: current.box.top + y - current.y - bounds.top - dock.clientTop + dock.scrollTop - 8, width: current.box.width, height: current.box.height })
  }
  const down = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary) { suppressClick.current = true; cancel(); return }
    if (event.button !== 0) return
    clearNotice()
    const element = (event.target as Element).closest<HTMLElement>('[data-dock-item]')
    const item = element?.dataset.dockItem as MobileDockPanel | undefined
    suppressClick.current = false
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, item, box: element?.getBoundingClientRect(), capture: event.currentTarget, moved: false, dragging: false, order, original: order }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (item) timer.current = setTimeout(() => {
      const current = gesture.current
      if (!current || current.moved) return
      current.dragging = true
      setOrder(current.order)
      suppressClick.current = true
      setDragging(item)
      updatePreview(current.x, current.y)
    }, 450)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) {
      current.moved = true; suppressClick.current = true; clearTimeout(timer.current)
    }
    if (!current.dragging || !current.item) return
    updatePreview(event.clientX, event.clientY)
    // Use the untransformed slots, including the placeholder, so a stationary
    // pointer cannot swap the same two items back and forth after a reorder.
    const slots = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-dock-item]') ?? [])
    let target: MobileDockPanel | undefined, nearest = Infinity
    for (const el of slots) {
      const box = reorderLayoutRect(el)
      const distance = verticalLayout ? Math.abs(event.clientY - (box.top + box.height / 2)) : Math.abs(event.clientX - (box.left + box.width / 2))
      if (distance < nearest) { nearest = distance; target = el.dataset.dockItem as MobileDockPanel }
    }
    if (target && target !== current.item) {
      const next = moveDockPanel(current.order, current.item, target)
      if (next.some((id, index) => id !== current.order[index])) { captureReorder(); current.order = next; setOrder(next) }
    }
  }
  const up = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    const tapped = !current.dragging && !current.moved && current.item
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    if (current.dragging) commit(current.order)
    else if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { suppressClick.current = true; onNavigate(dx > 0 ? -1 : 1, visible) }
    else if (!current.moved && current.item) { suppressClick.current = true; onSelect(current.item) }
    gesture.current = null
    cancel()
    if (tapped && event.pointerType === 'touch') {
      setNotice(tapped)
      noticeTimer.current = setTimeout(() => setNotice(null), 500)
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  if (hidden || !visible.length) return null
  const DragIcon = dragging ? dockIcons[dragging] : null
  const content = <HoverTipLayer className="contents" placement={desktop ? 'bottom' : 'top'} portalTarget={portalTarget?.closest('[role="dialog"]')}><nav ref={root} className="mobile-dock" hidden={hidden} aria-label={t('dock.label')}
    data-vertical={verticalLayout || undefined} data-reordering={dragging ? true : undefined}
    onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={() => { suppressClick.current = true; cancel() }} onLostPointerCapture={() => { if (gesture.current) cancel() }}
    onContextMenu={event => event.preventDefault()}>
    {visible.map(id => {
      const Icon = dockIcons[id]
      const label = labelFor(id)
      return <button key={id} type="button" data-dock-item={id} data-dragging={dragging === id || undefined}
        aria-label={label} data-tip={dragging ? undefined : label} aria-current={active === id ? (openPanels ? 'true' : 'page') : undefined}
        aria-pressed={openPanels ? openPanels.includes(id) : undefined}
        aria-describedby="mobile-dock-hint"
        onClick={event => { if (event.detail === 0 || !suppressClick.current) onSelect(id) }}
        onKeyDown={event => {
          const keys = verticalLayout ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
          if (!event.altKey || !keys.includes(event.key)) return
          event.preventDefault()
          const target = visible[visible.indexOf(id) + (event.key === keys[0] ? -1 : 1)]
          if (target) commit(moveDockPanel(order, id, target))
        }}><Icon width={22} height={22} strokeWidth={1.7} aria-hidden="true" /></button>
    })}
    {preview && DragIcon && <span className="dock-drag-preview" aria-hidden="true"
      style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}>
      <DragIcon width={22} height={22} strokeWidth={1.7} />
    </span>}
    <span id="mobile-dock-hint" className="sr-only">{t(verticalLayout ? 'dock.verticalHint' : 'dock.hint')}</span>
  </nav>
    {notice && createPortal(<div role="status" data-dock-notice style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
      className="pointer-events-none fixed left-1/2 z-[1700] max-w-[calc(100vw-16px)] -translate-x-1/2 rounded border border-edge-bright bg-surface-raised px-2 py-1 text-xs text-ink shadow-lg md:hidden">
      {labelFor(notice)}
    </div>, document.body)}
  </HoverTipLayer>
  return portalTarget ? createPortal(content, portalTarget) : content
}
