import { useFloatingPanel } from '../hooks/use-floating-panel'
import { uiText } from '@mew/ui/i18n-core'
import { Drag, Expand } from 'iconoir-react'
import { useI18n } from '../i18n'
import type { PaneNode } from '../utils/paneTree'
import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { dockIds, dockRects, insertDock, normalizeDock, pruneDock, closeDockGroup, defaultDockTree, addDockGroup, type DockKind, type DockNode, type DockRect, type DockSide, type DockState } from '../utils/dock-layout'

type Source = { group: string; tab?: string }
type Target = { group: string; side: DockSide | 'center' }
export type DockHandle = { restore: () => void; preview: (group: string, tab: string, x: number, y: number) => void; drop: (group: string, tab: string, x: number, y: number) => void; placeEditor: (id: string, target: string, side: DockSide) => void }
type Registration = { kind: DockKind; visible: boolean; tabs: string[] }
type DockContextValue = {
  host: HTMLDivElement | null; state: DockState; desktop: boolean; rects: Record<string, DockRect>; foreground: string | null; mobileGroups: Record<string, string>; focusGroup: (kind: DockKind, id: string) => void
  register: (id: string, value: Registration | null) => void
  groupFor: (kind: DockKind, tab: string) => string
  closeGroup: (group: string) => boolean
  select: (group: string, tab: string) => void
  assign: (group: string, tab: string) => void
  dragProps: (group: string, tab?: string) => React.HTMLAttributes<HTMLElement>
  preview: DockHandle['preview']; drop: DockHandle['drop']
  maximized: string | null; expandedRect: DockRect
  toggleMaximize: (group: string) => void
  followMaximize: (group: string) => void
}
const DockContext = createContext<DockContextValue | null>(null)
// Context and surfaces share one module so consumers cannot create mismatched providers.
// eslint-disable-next-line react-refresh/only-export-components
export const useDock = () => useContext(DockContext)
const rectStyle = (r?: DockRect): CSSProperties => r ? { position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height } : { display: 'none' }

