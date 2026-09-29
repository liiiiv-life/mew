import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type ReactNode } from 'react'
import { DialogFrame, ConfirmDialog, SelectField } from '@mew/ui'
import { Plus, Xmark, NavArrowDown, NavArrowRight, RefreshDouble, Page } from 'iconoir-react'
import { featureRows, featureSpecification, pendingFeatureRun, type Feature, type FeatureCommit, type FeatureRun, type FeatureSort, type FeatureStatus, type FeatureSpecification } from '../../shared/features'
import { cancelFeatureRun, fetchFeatures, judgeFeature, requestFeature, type FeatureSnapshot } from '../api/features'
import { fetchAgentSets, fetchGitCommit, type AgentSet, type GitCommitDetail } from '../api/client'
import { useI18n } from '../i18n'
import { presentedSpecificationItems, replaceSpecificationItem, featureDocumentHref } from '../utils/feature-specification'
import { featurePanelState, type FeaturePanelState } from '../utils/feature-panel-state'
import { featureCopy, type FeatureCopy } from './feature-copy'
import { DockGrip } from './DockWorkspace'
import { FeatureIcon } from './feature-icon'
import './feature-specification.css'

const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded px-2.5 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
const headerButton = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
const input = 'min-h-9 w-full min-w-0 rounded border border-edge-strong bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-2 focus:outline-ink disabled:opacity-60'
function Status({ status, copy }: { status: FeatureStatus; copy: FeatureCopy }) {
  return <span className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-secondary" title={copy[status]}>
    <span data-feature-status={status} aria-label={copy[status]} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-feature-${status})` }} />
  </span>
}
type Field = Exclude<keyof FeatureSpecification, 'parentId'>
type Section = Exclude<Field, 'title'> | 'children' | 'files' | 'commits'
function FeatureSection({ featureId, section, label, open, onToggle, action, children, copy }: {
  featureId: string; section: Section; label: string; open: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode; copy: FeatureCopy
}) {
  const contentId = useId()
  return <li className="min-w-0" data-spec-section={section} data-feature-children={section === 'children' ? featureId : undefined}>
    <div className="flex min-h-8 items-center gap-1">
      <h3 className="min-w-0 text-xs font-medium text-ink-secondary">
        <button type="button" className="flex min-h-8 items-center gap-1 rounded pr-1 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink" aria-label={`${label} ${open ? copy.collapse : copy.expand}`} aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
          {open ? <NavArrowDown width={13} height={13} aria-hidden="true" /> : <NavArrowRight width={13} height={13} aria-hidden="true" />}{label}
        </button>
      </h3>
      {action}
    </div>
    <div id={contentId} hidden={!open}>{open && children}</div>
  </li>
}
type Edit = { base: Feature; field: Field; start: number; end: number; original: string; text: string }
type RequestTarget = { target?: Feature; parent?: Feature; retry?: FeatureRun }
type RequestDraft = RequestTarget & { content: string; initialContent: string }

export function FeatureDevelopment({ workspace, onClose, onOpenFile, onOpenAgent, canUseGit = false, requestCloseRef, initialState, onChange }: {
  workspace: string; onClose: () => void; onOpenFile: (path: string) => void; onOpenAgent: (run: FeatureRun) => void; canUseGit?: boolean; requestCloseRef?: Ref<(action?: () => void) => void>; initialState?: unknown; onChange?: (state: FeaturePanelState) => void
}) {
  const { locale, formatDate } = useI18n(), copy = featureCopy[locale], heading = useId()
  const [data, setData] = useState<FeatureSnapshot | null>(null), [sets, setSets] = useState<AgentSet[]>([])
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
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
  const [edit, setEdit] = useState<Edit | null>(null), [request, setRequest] = useState<RequestDraft | null>(null)
  const [discard, setDiscard] = useState<(() => void) | null>(null), [setId, setSetId] = useState('')
  const attempt = useRef({ fingerprint: '', id: '' })
  const requestInput = useRef<HTMLTextAreaElement>(null), editInput = useRef<HTMLTextAreaElement>(null), addButton = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLElement>(null)
  const [commit, setCommit] = useState<FeatureCommit | null>(null)
  const mutation = useRef(0), fetchSequence = useRef(0), alive = useRef(true), actionRef = useRef(false)
  const dirty = !!edit && edit.text !== edit.original, requestDirty = !!request && request.content !== request.initialContent
  const selectedSet = sets.find(set => set.id === setId) ?? sets.find(set => set.id === data?.runs.at(-1)?.agentSet.id) ?? sets[0]
  const readOnly = !data?.canEdit
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const started = mutation.current, sequence = ++fetchSequence.current
    const next = await fetchFeatures(workspace, signal)
    if (alive.current && started === mutation.current && sequence === fetchSequence.current && !signal?.aborted) setData(next)
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
    void fetchAgentSets().then(result => { if (!controller.signal.aborted) setSets(result.sets) }).catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
    return () => { alive.current = false; controller.abort(); clearTimeout(timer) }
  }, [refresh])
  useEffect(() => {
    if (!dirty && !requestDirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, requestDirty])
  const editKey = edit ? `${edit.base.id}:${edit.field}:${edit.start}` : ''
  useEffect(() => { editInput.current?.focus(); titleInput.current?.focus(); titleInput.current?.select() }, [editKey])
  const composing = !!request
  useEffect(() => { if (composing) requestInput.current?.focus() }, [composing])
  useEffect(() => { if (!setId && data && selectedSet) setSetId(selectedSet.id) }, [setId, data, selectedSet])
  const guarded = (action: () => void) => { if (actionRef.current) return; if (dirty || requestDirty) setDiscard(() => action); else action() }
  useImperativeHandle(requestCloseRef, () => (action = onClose) => guarded(action))
  const perform = async (action: () => Promise<void>) => {
    if (actionRef.current) return
    actionRef.current = true; mutation.current++; setBusy(true); setError(''); setNotice('')
    try { await action(); await refresh() } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { actionRef.current = false; if (alive.current) setBusy(false) }
  }
  const requestId = (value: unknown) => {
    const fingerprint = JSON.stringify(value)
    if (attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() }
    return attempt.current.id
  }
  const hasPending = (id: string) => !!data?.runs.some(run => (run.featureId === id || run.targetId === id) && pendingFeatureRun(run))
  const apply = () => {
    if (!edit || !dirty || !selectedSet || readOnly || hasPending(edit.base.id)) return
    const specification = featureSpecification(edit.base)
    specification[edit.field] = replaceSpecificationItem(specification[edit.field], edit.start, edit.end, edit.text).trim()
    if (!specification.title.trim()) return
    const value = { title: specification.title, content: specification.content, agentSetId: selectedSet.id, targetId: edit.base.id, expectedVersion: edit.base.version, edit: specification }
    const id = requestId(value)
    void perform(async () => {
      await requestFeature(workspace, { ...value, id })
      if (alive.current) { setEdit(null); setNotice(copy.submitted) }
    })
  }
  const beginEdit = (feature: Feature, field: Field, start: number, end: number, text: string) => guarded(() => {
    setRequest(null); setError(''); setNotice('')
    setExpandedSections(previous => { const next = new Set(previous); next.add(`${feature.id}:${field}`); return next })
    setEdit({ base: feature, field, start, end, original: text.trimEnd(), text: text.trimEnd() })
  })
  const cancelEdit = () => {
    if (!edit) return
    const selector = edit.field === 'title' ? `[data-feature-id="${edit.base.id}"]`
      : `[data-feature-node="${edit.base.id}"] [data-spec-section="${edit.field}"] [data-spec-start="${edit.start}"]`
    setEdit(null)
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>(selector)?.focus())
  }
  const openRequest = (target: RequestTarget) => guarded(() => {
    const content = target.retry?.content || target.target?.content || target.target?.title || target.retry?.title || ''
    setEdit(null); setRequest({ ...target, content, initialContent: content })
    requestAnimationFrame(() => requestInput.current?.scrollIntoView({ block: 'nearest' }))
  })
  const submitRequest = () => {
    if (!request || !request.content.trim() || !selectedSet || readOnly) return
    const title = request.target?.title ?? request.retry?.title ?? request.content.trim().split(/\r?\n/, 1)[0].slice(0, 300)
    const value = { title, content: request.content, agentSetId: selectedSet.id, targetId: request.target?.id ?? request.retry?.targetId ?? undefined, parentId: request.target ? undefined : request.parent?.id ?? request.retry?.parentId ?? undefined, expectedVersion: request.target?.version }
    const id = requestId(value)
    void perform(async () => { await requestFeature(workspace, { ...value, id }); setRequest(null); setNotice(copy.submitted); addButton.current?.focus() })
  }
  const toggle = (id: string) => guarded(() => {
    setEdit(null)
    setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  })
  const sectionOpen = (feature: Feature, section: Section) => expandedSections.has(`${feature.id}:${section}`)
  const toggleSection = (feature: Feature, section: Section) => {
    if (actionRef.current) return
    let hidesEdit = edit?.base.id === feature.id && edit.field === section
    if (section === 'children' && edit) {
      let parentId = edit.base.parentId
      while (parentId) {
        if (parentId === feature.id) { hidesEdit = true; break }
        parentId = data?.features.find(item => item.id === parentId)?.parentId ?? null
      }
    }
    const change = () => {
      if (hidesEdit) setEdit(null)
      setExpandedSections(previous => { const next = new Set(previous), key = `${feature.id}:${section}`; if (next.has(key)) next.delete(key); else next.add(key); return next })
    }
    if (sectionOpen(feature, section) && hidesEdit) guarded(change)
    else change()
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
  const openFeature = (feature: Feature) => guarded(() => {
    setEdit(null)
    setExpanded(previous => {
      const next = new Set(previous)
      let current: Feature | undefined = feature
      while (current) { next.add(current.id); current = data?.features.find(item => item.id === current?.parentId) }
      return next
    })
    setExpandedSections(previous => {
      const next = new Set(previous)
      let parentId = feature.parentId
      while (parentId) { next.add(`${parentId}:children`); parentId = data?.features.find(item => item.id === parentId)?.parentId ?? null }
      return next
    })
    requestAnimationFrame(() => {
      const title = panel.current?.querySelector<HTMLButtonElement>(`[data-feature-id="${feature.id}"]`)
      title?.scrollIntoView({ block: 'nearest' }); title?.focus({ preventScroll: true })
    })
  })
  const unassigned = (data?.runs ?? []).filter(run => !run.featureId && !run.targetId).toReversed()
  const runActions = (run: FeatureRun) => <span className="flex shrink-0 flex-wrap items-center gap-1">
    {run.state !== 'queued' && <button className={button} type="button" onClick={() => guarded(() => onOpenAgent(run))}>{copy.conversation}</button>}
    {!readOnly && pendingFeatureRun(run) && <button className={button} type="button" disabled={busy || run.state === 'cancelling'} onClick={() => void perform(async () => { await cancelFeatureRun(workspace, run.id) })}>{copy.stop}</button>}
    {!readOnly && !pendingFeatureRun(run) && run.state !== 'completed' && <button className={button} type="button" disabled={busy} onClick={() => openRequest({ retry: run, target: data?.features.find(feature => feature.id === (run.featureId ?? run.targetId)) })}>{copy.retry}</button>}
  </span>
  const editor = (feature: Feature) => {
    if (!edit || edit.base.id !== feature.id) return null
    const current = data?.features.find(item => item.id === feature.id)
    return <form data-feature-editor className={`min-w-0 flex-1 space-y-2 ${edit.field === 'title' ? 'py-0.5' : 'py-2'}`} onSubmit={event => { event.preventDefault(); apply() }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) { if (event.key === 'Enter' && edit.field === 'title') event.preventDefault(); return }
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); if (!busy) cancelEdit() }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); apply() }
    }}>
      {current && current.version !== edit.base.version && <p role="status" className="text-xs text-warning">{copy.conflict}<button type="button" className={button} onClick={() => guarded(() => setEdit(null))}>{copy.reload}</button></p>}
      {!current && <p role="status" className="text-xs text-warning">{copy.removed}</p>}
      {edit.field === 'title'
        ? <input ref={titleInput} aria-label={copy.name} className={input} maxLength={300} value={edit.text} disabled={busy || readOnly} onChange={event => setEdit({ ...edit, text: event.target.value })} />
        : <textarea ref={editInput} aria-label={copy[edit.field === 'summary' ? 'implementation' : edit.field]} className={`${input} block resize-y leading-6`} rows={Math.min(14, Math.max(3, edit.text.split('\n').length))} maxLength={edit.field === 'validation' ? 20_000 : 40_000} value={edit.text} disabled={busy || readOnly} onChange={event => setEdit({ ...edit, text: event.target.value })} />}
      {hasPending(feature.id) && <p role="status" className="text-xs text-ink-secondary">{copy.pendingEdit}</p>}
      <div className="flex flex-wrap justify-end gap-1"><button type="button" className={button} disabled={busy} onClick={cancelEdit}>{copy.cancel}</button><button type="submit" className={`${button} bg-surface-raised text-ink`} disabled={busy || readOnly || !dirty || !selectedSet || !current || hasPending(feature.id) || (edit.field === 'title' && !edit.text.trim())}>{busy ? copy.starting : copy.apply}</button></div>
    </form>
  }
  const textItems = (feature: Feature, field: 'content' | 'summary' | 'validation', label: string) => {
    const source = featureSpecification(edit?.base.id === feature.id && edit.field === field ? edit.base : feature)[field]
    const children = childrenByParent.get(feature.id) ?? []
    const childPaths = new Set(children.map(row => row.feature.documentPath).filter((value): value is string => !!value))
    const items = presentedSpecificationItems(source, [feature.title, label, field === 'content' ? '요구사항' : field === 'summary' ? '구현 내용' : '검증', ...(field === 'content' && children.length ? ['하위 기능', '하위기능', copy.children] : [])])
      .filter(item => !(field === 'content' && item.linkHref && childPaths.has(featureDocumentHref(feature.documentPath, item.linkHref) ?? '')))
    return <FeatureSection featureId={feature.id} section={field} label={label} copy={copy} open={sectionOpen(feature, field)} onToggle={() => toggleSection(feature, field)} action={!readOnly && <button type="button" className="flex h-8 w-5 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40" aria-label={`${label} ${copy.addItem}`} disabled={busy} onClick={() => beginEdit(feature, field, source.length, source.length, '')}><Plus width={13} height={13} /></button>}>
      <ul className="min-w-0 space-y-0.5">
        {items.map(item => <li key={item.start} className="min-w-0" style={{ paddingLeft: item.indent * 12 }}>
          {edit?.base.id === feature.id && edit.field === field && edit.start === item.start ? editor(feature) : <div className="relative min-w-0 rounded hover:bg-surface-hover focus-within:outline-2 focus-within:outline-ink">
            <button type="button" data-spec-item data-spec-start={item.start} aria-label={`${label} ${copy.edit}: ${item.label}`} className="absolute inset-0 h-full w-full rounded focus:outline-none disabled:cursor-text" disabled={readOnly || busy} onClick={() => beginEdit(feature, field, item.start, item.end, item.text)} />
            <div className="feature-specification-preview pointer-events-none relative min-h-8 px-2 py-1 text-sm leading-6 text-ink" onClick={event => {
              const anchor = event.target instanceof Element ? event.target.closest('a') : null
              if (!anchor) return
              const file = featureDocumentHref(feature.documentPath, anchor.getAttribute('href') ?? '')
              if (file !== null) {
                event.preventDefault()
                const linkedFeature = featuresByDocument.get(file)
                if (linkedFeature) openFeature(linkedFeature)
                else guarded(() => onOpenFile(file))
              }
            }} dangerouslySetInnerHTML={{ __html: item.html }} />
          </div>}
        </li>)}
        {edit?.base.id === feature.id && edit.field === field && edit.start === source.length && <li>{editor(feature)}</li>}
        {!items.length && !(edit?.base.id === feature.id && edit.field === field) && <li className="px-2 py-1 text-xs text-ink-secondary">{copy.noChanges}</li>}
      </ul>
    </FeatureSection>
  }
  const renderFeature = ({ feature, depth }: (typeof rows)[number]): ReactNode => <li key={feature.id} data-feature-node={feature.id} style={{ marginLeft: depth > 0 && depth <= 6 ? 12 : 0 }} className="min-w-0">
    <div data-feature-header className="flex min-h-8 items-start rounded hover:bg-surface-raised">
      <button className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-secondary focus-visible:outline-2 focus-visible:outline-ink" type="button" aria-label={`${feature.title} ${collapsed.has(feature.id) ? copy.expand : copy.collapse}`} aria-expanded={!collapsed.has(feature.id)} onClick={() => toggle(feature.id)}>{collapsed.has(feature.id) ? <NavArrowRight width={13} height={13} /> : <NavArrowDown width={13} height={13} />}</button>
      {edit?.base.id === feature.id && edit.field === 'title' ? <><span className="flex h-8 items-center pr-2"><Status status={feature.status} copy={copy} /></span>{editor(feature)}</> : <button type="button" data-feature-id={feature.id} className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2 text-left text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-text" title={feature.title} aria-label={`${copy.name} ${copy.edit}: ${feature.title}`} disabled={readOnly || busy} onClick={() => beginEdit(feature, 'title', 0, feature.title.length, feature.title)}><Status status={feature.status} copy={copy} /><span className="min-w-0 truncate">{feature.title}</span></button>}
      {feature.documentPath && <button type="button" title={`${copy.document}: ${feature.documentPath}`} aria-label={`${copy.document}: ${feature.documentPath}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40" disabled={busy} onClick={() => guarded(() => onOpenFile(feature.documentPath!))}><Page width={15} height={15} aria-hidden="true" /></button>}
    </div>
    {!collapsed.has(feature.id) && <div className="mb-1 ml-2.5 min-w-0 border-l border-edge pl-2.5" data-feature-specification>
      <ul className="min-w-0">
        {textItems(feature, 'content', copy.content)}
        {!!childrenByParent.get(feature.id)?.length && <FeatureSection featureId={feature.id} section="children" label={copy.children} copy={copy} open={sectionOpen(feature, 'children')} onToggle={() => toggleSection(feature, 'children')}>
          <ul className="min-w-0">{childrenByParent.get(feature.id)!.map(renderFeature)}</ul>
        </FeatureSection>}
        {textItems(feature, 'summary', copy.implementation)}{textItems(feature, 'validation', copy.validation)}
        <FeatureSection featureId={feature.id} section="files" label={copy.files} copy={copy} open={sectionOpen(feature, 'files')} onToggle={() => toggleSection(feature, 'files')}><ul className="min-w-0">{feature.report?.files.length ? feature.report.files.map(file => <li key={file}><button type="button" className={`${button} max-w-full justify-start break-all text-left text-ink underline underline-offset-4`} onClick={() => guarded(() => onOpenFile(file))}>{file}</button></li>) : <li className="px-2 py-2 text-xs text-ink-secondary">{copy.noFiles}</li>}</ul></FeatureSection>
        <FeatureSection featureId={feature.id} section="commits" label={copy.commits} copy={copy} open={sectionOpen(feature, 'commits')} onToggle={() => toggleSection(feature, 'commits')}><ul className="min-w-0">{feature.report?.commits.length ? feature.report.commits.map(item => <li key={`${item.repository}:${item.hash}`}><button type="button" className={`${button} max-w-full justify-start break-all text-left`} disabled={!canUseGit} onClick={() => setCommit(item)}><span className="font-mono">{item.hash.slice(0, 8)}</span>{item.subject}</button></li>) : <li className="px-2 py-2 text-xs text-ink-secondary">{copy.noCommits}</li>}</ul></FeatureSection>
      </ul>
      {!readOnly && <div className="flex flex-wrap gap-1 py-1">
        <button type="button" className={button} disabled={busy} onClick={() => guarded(() => void perform(async () => { await judgeFeature(workspace, feature.id, feature.version, 'verified') }))}>{copy.verify}</button>
        <button type="button" className={button} disabled={busy} onClick={() => guarded(() => void perform(async () => { await judgeFeature(workspace, feature.id, feature.version, 'needs-fix') }))}>{copy.needsFix}</button>
        <button type="button" className={button} disabled={busy || hasPending(feature.id)} onClick={() => openRequest({ target: feature })}>{copy.handoff}</button>
        <button type="button" className={button} disabled={busy} onClick={() => openRequest({ parent: feature })}><Plus width={13} height={13} />{copy.child}</button>
      </div>}
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
        {readOnly && data && <span className="shrink-0 text-xs text-ink-secondary">{copy.readOnly}</span>}
        <button type="button" className={headerButton} title={copy.refresh} aria-label={copy.refresh} disabled={busy} onClick={() => void perform(async () => {})}><RefreshDouble width={14} height={14} /></button>
        <button type="button" className={`${headerButton} mx-1`} title={copy.close} aria-label={copy.close} disabled={busy} onClick={() => guarded(onClose)}><Xmark width={14} height={14} /></button>
      </header>
      <div className="shrink-0 space-y-1 border-b border-edge px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-ink-secondary"><span className="shrink-0">{copy.agentSet}</span><div className="min-w-0 max-w-xs flex-1"><SelectField label={copy.agentSet} value={selectedSet?.id ?? ''} disabled={readOnly || busy || !sets.length} options={sets.length ? sets.map(set => ({ value: set.id, label: `${set.name} · ${set.runtime}` })) : [{ value: '', label: copy.agentSet, disabled: true }]} onChange={setSetId} /></div></div>
        {!sets.length && !loading && <p className="text-xs leading-5 text-ink-secondary">{copy.noSets}</p>}
      </div>
      {error && <p role="alert" className="select-text shrink-0 border-b border-edge px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="shrink-0 px-3 py-1 text-xs text-ink-secondary">{notice}</p>}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 px-3">
        <span className="mr-auto text-xs tabular-nums text-ink-secondary">{data?.features.length ?? 0} {copy.count}</span>
        <button type="button" className={button} onClick={() => guarded(() => { setEdit(null); setExpanded(collapsed.size ? new Set(data?.features.map(feature => feature.id)) : new Set()) })}>{collapsed.size ? copy.allExpand : copy.allCollapse}</button>
        <div className="min-w-0 max-w-40"><SelectField label={copy.sort} value={sort} options={[{ value: 'updated', label: copy.updated }, { value: 'name', label: copy.nameSort }, { value: 'created', label: copy.created }]} onChange={value => setSort(value as FeatureSort)} /></div>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" data-feature-list onScroll={event => { if (scrollRestored.current) setScrollTop(event.currentTarget.scrollTop) }}>
        <button ref={addButton} type="button" aria-expanded={!!request} className={`${button} mb-1 h-8 w-full justify-start text-ink`} disabled={readOnly || busy} onClick={() => openRequest({})}><Plus width={15} height={15} />{copy.add}</button>
        {request && <form aria-label={copy.add} className="mb-3 space-y-2 px-2" onSubmit={event => { event.preventDefault(); submitRequest() }}>
          {(request.target || request.parent) && <p className="truncate text-xs text-ink-secondary">{request.parent ? copy.parent : copy.source}: {request.parent?.title ?? request.target?.title}</p>}
          <textarea ref={requestInput} aria-label={copy.requestContent} placeholder={copy.requestPlaceholder} className={`${input} block resize-y leading-5`} rows={3} maxLength={40_000} value={request.content} disabled={busy || readOnly} onChange={event => setRequest({ ...request, content: event.target.value })} />
          <div className="flex justify-end gap-1"><button type="button" className={button} disabled={busy} onClick={() => guarded(() => { setRequest(null); addButton.current?.focus() })}>{copy.cancel}</button><button type="submit" className={`${button} bg-surface-raised text-ink`} disabled={busy || readOnly || !request.content.trim() || !selectedSet}>{busy ? copy.starting : copy.submit}</button></div>
        </form>}
        {loading && !data && <p role="status" className="p-3 text-xs text-ink-secondary">{copy.load}</p>}
        {data && !rows.length && !unassigned.length && <p className="px-3 py-8 text-center text-sm text-ink-secondary">{copy.empty}</p>}
        <ul>
          {(childrenByParent.get(null) ?? []).map(renderFeature)}
        </ul>
        {edit && data && !data.features.some(feature => feature.id === edit.base.id) && <div className="p-2"><p className="text-sm text-ink">{edit.base.title}</p>{editor(edit.base)}</div>}
        {unassigned.length > 0 && <div className="mt-3 border-t border-edge px-2 pt-3"><p className="mb-2 text-xs text-ink-secondary">{copy.requests}</p>{unassigned.map(run => <div key={run.id} className="mb-3 text-xs"><p className="truncate text-ink" title={run.title}>{run.title}</p><p role="status" className="mt-1 text-ink-secondary">{copy[run.state]}</p>{run.error && <p className="select-text my-1 break-words text-danger">{run.error}</p>}{runActions(run)}</div>)}</div>}
      </div>
    </section>
    {discard && <ConfirmDialog message={copy.unsaved} confirmLabel={copy.discard} cancelLabel={copy.cancel} danger onConfirm={() => { const action = discard; setDiscard(null); setEdit(null); setRequest(null); action() }} onCancel={() => setDiscard(null)} />}
    {commit && <FeatureCommitDialog copy={copy} commit={commit} onClose={() => setCommit(null)} />}
  </>
}
function FeatureCommitDialog({ copy, commit, onClose }: { copy: FeatureCopy; commit: FeatureCommit; onClose: () => void }) {
  const heading = useId(), [detail, setDetail] = useState<GitCommitDetail | null>(null), [error, setError] = useState('')
  useEffect(() => { let alive = true; void fetchGitCommit(commit.repository, commit.hash, '.workspace').then(value => { if (alive) setDetail(value) }).catch(cause => { if (alive) setError(cause.message) }); return () => { alive = false } }, [commit])
  return <DialogFrame labelledBy={heading} onClose={onClose} className="max-h-[85dvh] max-w-2xl overflow-y-auto"><div className="space-y-4 p-5"><div className="flex items-start justify-between gap-3"><h2 id={heading} className="select-text text-base font-semibold text-ink">{commit.subject}</h2><button type="button" className={button} aria-label={copy.close} onClick={onClose}><Xmark width={18} height={18} /></button></div><p className="select-text break-all font-mono text-xs text-ink-secondary">{commit.hash}</p>{error && <p role="alert" className="select-text text-danger">{error}</p>}{detail ? <><p className="select-text whitespace-pre-wrap text-sm text-ink-secondary">{detail.body}</p><ul className="space-y-1">{detail.files.map(file => <li key={file.path} className="select-text break-all text-sm text-ink-secondary"><span className="mr-2 font-mono text-xs text-ink-secondary">{file.status}</span>{file.path}</li>)}</ul></> : !error && <p role="status">{copy.load}</p>}</div></DialogFrame>
}
