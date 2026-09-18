import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { DialogFrame, ConfirmDialog } from '@mew/ui'
import { Plus, Xmark, NavArrowDown, NavArrowRight, ArrowLeft, RefreshDouble } from 'iconoir-react'
import { featureRows, pendingFeatureRun, type Feature, type FeatureCommit, type FeatureRun, type FeatureSort, type FeatureStatus } from '../../shared/features'
import { cancelFeatureRun, editFeature, fetchFeatures, judgeFeature, requestFeature, type FeatureSnapshot } from '../api/features'
import { fetchAgentSets, fetchGitCommit, type AgentSet, type GitCommitDetail } from '../api/client'
import { useI18n } from '../i18n'
import { featureCopy, type FeatureCopy } from './feature-copy'

const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded px-2.5 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
const input = 'min-h-9 w-full min-w-0 rounded border border-edge-strong bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-2 focus:outline-ink disabled:opacity-60'
function Status({ status, copy, label = false }: { status: FeatureStatus; copy: FeatureCopy; label?: boolean }) {
  return <span className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-secondary" title={copy[status]}>
    <span data-feature-status={status} aria-label={copy[status]} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-feature-${status})` }} />
    {label && copy[status]}
  </span>
}
type Draft = { base: Feature; value: Feature }
type RequestTarget = { target?: Feature; parent?: Feature; retry?: FeatureRun }
type RequestDraft = RequestTarget & { content: string; initialContent: string }

export function FeatureDevelopment({ workspace, onClose, onOpenFile, onOpenAgent, canUseGit = false }: {
  workspace: string
  onClose: () => void
  onOpenFile: (path: string) => void
  onOpenAgent: (run: FeatureRun) => void
  canUseGit?: boolean
}) {
  const { locale, formatDate } = useI18n(), copy = featureCopy[locale], heading = useId()
  const [data, setData] = useState<FeatureSnapshot | null>(null), [sets, setSets] = useState<AgentSet[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<FeatureSort>('updated'), [collapsed, setCollapsed] = useState(new Set<string>())
  const [draft, setDraft] = useState<Draft | null>(null), [request, setRequest] = useState<RequestDraft | null>(null)
  const [discard, setDiscard] = useState<(() => void) | null>(null), [followRun, setFollowRun] = useState<string | null>(null)
  const [setId, setSetId] = useState('')
  const requestAttempt = useRef({ fingerprint: '', id: '' })
  const requestInput = useRef<HTMLTextAreaElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [commit, setCommit] = useState<FeatureCommit | null>(null)
  const mutation = useRef(0), fetchSequence = useRef(0), alive = useRef(true), actionRef = useRef(false)
  const dirty = !!draft && (draft.value.title !== draft.base.title || draft.value.content !== draft.base.content || draft.value.parentId !== draft.base.parentId)
  const requestDirty = !!request && request.content !== request.initialContent
  const selectedSet = sets.find(set => set.id === setId) ?? sets.find(set => set.id === data?.runs.at(-1)?.agentSet.id) ?? sets[0]
  const selected = data?.features.find(feature => feature.id === draft?.base.id)
  const readOnly = !data?.canEdit
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const started = mutation.current
    const sequence = ++fetchSequence.current
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
    void fetchAgentSets().then(result => { if (alive.current) setSets(result.sets) }).catch(cause => { if (alive.current) setError(cause.message) })
    return () => { alive.current = false; controller.abort(); clearTimeout(timer) }
  }, [refresh])
  useEffect(() => {
    if (selected && !dirty && selected.version !== draft?.base.version && !busy) setDraft({ base: selected, value: selected })
    if (data && draft && !selected && !dirty && !busy) setDraft(null)
  }, [selected, dirty, draft, data, busy])
  useEffect(() => {
    if (!followRun || dirty || request) return
    const run = data?.runs.find(item => item.id === followRun), feature = data?.features.find(item => item.id === run?.featureId)
    if (feature) {
      setDraft({ base: feature, value: feature }); setFollowRun(null)
      setCollapsed(previous => { const next = new Set(previous); let parent = feature.parentId; while (parent) { next.delete(parent); parent = data?.features.find(item => item.id === parent)?.parentId ?? null }; return next })
    }
  }, [followRun, data, dirty, request])
  useEffect(() => {
    if (!dirty && !requestDirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, requestDirty])
  const composing = !!request
  useEffect(() => {
    if (composing && !busy) requestInput.current?.focus()
  }, [composing, busy])
  useEffect(() => {
    if (!setId && data && selectedSet) setSetId(selectedSet.id)
  }, [setId, data, selectedSet])
  const guarded = (action: () => void) => { if (busy) return; if (dirty || requestDirty) setDiscard(() => action); else action() }
  const perform = async (action: () => Promise<void>) => {
    if (actionRef.current) return
    actionRef.current = true; mutation.current++; setBusy(true); setError('')
    try { await action(); await refresh() } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { actionRef.current = false; if (alive.current) setBusy(false) }
  }
  const save = async () => {
    if (!draft) return null
    if (!dirty) return draft.base
    const { feature } = await editFeature(workspace, { ...draft.value, version: draft.base.version })
    setDraft({ base: feature, value: feature })
    setData(previous => previous ? { ...previous, features: previous.features.map(item => item.id === feature.id ? feature : item) } : previous)
    return feature
  }
  const judge = (status: 'verified' | 'needs-fix') => void perform(async () => {
    const feature = await save()
    if (!feature) return
    const result = await judgeFeature(workspace, feature.id, feature.version, status)
    setDraft({ base: result.feature, value: result.feature })
  })
  const openRequest = (target: RequestTarget) => {
    const content = target.retry?.content || target.target?.content || target.target?.title || target.retry?.title || ''
    requestAttempt.current = { fingerprint: '', id: '' }
    setFollowRun(null)
    setRequest({ ...target, content, initialContent: content })
  }
  const cancelRequest = () => guarded(() => { setRequest(null); addButton.current?.focus() })
  const submitRequest = () => {
    if (!request || !request.content.trim() || !selectedSet || readOnly) return
    const title = request.target?.title ?? request.retry?.title ?? request.content.trim().split(/\r?\n/, 1)[0].slice(0, 300)
    const value = { title, content: request.content, agentSetId: selectedSet.id, targetId: request.target?.id ?? request.retry?.targetId ?? undefined, parentId: request.target ? undefined : request.parent?.id ?? request.retry?.parentId ?? undefined, expectedVersion: request.target?.version }
    const fingerprint = JSON.stringify(value)
    if (requestAttempt.current.fingerprint !== fingerprint) requestAttempt.current = { fingerprint, id: crypto.randomUUID() }
    void perform(async () => {
      const { run } = await requestFeature(workspace, { ...value, id: requestAttempt.current.id })
      setRequest(null); setFollowRun(run.id)
      addButton.current?.focus()
    })
  }
  const rows = useMemo(() => featureRows(data?.features ?? [], sort, collapsed, locale), [data?.features, sort, collapsed, locale])
  const runs = (data?.runs ?? []).filter(run => run.featureId === draft?.base.id).toReversed()
  const pending = runs.some(pendingFeatureRun) || (data?.runs ?? []).some(run => run.targetId === draft?.base.id && pendingFeatureRun(run))
  const latest = selected?.report
  const relatedFiles = latest?.files ?? []
  const relatedCommits = latest?.commits ?? []
  const unassigned = (data?.runs ?? []).filter(run => !run.featureId).toReversed()
  const select = (feature: Feature) => guarded(() => { setDraft({ base: feature, value: feature }); setFollowRun(null); setRequest(null) })
  const runActions = (run: FeatureRun) => <span className="flex shrink-0 flex-wrap items-center gap-1">
    {run.state !== 'queued' && <button className={button} type="button" onClick={() => guarded(() => onOpenAgent(run))}>{copy.conversation}</button>}
    {!readOnly && pendingFeatureRun(run) && <button className={button} type="button" disabled={busy || run.state === 'cancelling'} onClick={() => void perform(async () => { await cancelFeatureRun(workspace, run.id) })}>{copy.stop}</button>}
    {!readOnly && !pendingFeatureRun(run) && run.state !== 'completed' && <button className={button} type="button" disabled={busy} onClick={() => guarded(() => openRequest({ retry: run, target: data?.features.find(feature => feature.id === (run.featureId ?? run.targetId)) }))}>{copy.retry}</button>}
  </span>
  return <>
    <DialogFrame labelledBy={heading} onClose={() => guarded(onClose)} className="flex h-[min(88dvh,850px)] max-w-6xl flex-col" busy={busy}>
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        {draft && !request && <button type="button" className={`${button} md:hidden`} aria-label={copy.back} onClick={() => guarded(() => setDraft(null))}><ArrowLeft width={17} height={17} /></button>}
        <h2 id={heading} className="text-sm font-semibold text-ink">{copy.title}</h2>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary" title={workspace}>{workspace.split('/').filter(Boolean).at(-1)}</span>
        {readOnly && data && <span className="text-xs text-ink-secondary">{copy.readOnly}</span>}
        <button type="button" className={button} aria-label={copy.refresh} disabled={busy} onClick={() => void perform(async () => {})}><RefreshDouble width={15} height={15} /></button>
        <button type="button" className={button} aria-label={copy.close} disabled={busy} onClick={() => guarded(onClose)}><Xmark width={18} height={18} /></button>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-ink-secondary"><span className="shrink-0">{copy.agentSet}</span><select aria-label={copy.agentSet} className={`${input} max-w-xs text-xs`} value={selectedSet?.id ?? ''} disabled={readOnly || busy || !sets.length} onChange={event => setSetId(event.target.value)}><option value="" disabled>{copy.agentSet}</option>{sets.map(set => <option value={set.id} key={set.id}>{set.name} · {set.runtime}</option>)}</select></label>
        {!sets.length && !loading && <p className="text-xs text-ink-secondary">{copy.noSets}</p>}
      </div>
      {error && <p role="alert" className="select-text shrink-0 border-b border-edge px-4 py-2 text-sm text-danger">{error}</p>}
      <div className="flex min-h-0 flex-1">
        <nav aria-label={copy.title} className={`${draft && !request ? 'hidden md:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col md:w-[32%] md:max-w-sm md:border-r md:border-edge`}>
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-3">
            <span className="text-xs tabular-nums text-ink-secondary">{data?.features.length ?? 0} {copy.count}</span>
            <select aria-label={copy.sort} className="min-w-0 bg-surface py-1 text-xs text-ink-secondary focus:outline-ink" value={sort} onChange={event => setSort(event.target.value as FeatureSort)}>
              <option value="updated">{copy.updated}</option><option value="name">{copy.nameSort}</option><option value="created">{copy.created}</option>
            </select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3" data-feature-list>
            <button ref={addButton} type="button" aria-expanded={!!request} className={`${button} sticky top-0 z-10 mb-1 h-8 w-full justify-start bg-surface text-ink`} disabled={readOnly || busy} onClick={() => guarded(() => openRequest({}))}><Plus width={15} height={15} />{copy.add}</button>
            {request && <form aria-label={copy.add} className="mb-3 space-y-2 px-2" onSubmit={event => { event.preventDefault(); submitRequest() }}>
              {(request.target || request.parent) && <p className="truncate text-xs text-ink-secondary" title={request.parent?.title ?? request.target?.title}>{request.parent ? copy.parent : copy.source}: {request.parent?.title ?? request.target?.title}</p>}
              <textarea ref={requestInput} aria-label={copy.requestContent} placeholder={copy.requestPlaceholder} className={`${input} block resize-y leading-5`} rows={3} maxLength={40_000} value={request.content} disabled={busy || readOnly} onChange={event => setRequest({ ...request, content: event.target.value })} />
              <div className="flex justify-end gap-1"><button type="button" className={button} disabled={busy} onClick={cancelRequest}>{copy.cancel}</button><button type="submit" className={`${button.replace('text-ink-secondary', 'text-ink-on-accent').replace('hover:bg-surface-hover', 'hover:bg-accent-strong')} bg-accent`} disabled={busy || readOnly || !request.content.trim() || !selectedSet}>{busy ? copy.starting : copy.submit}</button></div>
            </form>}
            {loading && !data && <p role="status" className="p-3 text-xs text-ink-secondary">{copy.load}</p>}
            {data && !rows.length && !unassigned.length && <p className="px-3 py-8 text-center text-sm text-ink-secondary">{copy.empty}</p>}
            {rows.map(({ feature, depth, hasChildren }) => <div key={feature.id} className={`flex h-8 items-center rounded ${draft?.base.id === feature.id ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`} style={{ paddingLeft: Math.min(depth, 12) * 14 }}>
              {hasChildren ? <button className="flex h-8 w-5 shrink-0 items-center justify-center text-ink-secondary focus-visible:outline-2 focus-visible:outline-ink" type="button" aria-label={`${feature.title} ${collapsed.has(feature.id) ? copy.expand : copy.collapse}`} aria-expanded={!collapsed.has(feature.id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(feature.id)) next.delete(feature.id); else next.add(feature.id); return next })}>{collapsed.has(feature.id) ? <NavArrowRight width={13} height={13} /> : <NavArrowDown width={13} height={13} />}</button> : <span className="w-5 shrink-0" />}
              <button type="button" data-feature-id={feature.id} className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 text-left text-sm text-ink-secondary focus-visible:outline-2 focus-visible:outline-ink" aria-current={draft?.base.id === feature.id ? 'true' : undefined} title={feature.title} onClick={() => select(feature)}>
                <Status status={feature.status} copy={copy} /><span className="min-w-0 truncate">{feature.title}</span>
              </button>
            </div>)}
            {unassigned.length > 0 && <div className="mt-4 border-t border-edge px-2 pt-3">
              <p className="mb-2 text-xs text-ink-secondary">{copy.requests}</p>
              {unassigned.map(run => <div key={run.id} className="mb-3 text-xs">
                <p className="truncate text-ink" title={run.title}>{run.title}</p>
                <p role="status" className="mt-1 text-ink-secondary">{copy[run.state]}</p>
                {run.error && <p className="select-text my-1 break-words text-danger">{run.error}</p>}
                {runActions(run)}
              </div>)}
            </div>}
          </div>
        </nav>
        <main className={`${draft && !request ? 'block' : 'hidden md:block'} min-h-0 min-w-0 flex-1 overflow-y-auto`}>
          {!draft ? <p className="p-10 text-center text-sm text-ink-secondary">{copy.select}</p> : <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><Status status={dirty ? 'changed' : selected?.status ?? draft.base.status} copy={copy} label /><span className="text-xs text-ink-secondary">{formatDate(selected?.updatedAt ?? draft.base.updatedAt)}</span></div>
              {selected?.documentPath && <button type="button" className="block max-w-full truncate text-left text-xs text-ink-secondary underline underline-offset-4" title={selected.documentPath} onClick={() => guarded(() => onOpenFile(selected.documentPath!))}>{copy.document}: {selected.documentPath}</button>}
              {selected && selected.version !== draft.base.version && dirty && <div role="status" className="text-sm text-warning">{copy.conflict}<button className={button} type="button" onClick={() => guarded(() => setDraft({ base: selected, value: selected }))}>{copy.reload}</button></div>}
              {!selected && <p role="status" className="text-sm text-warning">{copy.removed}</p>}
              <label className="block space-y-1 text-xs text-ink-secondary"><span>{copy.name}</span><input aria-label={copy.name} className={`${input} font-medium`} value={draft.value.title} maxLength={300} disabled={readOnly || busy} onChange={event => setDraft({ ...draft, value: { ...draft.value, title: event.target.value } })} /></label>
              <label className="block space-y-1 text-xs text-ink-secondary"><span>{copy.content}</span><textarea aria-label={copy.content} className={`${input} min-h-32 resize-y leading-relaxed`} value={draft.value.content} maxLength={40_000} disabled={readOnly || busy} onChange={event => setDraft({ ...draft, value: { ...draft.value, content: event.target.value } })} /></label>
              <label className="flex items-center gap-3 text-xs text-ink-secondary"><span className="shrink-0">{copy.parent}</span><select aria-label={copy.parent} className={`${input} max-w-xs text-xs`} disabled={readOnly || busy} value={draft.value.parentId ?? ''} onChange={event => setDraft({ ...draft, value: { ...draft.value, parentId: event.target.value || null } })}><option value="">{copy.root}</option>{data?.features.filter(feature => feature.id !== draft.base.id).map(feature => <option key={feature.id} value={feature.id}>{feature.title}</option>)}</select></label>
              {!readOnly && <div className="flex flex-wrap gap-1">
                <button type="button" className={`${button} bg-surface-raised`} disabled={busy || !dirty || !draft.value.title.trim()} onClick={() => void perform(async () => { await save() })}>{copy.save}</button>
                <button type="button" className={button} disabled={busy || !draft.value.title.trim()} onClick={() => judge('verified')}>{copy.verify}</button>
                <button type="button" className={button} disabled={busy || !draft.value.title.trim()} onClick={() => judge('needs-fix')}>{copy.needsFix}</button>
                <button type="button" className={`${button} text-ink`} disabled={busy || pending || !draft.value.title.trim()} onClick={() => request ? guarded(() => openRequest({ target: selected ?? draft.base })) : void perform(async () => { const target = await save(); if (target) openRequest({ target }) })}>{copy.handoff}</button>
                <button type="button" className={button} disabled={busy || !draft.value.title.trim()} onClick={() => request ? guarded(() => openRequest({ parent: selected ?? draft.base })) : void perform(async () => { const parent = await save(); if (parent) openRequest({ parent }) })}><Plus width={13} height={13} />{copy.child}</button>
              </div>}
            </div>
            <section className="space-y-2 border-t border-edge pt-5"><h3 className="text-sm font-semibold text-ink">{copy.implementation}</h3><p className="select-text whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-secondary">{latest?.summary ?? copy.noReport}</p>{latest?.validation && <><h4 className="pt-2 text-xs font-medium text-ink">{copy.validation}</h4><p className="select-text whitespace-pre-wrap break-words text-sm text-ink-secondary">{latest.validation}</p></>}</section>
            <section className="space-y-2"><h3 className="text-sm font-semibold text-ink">{copy.files}</h3>{relatedFiles.length ? relatedFiles.map(file => <button key={file} type="button" className="block max-w-full truncate text-left text-sm text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ink" title={file} onClick={() => guarded(() => onOpenFile(file))}><span className="underline underline-offset-4">{file}</span></button>) : <p className="text-sm text-ink-secondary">{copy.noFiles}</p>}</section>
            <section className="space-y-2"><h3 className="text-sm font-semibold text-ink">{copy.commits}</h3>{relatedCommits.length ? relatedCommits.map(item => <button key={`${item.repository}:${item.hash}`} className="block max-w-full text-left text-sm text-ink-secondary hover:text-ink disabled:cursor-default" disabled={!canUseGit} type="button" onClick={() => setCommit(item)}><span className="select-text font-mono text-xs text-ink">{item.hash.slice(0, 8)}</span> {item.subject}<span className="ml-2 text-xs text-ink-secondary">{item.repository || '.'}</span></button>) : <p className="text-sm text-ink-secondary">{copy.noCommits}</p>}</section>
            <section className="space-y-3 border-t border-edge pt-5"><h3 className="text-sm font-semibold text-ink">{copy.history}</h3>{runs.map(run => <details key={run.id} className="text-xs text-ink-secondary" open={pendingFeatureRun(run) || undefined}><summary className="cursor-pointer py-1.5"><span className="mr-2">{copy[run.state]}</span>{run.agentSet.name}<span className="ml-2 text-ink-secondary">{formatDate(run.createdAt)}</span></summary><div className="space-y-2 py-2 pl-3">{run.reason && <p className="select-text">{copy.reason}: {run.reason}</p>}<p className="select-text whitespace-pre-wrap">{run.title}{run.content ? `\n${run.content}` : ''}</p>{run.error && <p role="alert" className="select-text whitespace-pre-wrap text-danger">{run.error}</p>}{run.report && <p className="select-text whitespace-pre-wrap">{run.report.summary}</p>}{runActions(run)}</div></details>)}</section>
          </div>}
        </main>
      </div>
    </DialogFrame>
    {discard && <ConfirmDialog message={copy.unsaved} confirmLabel={copy.discard} cancelLabel={copy.cancel} danger onConfirm={() => { const action = discard; setDiscard(null); setDraft(selected ? { base: selected, value: selected } : null); setRequest(null); action() }} onCancel={() => setDiscard(null)} />}
    {commit && <FeatureCommitDialog copy={copy} commit={commit} onClose={() => setCommit(null)} />}
  </>
}

