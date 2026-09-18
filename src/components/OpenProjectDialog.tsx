import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, Check, Folder, FolderPlus, GitBranch, HomeSimple, NavArrowRight, RefreshDouble, Search, Xmark } from 'iconoir-react'
import { DialogFrame } from '@mew/ui'
import { browseExternalEntries, cloneExternalGit, createExternalFolder, initializeExternalGit, type ExternalEntriesResult } from '../api/client'
import { useI18n } from '../i18n'
import { CloudStorageLocations } from './cloud-storage-locations'

type Action = 'folder' | 'clone' | 'init'
const button = 'inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-secondary hover:bg-surface-hover disabled:opacity-40'
const input = 'min-h-9 w-full min-w-0 rounded-md border border-edge-strong bg-surface-deep px-2 text-sm text-ink'

export function OpenProjectDialog({ basePath, onOpen, onClose }: {
  basePath: string
  onOpen: (path: string) => Promise<void> | void
  onClose: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [path, setPath] = useState(basePath)
  const [draft, setDraft] = useState(basePath)
  const [result, setResult] = useState<ExternalEntriesResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState('')
  const requestSeq = useRef(0)
  const busyRef = useRef(false)
  const actionInput = useRef<HTMLInputElement>(null)
  const actionBack = useRef<HTMLButtonElement>(null)
  const actionTriggers = useRef<Partial<Record<Action, HTMLButtonElement | null>>>({})
  const restoreActionFocus = useRef<Action | null>(null)

  const load = useCallback((nextPath: string) => {
    const seq = ++requestSeq.current
    setResult(null)
    setError(null)
    setFilter('')
    setDraft(nextPath)
    browseExternalEntries(nextPath).then((next) => {
      if (requestSeq.current !== seq) return
      setResult(next)
      setPath(next.path)
      setDraft(next.path)
    }).catch((err: unknown) => {
      if (requestSeq.current === seq) setError(err instanceof Error ? err.message : String(err))
    })
  }, [])

  const invalidateRequests = useCallback(() => { requestSeq.current++ }, [])
  useEffect(() => { load(basePath); return invalidateRequests }, [basePath, load, invalidateRequests])
  useEffect(() => { if (action) (actionInput.current ?? actionBack.current)?.focus() }, [action])

  useEffect(() => {
    const target = restoreActionFocus.current
    if (action || busy || !result || !target) return
    const trigger = actionTriggers.current[target]
    // Git initialization disables its trigger; focus an available action instead.
    if (trigger?.disabled) actionTriggers.current.folder?.focus()
    else trigger?.focus()
    restoreActionFocus.current = null
  }, [action, busy, result])

  const back = () => {
    setAction(null)
    setError(null)
  }
  const begin = (next: Action) => {
    restoreActionFocus.current = next
    setName('')
    setUrl('')
    setError(null)
    setNotice('')
    setAction(next)
  }
  const run = async (operation: () => Promise<unknown>, after?: () => void) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try { await operation(); after?.() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const suggested = url.trim().replace(/[\\/]+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/i, '') ?? ''
  const folderName = name.trim() || (action === 'clone' ? suggested : '')
  const validName = !!folderName && !/[\\/]/.test(folderName) && !Array.from(folderName).some((char) => char.charCodeAt(0) < 32) && folderName !== '.' && folderName !== '..'
  const invalidName = !!name.trim() && !validName
  const submitAction = () => {
    if (!action || !result || (action !== 'init' && !validName) || (action === 'clone' && !url.trim())) return
    const operation = action === 'folder' ? () => createExternalFolder(path, folderName)
      : action === 'clone' ? () => cloneExternalGit(path, url.trim(), folderName)
      : () => initializeExternalGit(path)
    void run(operation, () => {
      setNotice(t(action === 'init' ? 'project.initialized' : 'project.created', { name: folderName }))
      back()
      load(path)
    })
  }
  const directories = result?.entries.filter((entry) => entry.type === 'dir') ?? []
  const visible = directories.filter((entry) => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
  const currentIsGit = result?.entries.some((entry) => entry.name === '.git') ?? false
  const actionTitle = action === 'folder' ? t('sidebar.newFolder') : action === 'clone' ? t('project.clone') : t('project.init')

  return <DialogFrame labelledBy={id} describedBy={`${id}-hint`} busy={busy} onClose={action ? back : onClose} className="flex h-[min(680px,90dvh)] max-w-2xl flex-col">
    <header className="flex shrink-0 items-start gap-2 px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-base font-semibold text-ink-bright">{t('project.open')}</h2>
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-secondary">{t('project.browseHint')}</p>
      </div>
      <button type="button" disabled={busy} onClick={onClose} className={`${button} -mr-1 px-2`} aria-label={t('common.close')}><Xmark width={20} height={20} /></button>
    </header>

    {action ? <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submitAction() }}>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-4">
        <button ref={actionBack} type="button" disabled={busy} onClick={back} className={`${button} -ml-2 mb-2`}><ArrowLeft width={16} height={16} />{t('project.backToFolders')}</button>
        <h3 className="text-base font-semibold text-ink">{actionTitle}</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{t(action === 'init' ? 'project.initHint' : 'project.createHint')}</p>
        <div className="select-text mt-3 flex items-start gap-2 rounded-lg bg-surface-deep p-3 text-xs text-ink-secondary"><Folder width={16} height={16} className="shrink-0" /><span className="break-all font-mono">{path}</span></div>
        {action === 'clone' && <div className="mt-3">
          <label htmlFor={`${id}-url`} className="mb-1 block text-sm font-medium text-ink">{t('project.repositoryUrl')}</label>
          <input ref={actionInput} id={`${id}-url`} value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} className={input} placeholder="https://github.com/team/project.git" autoComplete="off" spellCheck={false} />
        </div>}
        {action !== 'init' && <div className="mt-3">
          <label htmlFor={`${id}-name`} className="mb-1 block text-sm font-medium text-ink">{t('project.folderName')}</label>
          <input ref={action === 'folder' ? actionInput : undefined} id={`${id}-name`} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} className={input} placeholder={action === 'clone' ? suggested || 'project' : 'my-project'} autoComplete="off" spellCheck={false} aria-invalid={invalidName || undefined} aria-describedby={invalidName ? `${id}-name-error` : undefined} />
          {invalidName && <p id={`${id}-name-error`} className="mt-2 text-xs text-danger-ink">{t('project.invalidName')}</p>}
        </div>}
        {error && <p role="alert" className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-danger-surface p-3 text-sm text-danger-ink">{error}</p>}
        {busy && <p role="status" className="mt-4 text-sm text-ink-secondary">{t(action === 'clone' ? 'project.cloning' : 'project.working')}</p>}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-edge px-3 py-2 sm:px-4">
        <button type="button" disabled={busy} onClick={back} className={button}>{t('common.cancel')}</button>
        <button type="submit" disabled={busy || (action !== 'init' && !validName) || (action === 'clone' && !url.trim())} className={`${button} bg-accent !text-ink-on-accent hover:bg-accent-strong`}>{busy ? t('project.working') : actionTitle}</button>
      </footer>
    </form> : <>
      <form noValidate className="flex shrink-0 gap-1 px-3 pb-2 sm:px-4" onSubmit={(event) => { event.preventDefault(); if (!busy) { setNotice(''); load(draft) } }}>
        <button type="button" disabled={busy} onClick={() => { setNotice(''); load('') }} className={`${button} px-2`} aria-label={t('project.home')} title={t('project.home')}><HomeSimple width={18} height={18} /></button>
        <button type="button" disabled={busy || !result?.parent} onClick={() => { if (result?.parent) { setNotice(''); load(result.parent) } }} className={`${button} px-2`} aria-label={t('project.parent')} title={t('project.parent')}><ArrowUp width={18} height={18} /></button>
        <input data-dialog-autofocus value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} spellCheck={false} autoComplete="off" className={`${input} font-mono !text-xs`} aria-label={t('project.path')} />
        <button type="submit" disabled={busy} className={button}>{t('folder.go')}</button>
      </form>
      <CloudStorageLocations disabled={busy} onSelect={(nextPath) => { setNotice(''); load(nextPath) }} />
      <div className="flex shrink-0 flex-wrap gap-1 border-y border-edge bg-surface-deep px-2 py-1 sm:px-3">
        <button type="button" disabled={!result || busy} ref={(element) => { actionTriggers.current.folder = element }} onClick={() => begin('folder')} className={button}><FolderPlus width={17} height={17} />{t('sidebar.newFolder')}</button>
        <button type="button" disabled={!result || busy} ref={(element) => { actionTriggers.current.clone = element }} onClick={() => begin('clone')} className={button}><GitBranch width={17} height={17} />{t('project.clone')}</button>
        <button type="button" disabled={!result || busy || currentIsGit} ref={(element) => { actionTriggers.current.init = element }} onClick={() => begin('init')} className={`${button} sm:ml-auto`}>{currentIsGit ? <><Check width={16} height={16} />{t('project.gitRepository')}</> : t('project.init')}</button>
      </div>
      {notice && <p role="status" className="mx-3 mt-2 flex items-center gap-2 text-xs text-success-ink sm:mx-4"><Check width={16} height={16} />{notice}</p>}
      <div className="flex shrink-0 items-center gap-2 px-3 py-1 sm:px-4">
        <span className="shrink-0 text-xs font-medium text-ink-secondary">{t('project.folders')}{result && <span className="ml-2 tabular-nums">{directories.length}</span>}</span>
        <label className="ml-auto flex min-w-0 max-w-56 items-center gap-2 text-ink-secondary"><Search width={15} height={15} className="shrink-0" /><input value={filter} onChange={(event) => setFilter(event.target.value)} disabled={!result || busy} aria-label={t('project.filter')} placeholder={t('project.filter')} className="min-h-8 w-full min-w-0 rounded-md bg-transparent px-1 text-xs text-ink" /></label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1 sm:px-2" aria-busy={!result && !error}>
        {error ? <div role="alert" className="mx-2 rounded-lg bg-danger-surface p-4 text-sm text-danger-ink"><p className="whitespace-pre-wrap break-words">{error}</p><button type="button" onClick={() => load(draft)} className={`${button} mt-2 !text-danger-ink`}><RefreshDouble width={16} height={16} />{t('project.retry')}</button></div>
          : !result ? <div role="status" className="px-3 py-6 text-center text-sm text-ink-secondary">{t('common.loading')}</div>
          : visible.length === 0 ? <div className="flex flex-col items-center px-3 py-6 text-center"><Folder width={28} height={28} className="mb-3 text-ink-secondary" /><p className="text-sm font-medium text-ink">{t(filter ? 'project.noMatches' : 'folder.empty')}</p><p className="mt-2 text-xs text-ink-secondary">{t(filter ? 'project.filterHint' : 'project.emptyHint')}</p></div>
          : visible.map((entry) => <button key={entry.path} type="button" disabled={busy} onClick={() => { setNotice(''); load(entry.path) }} className="group flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-surface-raised disabled:opacity-40" title={entry.path}>
            <Folder width={16} height={16} className="shrink-0 text-ink-secondary" />
            <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
            {entry.git && <span className="flex shrink-0 items-center gap-1 text-xs text-ink-secondary"><GitBranch width={13} height={13} />Git</span>}
            <NavArrowRight width={15} height={15} className="shrink-0 text-ink-secondary" />
          </button>)}
      </div>
      <footer className="shrink-0 border-t border-edge bg-surface-deep px-3 py-2 sm:px-4">
        <div className="mb-2 flex min-w-0 items-center gap-2"><p className="shrink-0 text-xs text-ink-secondary">{t('project.selectedFolder')}</p><p className="select-text min-w-0 truncate font-mono text-xs text-ink" title={result?.path}>{result?.path ?? '—'}</p></div>
        <div className="flex items-center justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className={button}>{t('common.cancel')}</button><button type="button" disabled={busy || !result} onClick={() => void run(() => Promise.resolve(onOpen(path)))} className={`${button} bg-accent !text-ink-on-accent hover:bg-accent-strong`}>{busy ? t('project.working') : t('project.openHere')}<NavArrowRight width={16} height={16} /></button></div>
      </footer>
    </>}
  </DialogFrame>
}