export function DockWorkspace({ children, value, onChange, onEditorDrop, foreground, apiRef, initialLayout }: {
  initialLayout?: PaneNode; children: ReactNode; value: unknown; onChange: (state: DockState) => void; foreground: string | null; apiRef: Ref<DockHandle>
  onEditorDrop: (path: string, source: string, target: string | null) => string
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [expandedRect, setExpandedRect] = useState<DockRect>({ x: 0, y: 0, width: 0, height: 0 })
  const [maximizedGroup, setMaximizedGroup] = useState<string | null>(null)
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width: 768px)').matches)
  const [registered, setRegistered] = useState<Record<string, Registration>>({})
  const state = useMemo(() => normalizeDock(value), [value])
  const [mobileGroups, setMobileGroups] = useState<Record<string, string>>({})
  const [target, setTarget] = useState<Target | null>(null)
  const source = useRef<Source | null>(null)
  const register = useCallback((id: string, registration: Registration | null) => setRegistered((previous) => {
    if (registration && previous[id]?.kind === registration.kind && previous[id]?.visible === registration.visible && JSON.stringify(previous[id]?.tabs) === JSON.stringify(registration.tabs)) return previous
    const next = { ...previous }; if (registration) next[id] = registration; else delete next[id]; return next
  }), [])
  const groups = useMemo(() => {
    const result = [...state.groups]
    for (const [id, registration] of Object.entries(registered)) if (!result.some((g) => g.id === id)) result.push({ id, kind: registration.kind })
    return result
  }, [registered, state.groups])
  const tree = useMemo(() => {
    const fromEditor = (node: PaneNode): DockNode => {
      if (node.kind === 'leaf') return { id: `editor:${node.pane}` }
      const combine = (kids: PaneNode[]): DockNode => kids.length === 1 ? fromEditor(kids[0]) : { axis: node.dir, ratio: 1 / kids.length, first: fromEditor(kids[0]), second: combine(kids.slice(1)) }
      return combine(node.kids)
    }
    const editorGroup = groups.find((group) => group.kind === 'editor')
    const editor = initialLayout ? fromEditor(initialLayout) : editorGroup ? { id: editorGroup.id } : null
    let tree = state.tree ?? defaultDockTree(editor, groups)
    for (const group of groups) if (registered[group.id]?.visible && !dockIds(tree).includes(group.id)) tree = addDockGroup(tree, group, groups)
    return tree
  }, [state.tree, groups, initialLayout, registered])
  const visibleTree = useMemo(() => pruneDock(tree, new Set(Object.entries(registered).filter(([, r]) => r.visible).map(([id]) => id))), [tree, registered])
  const rects = useMemo(() => dockRects(visibleTree, { x: 0, y: 0, ...size }), [visibleTree, size])
  const maximized = desktop && maximizedGroup && rects[maximizedGroup] ? maximizedGroup : null
  useOverlayDismiss(maximized ? () => setMaximizedGroup(null) : false, {
    closeOnEscape: event => !event.isComposing,
  })
  useEffect(() => {
    if (maximizedGroup && (!desktop || !rects[maximizedGroup] || !registered[maximizedGroup]?.tabs.length)) setMaximizedGroup(null)
  }, [desktop, maximizedGroup, rects, registered])
  const change = (next: Partial<DockState>) => {
    const result = { ...state, groups, tree, ...next }
    const keep = new Set([...Object.keys(registered), ...result.groups.filter((group) => !groups.some((old) => old.id === group.id)).map((group) => group.id)])
    result.groups = result.groups.filter((group) => keep.has(group.id))
    result.tree = pruneDock(result.tree, keep)
    result.tabs = Object.fromEntries(Object.entries(result.tabs).filter(([, group]) => keep.has(group)))
    result.active = Object.fromEntries(Object.entries(result.active).filter(([group]) => keep.has(group)))
    onChange(result)
  }
  useEffect(() => {
    if (!host) return
    const area = host.closest<HTMLElement>('.mew-workspace-content') ?? host
    const measure = () => {
      const bounds = host.getBoundingClientRect(), outer = area.getBoundingClientRect()
      setSize({ width: host.clientWidth, height: host.clientHeight })
      setExpandedRect({ x: outer.left - bounds.left, y: outer.top - bounds.top, width: outer.width, height: outer.height })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    if (area !== host) observer.observe(area)
    measure()
    const query = matchMedia('(min-width: 768px)')
    const update = () => setDesktop(query.matches)
    query.addEventListener('change', update)
    return () => { observer.disconnect(); query.removeEventListener('change', update) }
  }, [host])
  useEffect(() => {
    const cancel = () => { source.current = null; setTarget(null) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    const cancelPointer = () => { if (source.current?.tab) cancel() }
    window.addEventListener('pointercancel', cancelPointer)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('keydown', key) }
  }, [])
  const at = (drag: Source, x: number, y: number): Target | null => {
    if (!desktop || !host) return null
    const kind = groups.find((group) => group.id === drag.group)?.kind
    // Hit the complete tab bar before applying edge-split rules, including its empty space.
    if (drag.tab) {
      for (const bar of host.querySelectorAll<HTMLElement>('[data-dock-tab-bar]')) {
        const id = bar.closest<HTMLElement>('[data-dock-panel]')?.dataset.dockPanel
        if (!id || !rects[id] || groups.find((group) => group.id === id)?.kind !== kind) continue
        const bounds = bar.getBoundingClientRect()
        if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
          return id === drag.group ? null : { group: id, side: 'center' }
        }
      }
    }
    const bounds = host.getBoundingClientRect(); x -= bounds.left; y -= bounds.top
    const hit = Object.entries(rects).find(([, r]) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    if (!hit) return null
    const [id, r] = hit, targetKind = groups.find((g) => g.id === id)?.kind
    const edges = [{ side: 'left' as const, distance: (x - r.x) / r.width }, { side: 'right' as const, distance: (r.x + r.width - x) / r.width }, ...(kind === 'browser' || targetKind === 'browser' ? [] : [{ side: 'top' as const, distance: (y - r.y) / r.height }, { side: 'bottom' as const, distance: (r.y + r.height - y) / r.height }])].sort((a, b) => a.distance - b.distance)
    const side = drag.tab && kind === targetKind && (edges[0].distance > .25 || y < r.y + 36) ? 'center' : edges[0].side
    if (id === drag.group && (!drag.tab || side === 'center')) return null
    return { group: id, side }
  }
  const preview = (group: string, tab: string, x: number, y: number) => { setMaximizedGroup(null); source.current = { group, tab }; setTarget(at(source.current, x, y)) }
  const performDrop = (drag: Source, target: Target | null) => {
    setTarget(null); source.current = null
    if (!target) return
    const kind = groups.find((g) => g.id === drag.group)?.kind
    if (!kind) return
    let destination = target.group
    let nextGroups = groups
    if (drag.tab) {
      if (kind === 'editor') {
        destination = onEditorDrop(drag.tab, drag.group.replace(/^editor:/, ''), target.side === 'center' ? target.group.replace(/^editor:/, '') : null)
        destination = `editor:${destination}`
      } else if (target.side !== 'center') destination = `${kind}:${crypto.randomUUID()}`
      if (!nextGroups.some((g) => g.id === destination)) nextGroups = [...nextGroups, { id: destination, kind }]
      const nextTree = target.side === 'center' ? tree : insertDock(tree, destination, target.group, target.side, nextGroups)
      change({ groups: nextGroups, tree: nextTree, tabs: { ...state.tabs, [`${kind}:${drag.tab}`]: destination }, active: { ...state.active, [destination]: drag.tab } })
    } else if (target.side !== 'center') change({ tree: insertDock(tree, drag.group, target.group, target.side, groups) })
  }
  const drop = (group: string, tab: string, x: number, y: number) => { const drag = { group, tab }; performDrop(drag, at(drag, x, y)) }
  useImperativeHandle(apiRef, () => ({ restore: () => setMaximizedGroup(null), preview, drop, placeEditor: (id, target, side) => { const nextGroups = [...groups, { id: `editor:${id}`, kind: 'editor' as const }]; change({ groups: nextGroups, tree: insertDock(tree, `editor:${id}`, `editor:${target}`, side, nextGroups) }) } }))
  const dragProps = (group: string, tab?: string): React.HTMLAttributes<HTMLElement> => ({
    draggable: desktop,
    onDragStart: (event) => {
      if ((event.target as HTMLElement).closest('input,textarea,button')) { event.preventDefault(); return }
      setMaximizedGroup(null)
      source.current = { group, tab }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-mew-panel', group); event.stopPropagation()
    },
    onDragEnd: () => { source.current = null; setTarget(null) },
  })
  let previewRect: DockRect | undefined
  if (target && source.current) {
    if (target.side === 'center') previewRect = rects[target.group]
    else {
      const previewId = source.current.tab ? '__preview__' : source.current.group
      const kind = groups.find((g) => g.id === source.current?.group)?.kind ?? 'editor'
      const previewTree = insertDock(visibleTree, previewId, target.group, target.side, [...groups, { id: previewId, kind }])
      previewRect = dockRects(previewTree, { x: 0, y: 0, ...size })[previewId]
    }
  }
  const context: DockContextValue = {
    maximized, expandedRect,
    toggleMaximize: (group) => { if (desktop && rects[group]) setMaximizedGroup(previous => previous === group ? null : group) },
    followMaximize: (group) => { if (desktop && maximized && rects[group]) setMaximizedGroup(group) },
    host, state: { ...state, groups, tree }, desktop, rects, foreground, mobileGroups, focusGroup: (kind, id) => setMobileGroups((previous) => previous[kind] === id ? previous : { ...previous, [kind]: id }), register, preview, drop, dragProps,
    groupFor: (kind, tab) => { if (!desktop) return kind; const id = state.tabs[`${kind}:${tab}`]; return groups.some((g) => g.id === id && g.kind === kind) ? id : kind },
    closeGroup: (id) => {
      const kind = groups.find((group) => group.id === id)?.kind
      if (!kind) return false
      const sibling = dockIds(visibleTree).find((candidate) => candidate !== id && registered[candidate]?.kind === kind)
      change(closeDockGroup({ ...state, groups, tree }, id, registered[id]?.tabs ?? [], sibling))
      return !!sibling
    },
    select: (group, tab) => { if (state.active[group] !== tab) change({ active: { ...state.active, [group]: tab } }) },
    assign: (group, tab) => { const kind = groups.find((g) => g.id === group)?.kind; if (kind) change({ tabs: { ...state.tabs, [`${kind}:${tab}`]: group }, active: { ...state.active, [group]: tab } }) },
  }
  return <DockContext.Provider value={context}>
    <div ref={setHost} data-dock-workspace data-dock-maximized={maximized ?? undefined} className={`relative min-h-0 min-w-0 flex-1 bg-edge ${maximized ? 'overflow-visible' : 'overflow-hidden'}`}
      onDragOver={(event) => { if (!source.current) return; event.preventDefault(); setTarget(at(source.current, event.clientX, event.clientY)) }}
      onDrop={(event) => { if (!source.current) return; event.preventDefault(); event.stopPropagation(); performDrop(source.current, at(source.current, event.clientX, event.clientY)) }}>
      {children}
      {desktop && !maximized && <DockSeparators tree={visibleTree} rect={{ x: 0, y: 0, ...size }} onResize={(ids, ratio) => {
        const visible = new Set(Object.keys(rects))
        const update = (node: DockNode): DockNode => {
          if ('id' in node) return node
          const first = pruneDock(node.first, visible), second = pruneDock(node.second, visible)
          if (first && second && [...dockIds(first), ...dockIds(second)].join('|') === ids) return { ...node, ratio }
          return { ...node, first: update(node.first), second: update(node.second) }
        }
        if (tree) change({ tree: update(tree) })
      }} />}
      {desktop && previewRect && <div data-dock-preview className="pointer-events-none absolute z-50 rounded border-2 border-accent bg-accent/20" style={rectStyle(previewRect)} />}
    </div>
  </DockContext.Provider>
}
function DockSeparators({ tree, rect, onResize }: { tree: DockNode | null; rect: DockRect; onResize: (ids: string, ratio: number) => void }) {
  const { t } = useI18n()
  const drag = useRef<{ pointerId: number; start: number; ratio: number; length: number; horizontal: boolean; ids: string } | null>(null)
  if (!tree || 'id' in tree) return null
  const horizontal = tree.axis === 'row', length = horizontal ? rect.width : rect.height, firstSize = Math.max(0, length - 4) * tree.ratio
  const first = { ...rect, [horizontal ? 'width' : 'height']: firstSize }
  const second = { ...rect, [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + firstSize + 4, [horizontal ? 'width' : 'height']: Math.max(0, length - firstSize - 4) }
  const ids = dockIds(tree).join('|')
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    const position = active.horizontal ? event.clientX : event.clientY
    onResize(active.ids, Math.max(.15, Math.min(.85, active.ratio + (position - active.start) / Math.max(1, active.length - 4))))
  }
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <><div role="separator" tabIndex={0} aria-label={t('panel.resize')} aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(tree.ratio * 100)} aria-valuemin={15} aria-valuemax={85}
    className={`absolute z-40 touch-none border-edge bg-surface-deep hover:border-accent focus-visible:border-accent focus-visible:outline-none ${horizontal ? 'border-l' : 'border-t'}`}
    style={{ ...rectStyle(horizontal ? { x: rect.x + firstSize, y: rect.y, width: 4, height: rect.height } : { x: rect.x, y: rect.y + firstSize, width: rect.width, height: 4 }), cursor: horizontal ? 'col-resize' : 'row-resize' }}
    onKeyDown={(event) => { const delta = event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp') ? -.05 : event.key === (horizontal ? 'ArrowRight' : 'ArrowDown') ? .05 : 0; if (delta) { event.preventDefault(); onResize(ids, Math.max(.15, Math.min(.85, tree.ratio + delta))) } }}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary || drag.current) return
      event.preventDefault()
      // The browser replica is an iframe: window listeners lose the drag as soon
      // as the pointer crosses into it. Keep this separator as the event target.
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus({ preventScroll: true })
      drag.current = { pointerId: event.pointerId, start: horizontal ? event.clientX : event.clientY, ratio: tree.ratio, length, horizontal, ids }
    }}
    onPointerMove={move}
    onPointerUp={(event) => { move(event); end(event) }}
    onPointerCancel={end}
    onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) drag.current = null }} />
    <DockSeparators tree={tree.first} rect={first} onResize={onResize} /><DockSeparators tree={tree.second} rect={second} onResize={onResize} />
  </>
}
/** All surfaces portal into the same host. Moving a split changes geometry, not component ownership. */
export function DockPanel({ id, floating = false, storageKey = `mew:popup:${id}`, kind, visible = true, children, onFocus, mobileSelected, tabs = [] }: { floating?: boolean; storageKey?: string; tabs?: string[]; mobileSelected?: boolean; id: string; kind: DockKind; visible?: boolean; children: ReactNode; onFocus?: () => void }) {
  const dock = useDock(), register = dock?.register
  const floats = floating && !!dock?.desktop
  const popup = useFloatingPanel(storageKey, dock?.host ?? null, floats)
  const tabKey = JSON.stringify(tabs)
  useLayoutEffect(() => { register?.(id, { kind, visible: visible && !floats, tabs: JSON.parse(tabKey) as string[] }); return () => register?.(id, null) }, [register, id, kind, visible, tabKey, floats])
  if (!dock?.host) return null
  const chosen = dock.mobileGroups[kind] && dock.rects[dock.mobileGroups[kind]] ? dock.mobileGroups[kind] : Object.keys(dock.rects).find((id) => dock.state.groups.some((g) => g.id === id && g.kind === kind))
  const mobileVisible = visible && (mobileSelected ?? chosen === id) && (kind === 'editor' ? !dock.foreground || dock.foreground === 'editor' : dock.foreground === kind)
  const expanded = !floats && dock.maximized === id
  const covered = !floats && !!dock.maximized && !expanded
  return createPortal(<section data-dock-panel={id} data-dock-expanded={expanded || undefined} data-workspace-panel={kind} inert={covered || undefined} onPointerDownCapture={() => { if (floats) popup.focus(); dock.focusGroup(kind, id); onFocus?.() }} onFocusCapture={() => { if (floats) popup.focus(); dock.focusGroup(kind, id); onFocus?.() }}
    onClickCapture={(event) => { if (isPanelTab(event.target, event.currentTarget)) dock.followMaximize(id) }}
    onDoubleClickCapture={(event) => { if (isPanelTab(event.target, event.currentTarget)) dock.toggleMaximize(id) }}
    onKeyDownCapture={(event) => {
      if (!isPanelTab(event.target, event.currentTarget)) return
      if (dock.desktop && event.shiftKey && event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat) dock.toggleMaximize(id)
      } else if (event.key === 'Enter' || event.key === ' ') dock.followMaximize(id)
    }}
    onDragStartCapture={event => { if (floats) { event.preventDefault(); event.stopPropagation() } }}
    data-floating-panel={floats || undefined}
    className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-deep ${floats ? 'rounded-lg shadow-lg' : ''}`}
    style={floats ? { ...popup.style, display: visible ? 'flex' : 'none' } : dock.desktop ? { ...rectStyle(expanded ? dock.expandedRect : dock.rects[id]), ...(covered ? { visibility: 'hidden' } : {}) } : { position: 'absolute', inset: 0, display: mobileVisible ? 'flex' : 'none', zIndex: kind === 'editor' ? 0 : 10 }}>
    {floats && <button type="button" aria-label={uiText('위치 이동')} data-tip={uiText('위치 이동')} className="flex h-6 shrink-0 cursor-move touch-none items-center justify-center bg-surface-raised text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent" {...popup.controls('move')}><Drag width={14} height={14} /></button>}
    {children}
    {floats && <button type="button" aria-label={uiText('크기 조절')} data-tip={uiText('크기 조절')} className="absolute bottom-0 right-0 flex h-6 w-6 cursor-nwse-resize touch-none items-center justify-center rounded-tl bg-surface-raised text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent" {...popup.controls('resize')}><Expand width={14} height={14} /></button>}
  </section>, dock.host, id)
}
function isPanelTab(target: EventTarget, panel: HTMLElement): boolean {
  if (!(target instanceof Element) || target.closest('button,input,textarea,select,[contenteditable="true"]')) return false
  const tab = target.closest('[role="tab"]')
  return !!tab?.closest('[data-dock-tab-bar]') && tab.closest('[data-dock-panel]') === panel
}

/** Inline bodies grow with their owning panel without moving or remounting. */
export function DockInlineBody({ group, style, ...props }: ComponentProps<'div'> & { group: string }) {
  const dock = useDock()
  const expanded = dock?.maximized === group
  const covered = !!dock?.maximized && !expanded
  return <div {...props} data-dock-inline-body={group} inert={covered || undefined} style={{ ...style,
    ...(expanded ? { position: 'relative', zIndex: 20, pointerEvents: 'auto' } : {}),
    ...(covered ? { visibility: 'hidden' } : {}),
  }} />
}
export function DockBody({ group, active, offset = 36, children, onFocus }: { group: string; active: boolean; offset?: number; children: ReactNode; onFocus?: () => void }) {
  const dock = useDock()
  if (!dock?.host) return null
  const rect = dock.rects[group], kind = dock.state.groups.find((g) => g.id === group)?.kind
  const chosen = kind && dock.mobileGroups[kind] && dock.rects[dock.mobileGroups[kind]] ? dock.mobileGroups[kind!] : Object.keys(dock.rects).find((id) => dock.state.groups.some((g) => g.id === id && g.kind === kind))
  const expanded = dock.maximized === group
  const visible = active && !!rect && (!dock.maximized || expanded) && (dock.desktop || dock.foreground === kind && chosen === group)
  const bounds = expanded ? dock.expandedRect : rect
  const style = dock.desktop && bounds ? rectStyle({ ...bounds, y: bounds.y + offset, height: Math.max(0, bounds.height - offset) }) : { position: 'absolute' as const, inset: `${offset}px 0 0`, zIndex: 11 }
  // Desktop bodies must not trap their menus/dialogs below sibling resize handles.
  // Their rectangles already exclude headers and separators; mobile still needs panel layering.
  return createPortal(<div data-dock-body={group} data-workspace-panel={kind} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-deep" onPointerDownCapture={onFocus} onFocusCapture={onFocus} style={{ ...style, zIndex: expanded ? 20 : dock.desktop ? undefined : 11, display: visible ? 'flex' : 'none' }}>{children}</div>, dock.host)
}
export function DockGrip({ group }: { group: string }) {
  const dock = useDock()
  const { t } = useI18n()
  if (!dock?.desktop) return null
  return <span {...dock.dragProps(group)} title={t('panel.move')} aria-label={t('panel.move')} className="flex h-9 w-5 shrink-0 cursor-grab items-center justify-center text-ink-muted active:cursor-grabbing"><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">{[4, 8, 12].map((y) => <g key={y}><circle cx="4" cy={y} r="1" /><circle cx="8" cy={y} r="1" /></g>)}</svg></span>
}
