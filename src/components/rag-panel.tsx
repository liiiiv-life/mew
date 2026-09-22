import { useEffect, useId, useRef, useState } from 'react'
import { Database, RefreshDouble, Xmark } from 'iconoir-react'
import { fetchRagDocuments, fetchRagSettings, fetchRagStatus, reindexRag, saveRagSettings, semanticSearchProject, type RagStatus, type SemanticSearchResult } from '../api/client'
import type { RagConfiguration, RagDocument, RagSettings } from '../../shared/rag'
import { useI18n } from '../i18n'
import { ragCopy } from './rag-copy'

const button = 'inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2.5 text-sm text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
const input = 'min-h-9 min-w-0 rounded border border-edge bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-2 focus:outline-ink'

export function RagPanel({ workspace, canManage, onClose, onOpenFile }: {
  workspace: string; canManage: boolean; onClose: () => void
  onOpenFile: (project: string, path: string, line: number | null) => void
}) {
  const { locale } = useI18n(), copy = ragCopy[locale], titleId = useId()
  const scope = 'docs'
  const [settings, setSettings] = useState<RagConfiguration | null>(null)
  const [status, setStatus] = useState<RagStatus | null>(null)
  const [documents, setDocuments] = useState<RagDocument[]>([])
  const [results, setResults] = useState<SemanticSearchResult[] | null>(null)
  const [query, setQuery] = useState(''), [history, setHistory] = useState(false), [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const revision = useRef(0)
  const load = async (version: number) => {
    const [configuration, snapshot, files] = await Promise.all([fetchRagSettings(), fetchRagStatus(scope, workspace), fetchRagDocuments(scope, workspace)])
    if (revision.current !== version) return
    setSettings(configuration); setStatus(snapshot); setDocuments(files.documents)
  }
  const run = async (action: (version: number) => Promise<void>) => {
    const version = ++revision.current
    setBusy(true); setError(''); setNotice('')
    try { await action(version) }
    catch (cause) { if (revision.current === version) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (revision.current === version) setBusy(false) }
  }
  useEffect(() => {
    setStatus(null); setDocuments([]); setResults(null); setFilter('')
    void run(load)
    const requests = revision
    return () => { requests.current++ }
    // Workspace changes invalidate old requests, including unmounts on project switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])
  const update = (patch: Partial<RagSettings>) => {
    if (!settings) return
    const previous = settings
    setSettings({ ...settings, ...patch })
    void run(async version => {
      let updated: RagConfiguration
      try { updated = await saveRagSettings({ enabled: settings.enabled, agentGuidance: settings.agentGuidance, ...patch }) }
      catch (cause) { if (revision.current === version) setSettings(previous); throw cause }
      if (revision.current !== version) return
      setSettings(updated); await load(version)
      if (revision.current === version) setNotice(copy.saved)
    })
  }
  const search = () => void run(async version => {
    const response = await semanticSearchProject(query.trim(), history, scope, workspace)
    if (revision.current !== version) return
    setResults(response.results); await load(version)
  })
  const files = documents.filter(file => file.path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
  const hasIndex = (status?.indexedChunks ?? 0) > 0
  const index = () => void run(async version => {
    await reindexRag(scope, workspace)
    await load(version)
    if (revision.current === version) setNotice(hasIndex ? copy.rebuilt : copy.indexed)
  })
  return <section aria-labelledby={titleId} className="flex h-full min-h-0 flex-col bg-surface text-ink">
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-edge px-3">
      <Database width={18} height={18} aria-hidden="true" /><h2 id={titleId} className="flex-1 text-sm font-medium">{copy.title}</h2>
      <button type="button" className={button} aria-label={copy.refresh} disabled={busy} onClick={() => void run(load)}><RefreshDouble width={17} height={17} /></button>
      <button type="button" className={button} aria-label={copy.close} onClick={onClose}><Xmark width={19} height={19} /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-busy={busy}>
      {error && <div role="alert" className="mb-4 text-sm text-danger">{error}<button className={button} disabled={busy} onClick={() => void run(load)}>{copy.retry}</button></div>}
      {notice && <p role="status" className="mb-4 text-sm text-ink-secondary">{notice}</p>}
      {!settings && busy && <p role="status" className="text-sm text-ink-secondary">{copy.loading}</p>}
      {settings && <section className="border-b border-edge pb-5">
        <h3 className="text-sm font-medium">{copy.settings}</h3><p className="mt-1 text-xs leading-relaxed text-ink-secondary">{copy.shared}</p>
        <label className="mt-3 flex min-h-10 items-center justify-between gap-3 text-sm">{copy.enabled}<input type="checkbox" checked={settings.enabled} disabled={!canManage || busy || settings.environmentDisabled} onChange={event => update({ enabled: event.target.checked })} /></label>
        <label className="flex min-h-10 items-center justify-between gap-3 text-sm">{copy.guidance}<input type="checkbox" checked={settings.agentGuidance} disabled={!canManage || busy || !settings.enabled || settings.environmentDisabled} onChange={event => update({ agentGuidance: event.target.checked })} /></label>
        <p className="text-xs leading-relaxed text-ink-secondary">{copy.guidanceHint}</p>
        {settings.environmentDisabled && <p className="mt-2 text-xs text-danger">{copy.environment}</p>}
        {!canManage && <p className="mt-2 text-xs text-ink-secondary">{copy.readOnly}</p>}
      </section>}
      <section className="border-b border-edge py-5">
        <h3 className="text-sm font-medium">{copy.database}</h3>
        <p className="mt-2 text-xs text-ink-secondary">Docs</p>
        {status && <>
          <div className="mt-4 flex items-center justify-between gap-2 text-sm"><span>{status.engine}</span><span className="text-xs text-ink-secondary">{!status.enabled ? copy.disabled : hasIndex ? copy.ready : copy.empty}</span></div>
          <p className="mt-1 break-all font-mono text-xs text-ink-secondary">{status.database}</p>
          <dl className="mt-3 space-y-2 text-xs">
            <div><dt className="text-ink-secondary">{copy.model}</dt><dd className="mt-1 break-all">{status.model}</dd></div>
            {[[copy.dimensions, status.dimensions], [copy.files, status.indexedFiles], [copy.chunks, status.indexedChunks]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-ink-secondary">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
          </dl>
        </>}
        <p className="mt-3 text-xs leading-relaxed text-ink-secondary">{copy.firstUse}</p>
        {canManage && <button type="button" className={`${button} mt-2 border border-edge`} disabled={busy || !status?.enabled} onClick={index}>{busy ? copy.working : hasIndex ? copy.rebuild : copy.startIndex}</button>}
      </section>
      <form className="py-5" onSubmit={event => { event.preventDefault(); if (!busy && query.trim() && status?.enabled) search() }}>
        <label className="block text-sm font-medium" htmlFor={`${titleId}-query`}>{copy.query}</label>
        <div className="mt-2 flex gap-2"><input id={`${titleId}-query`} className={`${input} w-full`} value={query} maxLength={2000} onChange={event => setQuery(event.target.value)} /><button className={`${button} border border-edge`} disabled={busy || !query.trim() || !status?.enabled}>{copy.search}</button></div>
        <label className="mt-2 flex min-h-8 items-center gap-2 text-xs text-ink-secondary"><input type="checkbox" checked={history} onChange={event => setHistory(event.target.checked)} />{copy.history}</label>
      </form>
      {results !== null && <section className="mb-5" aria-label={copy.results}>
        <h3 className="text-sm font-medium">{copy.results} · {results.length}</h3>
        {!results.length && <p className="mt-3 text-sm text-ink-secondary">{copy.noResults}</p>}
        {results.map(result => <button type="button" key={`${result.path}:${result.line}`} className="block w-full border-b border-edge py-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink" onClick={() => onOpenFile(scope, result.path, result.line)}>
          <span className="block break-all text-sm">{result.path}:{result.line}</span><span className="mt-1 block text-xs leading-relaxed text-ink-secondary">{result.text}</span>
        </button>)}
      </section>}
      <section aria-label={copy.documents}>
        <h3 className="text-sm font-medium">{copy.documents} · {documents.length}</h3>
        <input aria-label={copy.filter} placeholder={copy.filter} className={`${input} mt-3 w-full`} value={filter} onChange={event => setFilter(event.target.value)} />
        {!files.length && <p className="mt-3 text-sm text-ink-secondary">{documents.length ? copy.noFiles : copy.noDocuments}</p>}
        <ul className="mt-2">{files.map(file => <li key={file.path} className="border-b border-edge"><button className="flex min-h-10 w-full items-center justify-between gap-3 py-2 text-left text-xs hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ink" onClick={() => onOpenFile(scope, file.path, null)}><span className="break-all">{file.path}</span><span className="shrink-0 tabular-nums text-ink-secondary">{file.chunks} {copy.chunks}</span></button></li>)}</ul>
        <p className="mt-4 text-xs leading-relaxed text-ink-secondary">{copy.cache}</p>
      </section>
    </div>
  </section>
}
