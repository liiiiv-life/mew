import { useEffect, useRef, useState, type PointerEvent, type SVGProps } from 'react'
import { createPortal } from 'react-dom'
import { HoverTipLayer } from '@mew/ui'
import { Brain, Computer, Database, EditPencil, Folder, GitBranch, Globe, Terminal } from 'iconoir-react'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import { useI18n } from '../i18n'
import { featureCopy } from './feature-copy'
import { MOBILE_DOCK_ORDER_KEY, normalizeMobileDockOrder, moveDockPanel, type DockDirection, type MobileDockPanel } from '../utils/mobile-dock'

function FeatureIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}><circle cx="5" cy="5" r="2" /><path d="M10 5h11M5 9v10h3M12 13h9M12 19h9" /><circle cx="10" cy="13" r="1" /><circle cx="10" cy="19" r="1" /></svg>
}

const icons = { sidebar: Folder, editor: EditPencil, agent: Brain, terminal: Terminal, git: GitBranch, browser: Globe, desktop: Computer, features: FeatureIcon, rag: Database }
const labels = { sidebar: 'fab.sidebar', editor: 'fab.editor', agent: 'header.agent', terminal: 'header.terminal', git: 'access.git', browser: 'header.browser', desktop: 'access.desktop' } as const

export function MobileDock({ active, available, hidden, portalTarget, onSelect, onNavigate }: {
  active: string; available: readonly MobileDockPanel[]; hidden: boolean
  portalTarget?: HTMLElement | null
  onSelect: (panel: MobileDockPanel) => void
  onNavigate: (direction: DockDirection, order: MobileDockPanel[]) => void
}) {
  const { t, locale } = useI18n()
  const [order, setOrder] = useState(() => {
    try { return normalizeMobileDockOrder(JSON.parse(localStorage.getItem(MOBILE_DOCK_ORDER_KEY) ?? 'null')) }
    catch { return normalizeMobileDockOrder(null) }
  })
  const [dragging, setDragging] = useState<MobileDockPanel | null>(null)
  const [notice, setNotice] = useState<MobileDockPanel | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const labelFor = (id: MobileDockPanel) => id === 'rag' ? 'RAG' : id === 'features' ? featureCopy[locale].title : t(labels[id])
  const clearNotice = () => { clearTimeout(noticeTimer.current); setNotice(null) }
  const root = useRef<HTMLElement>(null)
  const gesture = useRef<{ id: number; x: number; y: number; item?: MobileDockPanel; moved: boolean; dragging: boolean; order: MobileDockPanel[]; original: MobileDockPanel[] } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressClick = useRef(false)
  const visible = order.filter(id => available.includes(id))
  const cancel = () => {
    clearNotice()
    clearTimeout(timer.current)
    if (gesture.current?.dragging) setOrder(gesture.current.original)
    gesture.current = null
    setDragging(null)
  }
  useEffect(() => {
    const dismiss = () => cancel()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('blur', dismiss)
    window.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', dismiss)
    return () => { clearTimeout(noticeTimer.current); clearTimeout(timer.current); window.removeEventListener('blur', dismiss); window.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', dismiss) }
  }, [])
  useEffect(() => { if (hidden) cancel() }, [hidden])
  const commit = (next: MobileDockPanel[]) => { setOrder(next); writeBrowserStorage(MOBILE_DOCK_ORDER_KEY, JSON.stringify(next)) }
  const down = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary) { suppressClick.current = true; cancel(); return }
    if (event.button !== 0) return
    clearNotice()
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-dock-item]')?.dataset.dockItem as MobileDockPanel | undefined
    suppressClick.current = false
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, item, moved: false, dragging: false, order, original: order }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (item) timer.current = setTimeout(() => {
      const current = gesture.current
      if (!current || current.moved) return
      current.dragging = true
      suppressClick.current = true
      setDragging(item)
    }, 450)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || current.id !== event.pointerId) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) {
      current.moved = true; suppressClick.current = true; clearTimeout(timer.current)
    }
    if (!current.dragging || !current.item) return
    const target = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-dock-item]') ?? []).find(el => {
      const box = el.getBoundingClientRect()
      return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top - 24 && event.clientY <= box.bottom + 24
    })?.dataset.dockItem as MobileDockPanel | undefined
    if (target) { current.order = moveDockPanel(current.order, current.item, target); setOrder(current.order) }
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
  if (hidden) return null
  const content = <HoverTipLayer className="contents"><nav ref={root} className="mobile-dock" hidden={hidden} aria-label={t('dock.label')}
    onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerCancel={() => { suppressClick.current = true; cancel() }} onLostPointerCapture={() => { if (gesture.current) cancel() }}
    onContextMenu={event => event.preventDefault()}>
    {visible.map(id => {
      const Icon = icons[id]
      const label = labelFor(id)
      return <button key={id} type="button" data-dock-item={id} data-dragging={dragging === id || undefined}
        aria-label={label} data-tip={label} aria-current={active === id ? 'page' : undefined}
        aria-describedby="mobile-dock-hint"
        onClick={event => { if (event.detail === 0 || !suppressClick.current) onSelect(id) }}
        onKeyDown={event => {
          if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          const target = visible[visible.indexOf(id) + (event.key === 'ArrowLeft' ? -1 : 1)]
          if (target) commit(moveDockPanel(order, id, target))
        }}><Icon width={22} height={22} strokeWidth={1.7} aria-hidden="true" /></button>
    })}
    <span id="mobile-dock-hint" className="sr-only">{t('dock.hint')}</span>
  </nav>
    {notice && createPortal(<div role="status" data-dock-notice style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))' }}
      className="pointer-events-none fixed left-1/2 z-[1700] max-w-[calc(100vw-16px)] -translate-x-1/2 rounded border border-edge-bright bg-surface-raised px-2 py-1 text-xs text-ink shadow-lg md:hidden">
      {labelFor(notice)}
    </div>, document.body)}
  </HoverTipLayer>
  return portalTarget ? createPortal(content, portalTarget) : content
}
