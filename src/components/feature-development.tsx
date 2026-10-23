import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { ConfirmDialog, SelectField } from '@mew/ui'
import { NavArrowDown, NavArrowRight, OpenNewWindow, RefreshDouble, Search } from 'iconoir-react'
import type { BranchFeature, BranchFeaturePatch, BranchFeatureSnapshot } from '../../shared/branch-features'
import type { FeatureRun } from '../../shared/features'
import { fetchBranchFeatures, saveBranchFeature } from '../api/branch-features'
import { useI18n } from '../i18n'
import { featurePanelState, type FeaturePanelState } from '../utils/feature-panel-state'
import { branchPreviewUrl, loadBranchPreviewBase, type BranchPreviewContext } from '../utils/branch-preview-url'
import { readBranchFeatureDraft, writeBranchFeatureDraft, type BranchFeatureDraft } from '../utils/branch-feature-draft'
import { branchFeatureCopy, type BranchFeatureCopy } from './branch-feature-copy'
import { PanelCloseButton } from './panel-close-button'
import { DockGrip } from './DockWorkspace'
import { FeatureIcon } from './feature-icon'
import './feature-development.css'

const iconButton = 'branch-feature-icon-button'
type Draft = BranchFeatureDraft
const draftOf = (branch: BranchFeature): Draft => ({ title: branch.title, notes: branch.notes, validation: branch.validation, port: branch.previewPort?.toString() ?? '', path: branch.previewPath, review: branch.review })
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

function BranchEditor({ branch, copy, draft, saving, error, canSave = true, onDraft, onSave, onCancel, onReload }: {
  branch: Pick<BranchFeature, 'branch'>; copy: BranchFeatureCopy; draft: Draft; saving: boolean; error: string; canSave?: boolean
  onDraft: (draft: Draft) => void; onSave: () => void; onCancel: () => void; onReload?: () => void
}) {
  const id = useId()
  const field = (name: keyof Draft, value: string) => onDraft({ ...draft, [name]: value })
  return <form className="branch-feature-editor" aria-label={`${branch.branch} ${copy.details}`} onSubmit={event => { event.preventDefault(); onSave() }}>
    <fieldset disabled={saving}>
      <label htmlFor={`${id}-title`}>{copy.name}</label>
      <input id={`${id}-title`} value={draft.title} maxLength={200} onChange={event => field('title', event.target.value)} />
      <label htmlFor={`${id}-notes`}>{copy.notes}</label>
      <textarea id={`${id}-notes`} rows={2} value={draft.notes} maxLength={8000} onChange={event => field('notes', event.target.value)} />
      <div className="branch-feature-preview-fields">
        <div><label htmlFor={`${id}-port`}>{copy.port}</label><input id={`${id}-port`} inputMode="numeric" value={draft.port} placeholder="5101" maxLength={5} aria-describedby={`${id}-hint`} onChange={event => field('port', event.target.value)} /></div>
        <div><label htmlFor={`${id}-path`}>{copy.path}</label><input id={`${id}-path`} value={draft.path} maxLength={2048} placeholder="/" onChange={event => field('path', event.target.value)} /></div>
      </div>
      <p id={`${id}-hint`} className="branch-feature-hint">{copy.portHint}</p>
      <label htmlFor={`${id}-validation`}>{copy.validation}</label>
      <textarea id={`${id}-validation`} rows={3} value={draft.validation} maxLength={8000} onChange={event => field('validation', event.target.value)} />
      <SelectField label={copy.review} value={draft.review} onChange={review => field('review', review)} options={[
        { value: 'pending', label: copy.pending }, { value: 'verified', label: copy.verified }, { value: 'needs-fix', label: copy.needsFix },
      ]} />
      {error && <p role="alert" className="branch-feature-error">{error}</p>}
      {error && onReload && <button type="button" className="branch-feature-button" onClick={onReload}>{copy.reload}</button>}
      <div className="branch-feature-actions"><button type="button" className="branch-feature-button" onClick={onCancel}>{copy.cancel}</button><button type="submit" disabled={!canSave} className="branch-feature-button branch-feature-save">{saving ? copy.saving : copy.save}</button></div>
    </fieldset>
  </form>
}