function FeatureCommitDialog({ copy, commit, onClose }: { copy: FeatureCopy; commit: FeatureCommit; onClose: () => void }) {
  const heading = useId(), [detail, setDetail] = useState<GitCommitDetail | null>(null), [error, setError] = useState('')
  useEffect(() => { let alive = true; void fetchGitCommit(commit.repository, commit.hash, '.workspace').then(value => { if (alive) setDetail(value) }).catch(cause => { if (alive) setError(cause.message) }); return () => { alive = false } }, [commit])
  return <DialogFrame labelledBy={heading} onClose={onClose} className="max-h-[85dvh] max-w-2xl overflow-y-auto"><div className="space-y-4 p-5"><div className="flex items-start justify-between gap-3"><h2 id={heading} className="select-text text-base font-semibold text-ink">{commit.subject}</h2><button type="button" className={button} aria-label={copy.close} onClick={onClose}><Xmark width={18} height={18} /></button></div><p className="select-text break-all font-mono text-xs text-ink-secondary">{commit.hash}</p>{error && <p role="alert" className="select-text text-danger">{error}</p>}{detail ? <><p className="select-text whitespace-pre-wrap text-sm text-ink-secondary">{detail.body}</p><ul className="space-y-1">{detail.files.map(file => <li key={file.path} className="select-text break-all text-sm text-ink-secondary"><span className="mr-2 font-mono text-xs text-ink-secondary">{file.status}</span>{file.path}</li>)}</ul></> : !error && <p role="status">{copy.load}</p>}</div></DialogFrame>
}
