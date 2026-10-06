import { PanelCloseButton } from './panel-close-button'
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { SelectField } from '@mew/ui'
import { NavArrowDown, NavArrowRight, RefreshDouble, Page, Sort } from 'iconoir-react'
import { featureRows, type Feature, type FeatureRun, type FeatureSort, type FeatureStatus } from '../../shared/features'
import { editFeature, fetchFeatures, type FeatureSnapshot } from '../api/features'
import { useI18n } from '../i18n'
import { featurePanelState, type FeaturePanelState } from '../utils/feature-panel-state'
import { featureCopy, type FeatureCopy } from './feature-copy'
import { DockGrip } from './DockWorkspace'
import { FeatureIcon } from './feature-icon'
import './feature-development.css'

const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded px-2.5 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
const headerButton = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
function Status({ status, copy }: { status: FeatureStatus; copy: FeatureCopy }) {
  return <span className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-secondary" title={copy[status]}>
    <span data-feature-status={status} aria-label={copy[status]} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-feature-${status})` }} />
  </span>
}
function FeatureTitle({ feature, canEdit, workspace, onSaved }: { feature: Feature; canEdit: boolean; workspace: string; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const base = useRef(feature), pending = useRef(false)
  const save = async () => {
    if (!canEdit || pending.current || draft === null) return
    if (draft === base.current.title) { setDraft(null); setError(''); return }
    pending.current = true; setSaving(true); setError('')
    try {
      const { id, version, content, parentId } = base.current
      const { feature: next } = await editFeature(workspace, { id, version, content, parentId, title: draft })
      base.current = next; setDraft(next.title)
      await onSaved()
      setDraft(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { pending.current = false; setSaving(false) }
  }
  return <div className="min-w-0 flex-1">
    <input type="text" aria-label={feature.title} className="w-full min-w-0 truncate rounded bg-transparent text-sm text-ink focus:outline-2 focus:outline-ink" value={draft ?? feature.title} readOnly={!canEdit || saving} maxLength={300}
      onFocus={() => { if (canEdit && draft === null) { base.current = feature; setDraft(feature.title) } }}
      onChange={event => setDraft(event.target.value)} onBlur={() => void save()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(null); setError('') }
      }} />
    {error && <p role="alert" className="select-text text-xs text-danger">{error}</p>}
  </div>
}
type FeatureRow = ReturnType<typeof featureRows>[number]
interface FeatureTreeContext {
  workspace: string
  copy: FeatureCopy
  canEdit: boolean
  busy: boolean
  collapsed: ReadonlySet<string>
  childrenByParent: Map<string | null, FeatureRow[]>
  toggle: (id: string) => void
  onOpenFile: (path: string) => void
  onSaved: () => Promise<void>
}
function FeatureTreeNode({ row: { feature, depth, hasChildren }, ctx, stickyTop = 0 }: { row: FeatureRow; ctx: FeatureTreeContext; stickyTop?: number }) {
  const header = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(32)
  const open = hasChildren && !ctx.collapsed.has(feature.id)
  useLayoutEffect(() => {
    if (!hasChildren || !header.current) return
    const element = header.current
    const measure = () => {
      const height = element.getBoundingClientRect().height
      if (height > 0) setHeaderHeight(height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasChildren])
  return <li data-feature-node={feature.id} className="isolate min-w-0">
    <div ref={header} data-feature-header data-feature-sticky-depth={open ? depth : undefined}
      className={`flex min-h-8 items-start rounded hover:bg-surface-raised ${open ? 'sticky z-20 bg-surface' : ''}`}
      style={{ paddingLeft: depth * 14 + 4, top: open ? stickyTop : undefined }}>
      {hasChildren ? <button className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-secondary focus-visible:outline-2 focus-visible:outline-ink" type="button" aria-label={`${feature.title} ${open ? ctx.copy.collapse : ctx.copy.expand}`} aria-expanded={open} onClick={() => ctx.toggle(feature.id)}>
        {open ? <NavArrowDown width={13} height={13} aria-hidden="true" /> : <NavArrowRight width={13} height={13} aria-hidden="true" />}
      </button> : <span data-feature-leaf aria-hidden="true" className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-muted">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="2" /></svg>
      </span>}
      <div data-feature-id={feature.id} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 pr-2 text-sm font-medium text-ink" title={feature.title} style={{ scrollMarginTop: stickyTop }}>
        <Status status={feature.status} copy={ctx.copy} />
        <FeatureTitle key={ctx.workspace} feature={feature} canEdit={ctx.canEdit && !!feature.documentPath} workspace={ctx.workspace} onSaved={ctx.onSaved} />
      </div>
      {feature.documentPath && <button type="button" title={`${ctx.copy.document}: ${feature.documentPath}`} aria-label={`${ctx.copy.document}: ${feature.documentPath}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40" disabled={ctx.busy} onClick={() => ctx.onOpenFile(feature.documentPath!)}><Page width={15} height={15} aria-hidden="true" /></button>}
    </div>
    {open && <ul className="feature-tree-children relative min-w-0" data-feature-children={feature.id} style={{ '--feature-guide-left': `${depth * 14 + 12}px` } as React.CSSProperties}>
      {ctx.childrenByParent.get(feature.id)?.map(row => <FeatureTreeNode key={row.feature.id} row={row} ctx={ctx} stickyTop={stickyTop + headerHeight} />)}
    </ul>}
  </li>
}
export function FeatureDevelopment({ workspace, onClose, onOpenFile, requestCloseRef, initialState, onChange }: {
  workspace: string; onClose: () => void; onOpenFile: (path: string) => void; onOpenAgent: (run: FeatureRun) => void; canUseGit?: boolean; requestCloseRef?: Ref<(action?: () => void) => void>; initialState?: unknown; onChange?: (state: FeaturePanelState) => void
}) {
  const { locale } = useI18n(), copy = featureCopy[locale], heading = useId()
  const [data, setData] = useState<FeatureSnapshot | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [saved] = useState(() => featurePanelState(initialState))
  const [sort, setSort] = useState<FeatureSort>(saved.sort)
  const sortOptions = [{ value: 'updated', label: copy.updated }, { value: 'name', label: copy.nameSort }, { value: 'created', label: copy.created }]
  const [expanded, setExpanded] = useState(() => new Set(saved.expandedFeatures))
  const [scrollTop, setScrollTop] = useState(saved.scrollTop)
  const list = useRef<HTMLDivElement>(null), scrollRestored = useRef(false)
  const collapsed = useMemo(() => new Set((data?.features ?? []).filter(feature => !expanded.has(feature.id)).map(feature => feature.id)), [data?.features, expanded])
  useLayoutEffect(() => {
    if (!data || !list.current || scrollRestored.current) return
    list.current.scrollTop = saved.scrollTop
    scrollRestored.current = true
  }, [data, saved.scrollTop])
  useEffect(() => {
    onChange?.({ expandedFeatures: [...expanded], expandedSections: [], sort, scrollTop })
  }, [expanded, sort, scrollTop, onChange])
  const panel = useRef<HTMLElement>(null)
  const fetchSequence = useRef(0), alive = useRef(true), actionRef = useRef(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++fetchSequence.current
    const next = await fetchFeatures(workspace, signal)
    if (alive.current && sequence === fetchSequence.current && !signal?.aborted) { setData(next); setError('') }
  }, [workspace])
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { await refresh(controller.signal) } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(poll, 2000) } }
    }
    void poll()
    return () => { alive.current = false; controller.abort(); clearTimeout(timer) }
  }, [refresh])
  useImperativeHandle(requestCloseRef, () => (action = onClose) => action(), [onClose])
  const perform = async () => {
    if (actionRef.current) return
    actionRef.current = true; setBusy(true); setError('')
    try { await refresh() } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { actionRef.current = false; if (alive.current) setBusy(false) }
  }
  const toggle = (id: string) => {
    setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  const rows = useMemo(() => featureRows(data?.features ?? [], sort, collapsed, locale), [data?.features, sort, collapsed, locale])
  const childrenByParent = useMemo(() => {
    const groups = new Map<string | null, typeof rows>()
    for (const row of rows) {
      const siblings = groups.get(row.feature.parentId) ?? []
      siblings.push(row); groups.set(row.feature.parentId, siblings)
    }
    return groups
  }, [rows])
  const branches = useMemo(() => new Set((data?.features ?? []).flatMap(feature => feature.parentId ? [feature.parentId] : [])), [data?.features])
  const allExpanded = [...branches].every(id => expanded.has(id))
  const treeContext: FeatureTreeContext = { workspace, copy, canEdit: !!data?.canEdit, busy, collapsed, childrenByParent, toggle, onOpenFile, onSaved: refresh }
  return <section ref={panel} aria-labelledby={heading} aria-busy={busy} data-feature-panel className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
      <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
        <DockGrip group="features" />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
          <h2 id={heading} className="flex shrink-0 items-center gap-1.5 text-xs text-ink"><FeatureIcon width={14} height={14} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />{copy.title}</h2><span className="min-w-0 truncate text-xs text-ink-secondary" title={workspace}>{workspace.split('/').filter(Boolean).at(-1)}</span>
        </div>
        {data && !data.canEdit && <span className="shrink-0 text-xs text-ink-secondary">{copy.readOnly}</span>}
        <button type="button" className={headerButton} title={copy.refresh} aria-label={copy.refresh} disabled={busy} onClick={() => void perform()}><RefreshDouble width={14} height={14} /></button>
        <PanelCloseButton aria-label={copy.close} disabled={busy} onClick={() => onClose()} />
      </header>
      {error && <p role="alert" className="select-text shrink-0 border-b border-edge px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 px-2">
        <span className="mr-auto text-xs tabular-nums text-ink-secondary">{data?.features.length ?? 0} {copy.count}</span>
        <button type="button" className={button} disabled={!branches.size} onClick={() => setExpanded(allExpanded ? new Set() : new Set(branches))}>{allExpanded && branches.size ? copy.allCollapse : copy.allExpand}</button>
        <SelectField label={copy.sort} value={sort} options={sortOptions} onChange={value => setSort(value as FeatureSort)}
          className="feature-sort-field" triggerClassName="feature-sort-trigger" popupWidth={160} popupClassName="feature-sort-menu"
          triggerContent={<><Sort width={14} height={14} aria-hidden="true" /><span>{sortOptions.find(option => option.value === sort)?.label}</span><NavArrowDown width={12} height={12} aria-hidden="true" /></>} />
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" data-feature-list onScroll={event => { if (scrollRestored.current) setScrollTop(event.currentTarget.scrollTop) }}>
        {loading && !data && <p role="status" className="p-3 text-xs text-ink-secondary">{copy.load}</p>}
        {data && !rows.length && <p className="px-3 py-8 text-center text-sm text-ink-secondary">{copy.empty}</p>}
        <ul>
          {(childrenByParent.get(null) ?? []).map(row => <FeatureTreeNode key={row.feature.id} row={row} ctx={treeContext} />)}
        </ul>
      </div>
    </section>
}
