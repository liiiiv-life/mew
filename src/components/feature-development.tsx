import { PanelCloseButton } from './panel-close-button'
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type ReactNode } from 'react'
import { SelectField } from '@mew/ui'
import { NavArrowDown, NavArrowRight, RefreshDouble, Page } from 'iconoir-react'
import { featureRows, type FeatureRun, type FeatureSort, type FeatureStatus } from '../../shared/features'
import { fetchFeatures, type FeatureSnapshot } from '../api/features'
import { useI18n } from '../i18n'
import { featurePanelState, type FeaturePanelState } from '../utils/feature-panel-state'
import { featureCopy, type FeatureCopy } from './feature-copy'
import { DockGrip } from './DockWorkspace'
import { FeatureIcon } from './feature-icon'

const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded px-2.5 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
const headerButton = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
function Status({ status, copy }: { status: FeatureStatus; copy: FeatureCopy }) {
  return <span className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-secondary" title={copy[status]}>
    <span data-feature-status={status} aria-label={copy[status]} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-feature-${status})` }} />
  </span>
}
export function FeatureDevelopment({ workspace, onClose, onOpenFile, requestCloseRef, initialState, onChange }: {
  workspace: string; onClose: () => void; onOpenFile: (path: string) => void; onOpenAgent: (run: FeatureRun) => void; canUseGit?: boolean; requestCloseRef?: Ref<(action?: () => void) => void>; initialState?: unknown; onChange?: (state: FeaturePanelState) => void
}) {
  const { locale } = useI18n(), copy = featureCopy[locale], heading = useId()
  const [data, setData] = useState<FeatureSnapshot | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [saved] = useState(() => featurePanelState(initialState))
  const [sort, setSort] = useState<FeatureSort>(saved.sort)
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
  const renderFeature = ({ feature, depth, hasChildren }: (typeof rows)[number]): ReactNode => <li key={feature.id} data-feature-node={feature.id} style={{ marginLeft: depth > 0 && depth <= 6 ? 12 : 0 }} className="min-w-0">
    <div data-feature-header className="flex min-h-8 items-start rounded hover:bg-surface-raised">
      {hasChildren ? <button className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-secondary focus-visible:outline-2 focus-visible:outline-ink" type="button" aria-label={`${feature.title} ${collapsed.has(feature.id) ? copy.expand : copy.collapse}`} aria-expanded={!collapsed.has(feature.id)} onClick={() => toggle(feature.id)}>{collapsed.has(feature.id) ? <NavArrowRight width={13} height={13} aria-hidden="true" /> : <NavArrowDown width={13} height={13} aria-hidden="true" />}</button> : <span className="w-5 shrink-0" aria-hidden="true" />}
      <div data-feature-id={feature.id} className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2 text-sm font-medium text-ink" title={feature.title}>
        <Status status={feature.status} copy={copy} />
        <button type="button" className="min-w-0 truncate select-text text-left focus-visible:outline-2 focus-visible:outline-ink" disabled={!feature.documentPath} onClick={() => onOpenFile(feature.documentPath!)}>{feature.title}</button>
      </div>
      {feature.documentPath && <button type="button" title={`${copy.document}: ${feature.documentPath}`} aria-label={`${copy.document}: ${feature.documentPath}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40" disabled={busy} onClick={() => onOpenFile(feature.documentPath!)}><Page width={15} height={15} aria-hidden="true" /></button>}
    </div>
    {hasChildren && !collapsed.has(feature.id) && <ul className="mb-1 ml-2.5 min-w-0 border-l border-edge pl-2.5" data-feature-children={feature.id}>{childrenByParent.get(feature.id)?.map(renderFeature)}</ul>}
  </li>
  return <section ref={panel} aria-labelledby={heading} aria-busy={busy} data-feature-panel className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
      <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
        <DockGrip group="features" />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
          <h2 id={heading} className="flex shrink-0 items-center gap-1.5 text-xs text-ink"><FeatureIcon width={14} height={14} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />{copy.title}</h2><span className="min-w-0 truncate text-xs text-ink-secondary" title={workspace}>{workspace.split('/').filter(Boolean).at(-1)}</span>
        </div>
        {data && <span className="shrink-0 text-xs text-ink-secondary">{copy.readOnly}</span>}
        <button type="button" className={headerButton} title={copy.refresh} aria-label={copy.refresh} disabled={busy} onClick={() => void perform()}><RefreshDouble width={14} height={14} /></button>
        <PanelCloseButton aria-label={copy.close} disabled={busy} onClick={() => onClose()} />
      </header>
      {error && <p role="alert" className="select-text shrink-0 border-b border-edge px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 px-3">
        <span className="mr-auto text-xs tabular-nums text-ink-secondary">{data?.features.length ?? 0} {copy.count}</span>
        <button type="button" className={button} disabled={!branches.size} onClick={() => setExpanded(allExpanded ? new Set() : new Set(branches))}>{allExpanded && branches.size ? copy.allCollapse : copy.allExpand}</button>
        <div className="min-w-0 max-w-40"><SelectField label={copy.sort} value={sort} options={[{ value: 'updated', label: copy.updated }, { value: 'name', label: copy.nameSort }, { value: 'created', label: copy.created }]} onChange={value => setSort(value as FeatureSort)} /></div>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" data-feature-list onScroll={event => { if (scrollRestored.current) setScrollTop(event.currentTarget.scrollTop) }}>
        {loading && !data && <p role="status" className="p-3 text-xs text-ink-secondary">{copy.load}</p>}
        {data && !rows.length && <p className="px-3 py-8 text-center text-sm text-ink-secondary">{copy.empty}</p>}
        <ul>
          {(childrenByParent.get(null) ?? []).map(renderFeature)}
        </ul>
      </div>
    </section>
}
