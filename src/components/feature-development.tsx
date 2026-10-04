import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type ReactNode } from 'react'
import { DialogFrame, SelectField } from '@mew/ui'
import { Xmark, NavArrowDown, NavArrowRight, RefreshDouble, Page } from 'iconoir-react'
import { featureRows, featureSpecification, pendingFeatureRun, type Feature, type FeatureCommit, type FeatureRun, type FeatureSort, type FeatureStatus } from '../../shared/features'
import { fetchFeatures, type FeatureSnapshot } from '../api/features'
import { fetchGitCommit, type GitCommitDetail } from '../api/client'
import { useI18n } from '../i18n'
import { presentedSpecificationItems, featureDocumentHref } from '../utils/feature-specification'
import { featurePanelState, type FeaturePanelState } from '../utils/feature-panel-state'
import { featureCopy, type FeatureCopy } from './feature-copy'
import { DockGrip } from './DockWorkspace'
import { FeatureIcon } from './feature-icon'
import './feature-specification.css'

const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded px-2.5 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
const headerButton = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
function Status({ status, copy }: { status: FeatureStatus; copy: FeatureCopy }) {
  return <span className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-secondary" title={copy[status]}>
    <span data-feature-status={status} aria-label={copy[status]} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-feature-${status})` }} />
  </span>
}
type Section = 'content' | 'summary' | 'validation' | 'children' | 'files' | 'commits'
function FeatureSection({ featureId, section, label, open, onToggle, children, copy }: {
  featureId: string; section: Section; label: string; open: boolean; onToggle?: () => void; children: ReactNode; copy: FeatureCopy
}) {
  const contentId = useId()
  return <li className="min-w-0" data-spec-section={section} data-feature-children={section === 'children' ? featureId : undefined}>
    <div className="flex min-h-8 items-center gap-1">
      <h3 className="min-w-0 text-xs font-medium text-ink-secondary">
        {onToggle ? <button type="button" className="flex min-h-8 items-center gap-1 rounded pr-1 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink" aria-label={`${label} ${open ? copy.collapse : copy.expand}`} aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
          {open ? <NavArrowDown width={13} height={13} aria-hidden="true" /> : <NavArrowRight width={13} height={13} aria-hidden="true" />}{label}
        </button> : <span className="pl-2">{label}</span>}
      </h3>
    </div>
    <div id={contentId} hidden={!open}>{open && children}</div>
  </li>
}
export function FeatureDevelopment({ workspace, onClose, onOpenFile, onOpenAgent, canUseGit = false, requestCloseRef, initialState, onChange }: {
  workspace: string; onClose: () => void; onOpenFile: (path: string) => void; onOpenAgent: (run: FeatureRun) => void; canUseGit?: boolean; requestCloseRef?: Ref<(action?: () => void) => void>; initialState?: unknown; onChange?: (state: FeaturePanelState) => void
}) {
  const { locale, formatDate } = useI18n(), copy = featureCopy[locale], heading = useId()
  const [data, setData] = useState<FeatureSnapshot | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [saved] = useState(() => featurePanelState(initialState))
  const [sort, setSort] = useState<FeatureSort>(saved.sort)
  const [expanded, setExpanded] = useState(() => new Set(saved.expandedFeatures))
  const [expandedSections, setExpandedSections] = useState(() => new Set(saved.expandedSections))
  const [scrollTop, setScrollTop] = useState(saved.scrollTop)
  const list = useRef<HTMLDivElement>(null), scrollRestored = useRef(false)
  const collapsed = useMemo(() => new Set((data?.features ?? []).filter(feature => !expanded.has(feature.id)).map(feature => feature.id)), [data?.features, expanded])
  useLayoutEffect(() => {
    if (!data || !list.current || scrollRestored.current) return
    list.current.scrollTop = saved.scrollTop
    scrollRestored.current = true
  }, [data, saved.scrollTop])
  useEffect(() => {
    onChange?.({ expandedFeatures: [...expanded], expandedSections: [...expandedSections], sort, scrollTop })
  }, [expanded, expandedSections, sort, scrollTop, onChange])
  const panel = useRef<HTMLElement>(null)
  const [commit, setCommit] = useState<FeatureCommit | null>(null)
  const fetchSequence = useRef(0), alive = useRef(true), actionRef = useRef(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++fetchSequence.current
    const next = await fetchFeatures(workspace, signal)
    if (alive.current && sequence === fetchSequence.current && !signal?.aborted) setData(next)
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
  const hasPending = (id: string) => !!data?.runs.some(run => (run.featureId === id || run.targetId === id) && pendingFeatureRun(run))
  const toggle = (id: string) => {
    setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  const sectionOpen = (feature: Feature, section: Section) => expandedSections.has(`${feature.id}:${section}`)
  const toggleSection = (feature: Feature, section: Section) => {
    setExpandedSections(previous => { const next = new Set(previous), key = `${feature.id}:${section}`; if (next.has(key)) next.delete(key); else next.add(key); return next })
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
  const featuresByDocument = useMemo(() => new Map((data?.features ?? []).flatMap(feature => feature.documentPath ? [[feature.documentPath, feature] as const] : [])), [data?.features])
  const openFeature = (feature: Feature) => {
    setExpanded(previous => {
      const next = new Set(previous)
      let current: Feature | undefined = feature
      while (current) { next.add(current.id); current = data?.features.find(item => item.id === current?.parentId) }
      return next
    })
    requestAnimationFrame(() => {
      const title = panel.current?.querySelector<HTMLElement>(`[data-feature-id="${feature.id}"]`)
      title?.scrollIntoView({ block: 'nearest' }); title?.focus({ preventScroll: true })
    })
  }
  const unassigned = (data?.runs ?? []).filter(run => !run.featureId && !run.targetId).toReversed()
  const runActions = (run: FeatureRun) => <span className="flex shrink-0 flex-wrap items-center gap-1">
    {run.state !== 'queued' && <button className={button} type="button" onClick={() => onOpenAgent(run)}>{copy.conversation}</button>}
  </span>
  const textItems = (feature: Feature, field: 'content' | 'summary' | 'validation', label: string) => {
    const source = featureSpecification(feature)[field]
    const children = childrenByParent.get(feature.id) ?? []
    const childPaths = new Set(children.map(row => row.feature.documentPath).filter((value): value is string => !!value))
    const items = presentedSpecificationItems(source, [feature.title, label, field === 'content' ? '요구사항' : field === 'summary' ? '구현 내용' : '검증', ...(field === 'content' && children.length ? ['하위 기능', '하위기능', copy.children] : [])])
      .filter(item => !(field === 'content' && item.linkHref && childPaths.has(featureDocumentHref(feature.documentPath, item.linkHref) ?? '')))
    return <FeatureSection featureId={feature.id} section={field} label={label} copy={copy} open={field === 'content' || sectionOpen(feature, field)} onToggle={field === 'content' ? undefined : () => toggleSection(feature, field)}>
      <ul className="min-w-0 space-y-0.5">
        {items.map(item => <li key={item.start} className="min-w-0" style={{ paddingLeft: item.indent * 12 }}>
            <div className={`feature-specification-preview select-text relative px-2 py-1 ${field === 'content' ? 'text-xs leading-5 text-ink-secondary' : 'min-h-8 text-sm leading-6 text-ink'}`} onClick={event => {
              const anchor = event.target instanceof Element ? event.target.closest('a') : null
              if (!anchor) return
              const file = featureDocumentHref(feature.documentPath, anchor.getAttribute('href') ?? '')
              if (file !== null) {
                event.preventDefault()
                const linkedFeature = featuresByDocument.get(file)
                if (linkedFeature) openFeature(linkedFeature)
                else onOpenFile(file)
              }
            }} dangerouslySetInnerHTML={{ __html: item.html }} />
        </li>)}
        {!items.length && <li className="px-2 py-1 text-xs text-ink-secondary">{copy.noChanges}</li>}
      </ul>
    </FeatureSection>
  }
  const renderFeature = ({ feature, depth }: (typeof rows)[number]): ReactNode => <li key={feature.id} data-feature-node={feature.id} style={{ marginLeft: depth > 0 && depth <= 6 ? 12 : 0 }} className="min-w-0">
    <div data-feature-header className="flex min-h-8 items-start rounded hover:bg-surface-raised">
      <button className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-secondary focus-visible:outline-2 focus-visible:outline-ink" type="button" aria-label={`${feature.title} ${collapsed.has(feature.id) ? copy.expand : copy.collapse}`} aria-expanded={!collapsed.has(feature.id)} onClick={() => toggle(feature.id)}>{collapsed.has(feature.id) ? <NavArrowRight width={13} height={13} /> : <NavArrowDown width={13} height={13} />}</button>
      <div data-feature-id={feature.id} tabIndex={-1} className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-ink" title={feature.title}><Status status={feature.status} copy={copy} /><span className="min-w-0 truncate select-text">{feature.title}</span></div>
      {feature.documentPath && <button type="button" title={`${copy.document}: ${feature.documentPath}`} aria-label={`${copy.document}: ${feature.documentPath}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40" disabled={busy} onClick={() => onOpenFile(feature.documentPath!)}><Page width={15} height={15} aria-hidden="true" /></button>}
    </div>
    {!collapsed.has(feature.id) && <div className="mb-1 ml-2.5 min-w-0 border-l border-edge pl-2.5" data-feature-specification>
      <ul className="min-w-0">
        {textItems(feature, 'content', copy.content)}
        {!!childrenByParent.get(feature.id)?.length && <FeatureSection featureId={feature.id} section="children" label={copy.children} copy={copy} open>
          <ul className="min-w-0">{childrenByParent.get(feature.id)!.map(renderFeature)}</ul>
        </FeatureSection>}
        {textItems(feature, 'summary', copy.implementation)}{textItems(feature, 'validation', copy.validation)}
        <FeatureSection featureId={feature.id} section="files" label={copy.files} copy={copy} open={sectionOpen(feature, 'files')} onToggle={() => toggleSection(feature, 'files')}><ul className="min-w-0">{feature.report?.files.length ? feature.report.files.map(file => <li key={file}><button type="button" className={`${button} max-w-full justify-start break-all text-left text-ink underline underline-offset-4`} onClick={() => onOpenFile(file)}>{file}</button></li>) : <li className="px-2 py-2 text-xs text-ink-secondary">{copy.noFiles}</li>}</ul></FeatureSection>
        <FeatureSection featureId={feature.id} section="commits" label={copy.commits} copy={copy} open={sectionOpen(feature, 'commits')} onToggle={() => toggleSection(feature, 'commits')}><ul className="min-w-0">{feature.report?.commits.length ? feature.report.commits.map(item => <li key={`${item.repository}:${item.hash}`}><button type="button" className={`${button} max-w-full justify-start break-all text-left`} disabled={!canUseGit} onClick={() => setCommit(item)}><span className="font-mono">{item.hash.slice(0, 8)}</span>{item.subject}</button></li>) : <li className="px-2 py-2 text-xs text-ink-secondary">{copy.noCommits}</li>}</ul></FeatureSection>
      </ul>
      <details className="text-xs text-ink-secondary" open={hasPending(feature.id) || undefined}><summary className="cursor-pointer py-2">{copy.history}</summary>{(data?.runs ?? []).filter(run => run.featureId === feature.id || run.targetId === feature.id).toReversed().map(run => <details key={run.id} open={pendingFeatureRun(run) || undefined}><summary className="cursor-pointer py-1.5">{copy[run.state]} · {run.agentSet.name} · {formatDate(run.createdAt)}</summary><div className="space-y-2 py-2 pl-2">{run.reason && <p>{copy.reason}: {run.reason}</p>}<p className="select-text whitespace-pre-wrap break-words">{run.title}{run.content ? `\n${run.content}` : ''}</p>{run.error && <p role="alert" className="select-text break-words text-danger">{run.error}</p>}{run.report && <p className="select-text whitespace-pre-wrap break-words">{run.report.summary}</p>}{runActions(run)}</div></details>)}</details>
    </div>}
  </li>
  return <>
    <section ref={panel} aria-labelledby={heading} aria-busy={busy} data-feature-panel className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
      <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
        <DockGrip group="features" />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
          <h2 id={heading} className="flex shrink-0 items-center gap-1.5 text-xs text-ink"><FeatureIcon width={14} height={14} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />{copy.title}</h2><span className="min-w-0 truncate text-xs text-ink-secondary" title={workspace}>{workspace.split('/').filter(Boolean).at(-1)}</span>
        </div>
        {data && <span className="shrink-0 text-xs text-ink-secondary">{copy.readOnly}</span>}
        <button type="button" className={headerButton} title={copy.refresh} aria-label={copy.refresh} disabled={busy} onClick={() => void perform()}><RefreshDouble width={14} height={14} /></button>
        <button type="button" className={`${headerButton} mx-1`} title={copy.close} aria-label={copy.close} disabled={busy} onClick={() => onClose()}><Xmark width={14} height={14} /></button>
      </header>
      {error && <p role="alert" className="select-text shrink-0 border-b border-edge px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 px-3">
        <span className="mr-auto text-xs tabular-nums text-ink-secondary">{data?.features.length ?? 0} {copy.count}</span>
        <button type="button" className={button} onClick={() => setExpanded(collapsed.size ? new Set(data?.features.map(feature => feature.id)) : new Set())}>{collapsed.size ? copy.allExpand : copy.allCollapse}</button>
        <div className="min-w-0 max-w-40"><SelectField label={copy.sort} value={sort} options={[{ value: 'updated', label: copy.updated }, { value: 'name', label: copy.nameSort }, { value: 'created', label: copy.created }]} onChange={value => setSort(value as FeatureSort)} /></div>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" data-feature-list onScroll={event => { if (scrollRestored.current) setScrollTop(event.currentTarget.scrollTop) }}>
        {loading && !data && <p role="status" className="p-3 text-xs text-ink-secondary">{copy.load}</p>}
        {data && !rows.length && !unassigned.length && <p className="px-3 py-8 text-center text-sm text-ink-secondary">{copy.empty}</p>}
        <ul>
          {(childrenByParent.get(null) ?? []).map(renderFeature)}
        </ul>
        {unassigned.length > 0 && <div className="mt-3 border-t border-edge px-2 pt-3"><p className="mb-2 text-xs text-ink-secondary">{copy.requests}</p>{unassigned.map(run => <div key={run.id} className="mb-3 text-xs"><p className="truncate text-ink" title={run.title}>{run.title}</p><p role="status" className="mt-1 text-ink-secondary">{copy[run.state]}</p>{run.error && <p className="select-text my-1 break-words text-danger">{run.error}</p>}{runActions(run)}</div>)}</div>}
      </div>
    </section>
    {commit && <FeatureCommitDialog copy={copy} commit={commit} onClose={() => setCommit(null)} />}
  </>
}
function FeatureCommitDialog({ copy, commit, onClose }: { copy: FeatureCopy; commit: FeatureCommit; onClose: () => void }) {
  const heading = useId(), [detail, setDetail] = useState<GitCommitDetail | null>(null), [error, setError] = useState('')
  useEffect(() => { let alive = true; void fetchGitCommit(commit.repository, commit.hash, '.workspace').then(value => { if (alive) setDetail(value) }).catch(cause => { if (alive) setError(cause.message) }); return () => { alive = false } }, [commit])
  return <DialogFrame labelledBy={heading} onClose={onClose} className="max-h-[85dvh] max-w-2xl overflow-y-auto"><div className="space-y-4 p-5"><div className="flex items-start justify-between gap-3"><h2 id={heading} className="select-text text-base font-semibold text-ink">{commit.subject}</h2><button type="button" className={button} aria-label={copy.close} onClick={onClose}><Xmark width={18} height={18} /></button></div><p className="select-text break-all font-mono text-xs text-ink-secondary">{commit.hash}</p>{error && <p role="alert" className="select-text text-danger">{error}</p>}{detail ? <><p className="select-text whitespace-pre-wrap text-sm text-ink-secondary">{detail.body}</p><ul className="space-y-1">{detail.files.map(file => <li key={file.path} className="select-text break-all text-sm text-ink-secondary"><span className="mr-2 font-mono text-xs text-ink-secondary">{file.status}</span>{file.path}</li>)}</ul></> : !error && <p role="status">{copy.load}</p>}</div></DialogFrame>
}