export function FeatureDevelopment({ workspace, accountKey = '', onClose, requestCloseRef, initialState, onChange, canUseGit = true }: {
  workspace: string; onClose: () => void; onOpenFile: (path: string) => void; onOpenAgent: (run: FeatureRun) => void; canUseGit?: boolean
  accountKey?: string
  requestCloseRef?: Ref<(action?: () => void) => void>; initialState?: unknown; onChange?: (state: FeaturePanelState) => void
}) {
  const { locale } = useI18n(), copy = branchFeatureCopy[locale], heading = useId()
  const draftWorkspace = JSON.stringify([accountKey, workspace])
  const [saved] = useState(() => featurePanelState(initialState))
  const [restoredDraft] = useState(() => readBranchFeatureDraft(draftWorkspace))
  const [data, setData] = useState<BranchFeatureSnapshot | null>(null), [error, setError] = useState('')
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState(''), [showAll, setShowAll] = useState(!!restoredDraft)
  const [selected, setSelected] = useState<string | null>(restoredDraft?.branch ?? saved.expandedFeatures[0] ?? null)
  const [draft, setDraft] = useState<Draft | null>(restoredDraft?.draft ?? null), [baseDraft, setBaseDraft] = useState<Draft | null>(restoredDraft?.baseDraft ?? null)
  const [baseRevision, setBaseRevision] = useState<string | undefined>(restoredDraft?.baseRevision)
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [savedNotice, setSavedNotice] = useState(false)
  const [previewContext, setPreviewContext] = useState<BranchPreviewContext | null>(null)
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null)
  const [scrollTop, setScrollTop] = useState(saved.scrollTop)
  const list = useRef<HTMLDivElement>(null), restored = useRef(false), sequence = useRef(0), mounted = useRef(false), refreshingRef = useRef(false), savingRef = useRef(false)
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(baseDraft)
  useEffect(() => {
    writeBranchFeatureDraft(draftWorkspace, dirty && selected && draft && baseDraft ? { branch: selected, draft, baseDraft, baseRevision } : null)
  }, [draftWorkspace, dirty, selected, draft, baseDraft, baseRevision])
  const guard = useCallback((action: () => void) => {
    if (savingRef.current) return
    if (dirty) setDiscardAction(() => action)
    else action()
  }, [dirty])
  useImperativeHandle(requestCloseRef, () => (action = onClose) => guard(action), [guard, onClose])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current
    const snapshot = await fetchBranchFeatures(workspace, signal)
    if (mounted.current && request === sequence.current && !signal?.aborted) { setData(snapshot); setError('') }
  }, [workspace])
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    if (canUseGit) {
      void refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(message(cause)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
      void loadBranchPreviewBase().then(context => { if (!controller.signal.aborted) setPreviewContext(context) }).catch(() => {})
    }
    const poll = setInterval(() => {
      if (!canUseGit || globalThis.document?.visibilityState === 'hidden' || refreshingRef.current || savingRef.current) return
      refreshingRef.current = true
      void refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(message(cause)) }).finally(() => { refreshingRef.current = false })
    }, 8000)
    return () => { mounted.current = false; controller.abort(); clearInterval(poll) }
  }, [workspace, canUseGit, refresh])
  useLayoutEffect(() => {
    if (data && list.current && !restored.current) { list.current.scrollTop = saved.scrollTop; restored.current = true }
  }, [data, saved.scrollTop])
  useEffect(() => { onChange?.({ expandedFeatures: selected ? [selected] : [], expandedSections: [], sort: 'updated', scrollTop }) }, [selected, scrollTop, onChange])
  const branch = data?.branches.find(item => item.branch === selected)
  useEffect(() => {
    if (branch && !dirty) {
      const value = draftOf(branch)
      if (JSON.stringify(value) !== JSON.stringify(draft)) { setDraft(value); setBaseDraft(value) }
      setBaseRevision(branch.revision)
    }
  }, [branch, draft, dirty])
  const resetEditor = () => { setDraft(null); setBaseDraft(null); setBaseRevision(undefined); setSaveError(''); setSavedNotice(false) }
  const select = (name: string) => guard(() => { resetEditor(); setSelected(current => current === name ? null : name) })
  const save = async () => {
    if (!draft || !baseDraft || !selected || !branch || savingRef.current || !data?.canEdit) return
    const port = draft.port.trim()
    if (port && (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)) { setSaveError(copy.invalidPort); return }
    const path = draft.path || '/'
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) { setSaveError(copy.invalidPath); return }
    const patch: BranchFeaturePatch = { branch: selected }
    for (const key of ['title', 'notes', 'validation', 'review'] as const) { if (draft[key] !== baseDraft[key]) Object.assign(patch, { [key]: draft[key] }) }
    if (patch.review !== undefined) patch.expectedRevision = baseRevision
    if (draft.port !== baseDraft.port) patch.previewPort = port ? Number(port) : null
    if (draft.path !== baseDraft.path) patch.previewPath = path
    savingRef.current = true; setSaving(true); setSaveError(''); setSavedNotice(false); ++sequence.current
    try {
      const snapshot = await saveBranchFeature(workspace, patch)
      if (!mounted.current) return
      ++sequence.current; setData(snapshot); setError('')
      const next = snapshot.branches.find(item => item.branch === selected)
      if (next) { const value = draftOf(next); setDraft(value); setBaseDraft(value); setBaseRevision(next.revision) }
      else { resetEditor(); setSelected(null) }
      setSavedNotice(true)
    } catch (cause) { if (mounted.current) setSaveError(message(cause)) }
    finally { savingRef.current = false; if (mounted.current) setSaving(false) }
  }
  const manualRefresh = async () => {
    if (refreshingRef.current || savingRef.current) return
    refreshingRef.current = true; setRefreshing(true)
    try {
      await refresh()
      const context = await loadBranchPreviewBase()
      if (mounted.current) setPreviewContext(context)
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { refreshingRef.current = false; if (mounted.current) setRefreshing(false) }
  }
  const reloadEditor = async () => {
    if (!draft || !baseDraft || !selected || savingRef.current) return
    savingRef.current = true; setSaving(true)
    const request = ++sequence.current
    try {
      const snapshot = await fetchBranchFeatures(workspace)
      if (!mounted.current || request !== sequence.current) return
      setData(snapshot)
      const next = snapshot.branches.find(item => item.branch === selected)
      if (!next) { setSaveError(copy.missingBranch); return }
      const base = draftOf(next), merged = { ...base }
      for (const key of Object.keys(draft) as (keyof Draft)[]) if (draft[key] !== baseDraft[key]) Object.assign(merged, { [key]: draft[key] })
      setBaseDraft(base); setDraft(merged); setBaseRevision(next.revision); setSaveError('')
    } catch (cause) { if (mounted.current) setSaveError(message(cause)) }
    finally { savingRef.current = false; if (mounted.current) setSaving(false) }
  }
  const branches = useMemo(() => (data?.branches ?? []).filter(item => (showAll || !item.isBase) && `${item.title} ${item.branch} ${item.notes}`.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))).sort((a, b) =>
    Number(!!b.worktreePath) - Number(!!a.worktreePath) || (b.updatedAt || b.commit?.committedAt || '').localeCompare(a.updatedAt || a.commit?.committedAt || '') || a.branch.localeCompare(b.branch, locale, { numeric: true })
  ), [data, showAll, search, locale])
  const readOnly = !data?.canEdit
  return <section aria-labelledby={heading} aria-busy={canUseGit && (loading || refreshing)} data-feature-panel className="mew-panel-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
    <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      <DockGrip group="features" />
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5"><h2 id={heading} className="flex shrink-0 items-center gap-1.5 text-xs text-ink"><FeatureIcon width={14} height={14} aria-hidden="true" />{copy.title}</h2><span className="truncate text-xs text-ink-secondary" title={workspace}>{workspace.split('/').filter(Boolean).at(-1)}</span></div>
      {data && readOnly && <span className="text-xs text-ink-secondary">{copy.readOnly}</span>}
      <button type="button" className={iconButton} aria-label={copy.refresh} title={copy.refresh} disabled={!canUseGit || refreshing || saving} onClick={() => void manualRefresh()}><RefreshDouble width={14} height={14} aria-hidden="true" /></button>
      <PanelCloseButton aria-label={copy.close} disabled={saving} onClick={() => guard(onClose)} />
    </header>
    {error && <p role="alert" className="branch-feature-error px-3 py-2">{error}</p>}
    {restoredDraft && dirty && <p role="status" className="branch-feature-hint px-3 py-1">{copy.restored}</p>}
    {canUseGit && <div className="branch-feature-toolbar">
      <div className="branch-feature-filters"><button type="button" aria-pressed={!showAll} onClick={() => guard(() => { resetEditor(); setSelected(null); setShowAll(false) })}>{copy.tasks}</button><button type="button" aria-pressed={showAll} onClick={() => guard(() => { resetEditor(); setSelected(null); setShowAll(true) })}>{copy.all}</button><span className="branch-feature-count">{branches.length} {copy.count}</span></div>
      <label className="branch-feature-search"><Search width={14} height={14} aria-hidden="true" /><input aria-label={copy.search} placeholder={copy.search} value={search} onChange={event => { const value = event.target.value; guard(() => { resetEditor(); setSelected(null); setSearch(value) }) }} /></label>
    </div>}
    <div ref={list} data-feature-list className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={event => { if (restored.current) setScrollTop(event.currentTarget.scrollTop) }}>
      {!canUseGit ? <p className="branch-feature-empty">{copy.noAccess}</p> : loading && !data ? <p role="status" className="branch-feature-empty">{copy.loading}</p> : data && !data.isGitRepository ? <p className="branch-feature-empty">{copy.noGit}</p> : data && !branches.length ? <div className="branch-feature-empty"><p>{search ? copy.noMatch : copy.empty}</p>{!search && <p className="branch-feature-hint">{copy.emptyHint}</p>}</div> : null}
      {canUseGit && data?.canEdit && selected && draft && !branch && <div className="branch-feature-row"><p role="alert" className="branch-feature-error">{copy.missingBranch}</p><BranchEditor branch={{ branch: selected }} copy={copy} draft={draft} saving={saving} error="" canSave={false} onDraft={setDraft} onSave={() => {}} onCancel={() => guard(() => { resetEditor(); setSelected(null) })} /></div>}
      <ul className="branch-feature-list">{branches.map(item => {
        const open = selected === item.branch, review = item.review === 'verified' ? copy.verified : item.review === 'needs-fix' ? copy.needsFix : copy.pending
        const status = item.previewStatus === 'running' ? copy.running : item.previewStatus === 'stopped' ? copy.stopped : item.previewStatus === 'unknown' ? copy.unknown : copy.unconfigured
        const href = item.previewPort && data?.canPreview && previewContext ? branchPreviewUrl(item.previewPort, item.previewPath, previewContext) : null
        const previewReason = !data?.canPreview ? copy.previewDenied : !item.previewPort ? copy.unconfigured : !href ? copy.previewUnavailable : copy.preview
        return <li key={item.branch} data-branch-feature={item.branch} className="branch-feature-row">
          <div className="branch-feature-summary">
            <button type="button" className="branch-feature-heading" aria-expanded={open} aria-label={`${item.title} ${copy.details}`} onClick={() => select(item.branch)}>
              {open ? <NavArrowDown width={14} height={14} aria-hidden="true" /> : <NavArrowRight width={14} height={14} aria-hidden="true" />}
              <span className="branch-feature-heading-text"><span className="branch-feature-name">{item.title}</span><span className="branch-feature-branch">{item.branch}{item.current && <span className="branch-feature-tag">{copy.current}</span>}{item.isBase && <span className="branch-feature-tag">{copy.base}</span>}</span></span>
            </button>
            <span className={`branch-feature-review branch-feature-review-${item.review}`}>{review}</span>
            {href ? <a className={iconButton} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} ${copy.preview}`} title={`${copy.preview}: ${item.previewPort}`}><OpenNewWindow width={16} height={16} aria-hidden="true" /></a>
              : <button type="button" className={iconButton} disabled={readOnly || !data?.canPreview || !!item.previewPort} aria-label={`${item.title} ${copy.configure}`} title={previewReason} onClick={() => { if (!open) select(item.branch) }}><OpenNewWindow width={16} height={16} aria-hidden="true" /></button>}
          </div>
          <div className="branch-feature-meta"><span className={`branch-feature-port branch-feature-port-${item.previewStatus}`}>{status}{item.previewPort ? ` · ${item.previewPort}` : ''}</span>{item.dirty && <span className="branch-feature-changes">{item.dirty.staged + item.dirty.unstaged + item.dirty.untracked === 0 ? copy.clean : [[copy.staged, item.dirty.staged], [copy.unstaged, item.dirty.unstaged], [copy.untracked, item.dirty.untracked]].filter(([, count]) => count).map(([label, count]) => `${label} ${count}`).join(' · ')}</span>}</div>
          {item.notes && <p className="branch-feature-notes">{item.notes}</p>}
          <p className="branch-feature-commit" title={item.commit?.hash}>{item.commit ? <><code>{item.commit.hash.slice(0, 7)}</code> {item.commit.subject}</> : copy.noCommit}</p>
          {open && <div className="branch-feature-detail">
            <div className="branch-feature-worktree"><span>{copy.worktree}</span><code>{item.worktreePath || copy.noWorktree}</code></div>
            {readOnly ? <><p className="branch-feature-label">{copy.validation}</p><p className="branch-feature-record">{item.validation || copy.noValidation}</p></> : draft && <BranchEditor branch={item} copy={copy} draft={draft} saving={saving} error={saveError} onDraft={value => { setDraft(value); setSavedNotice(false) }} onSave={() => void save()} onReload={() => void reloadEditor()} onCancel={() => guard(() => { resetEditor(); setSelected(null) })} />}
            {savedNotice && <p role="status" className="branch-feature-hint">{copy.saved}</p>}
          </div>}
        </li>
      })}</ul>
    </div>
    {discardAction && <ConfirmDialog message={copy.unsaved} confirmLabel={copy.discard} cancelLabel={copy.cancel} danger onCancel={() => setDiscardAction(null)} onConfirm={() => { const action = discardAction; writeBranchFeatureDraft(draftWorkspace, null); setDiscardAction(null); action() }} />}
  </section>
}
