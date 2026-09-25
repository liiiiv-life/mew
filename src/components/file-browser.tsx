import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Page, Folder, GitBranch, HomeSimple, NavArrowDown, NavArrowRight, RefreshDouble, Search, Xmark } from 'iconoir-react'
import { fetchAgentCwdSuggestions, type ExternalEntriesResult, type ExternalEntry } from '../api/client'
import { useI18n } from '../i18n'
import { FileBrowserFavorites } from './file-browser-favorites'
import { useExternalFileActions } from '../hooks/use-external-file-actions'
import { useLongPress } from '../hooks/useLongPress'

type EntryMenu = (entry: ExternalEntry, x: number, y: number) => void

export const fileBrowserButton = 'inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-ink-secondary hover:bg-surface-hover disabled:opacity-40'
export const fileBrowserInput = 'min-h-9 w-full min-w-0 rounded-md border border-edge-strong bg-surface-deep px-2 text-sm text-ink'

export function FileBrowserHeader({ id, title, hint, busy, onClose, initialFocus = false }: {
  id: string; title: string; hint?: string; busy?: boolean; onClose: () => void; initialFocus?: boolean
}) {
  const { t } = useI18n()
  return <header className="flex shrink-0 items-start gap-2 px-3 py-3 sm:px-4">
    <div className="min-w-0 flex-1">
      <h2 id={id} tabIndex={initialFocus ? -1 : undefined} data-dialog-autofocus={initialFocus || undefined} className="text-base font-semibold text-ink-bright outline-none">{title}</h2>
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-ink-secondary">{hint}</p>}
    </div>
    <button type="button" disabled={busy} onClick={onClose} className={`${fileBrowserButton} -mr-1 px-2`} aria-label={t('common.close')}><Xmark width={20} height={20} /></button>
  </header>
}

/** The project picker and server tree share the same row, including nested entries. */
export function FileBrowserEntry({ entry, busy, depth = 0, expanded, onClick, onMenu }: {
  entry: ExternalEntry; busy?: boolean; depth?: number; expanded?: boolean
  onClick: () => void; onMenu?: EntryMenu
}) {
  const pointer = useRef({ x: 0, y: 0 })
  const touch = useLongPress(() => onMenu?.(entry, pointer.current.x, pointer.current.y))
  const Icon = entry.type === 'dir' ? Folder : Page
  const Chevron = expanded ? NavArrowDown : NavArrowRight
  return <button type="button" disabled={busy} onClick={() => { if (!touch.consumeClick()) onClick() }}
    onPointerDown={(event) => {
      pointer.current = { x: event.clientX, y: event.clientY }
      if (onMenu) {
        touch.pressProps.onPointerDown()
        if (event.pointerType !== 'touch') touch.pressProps.onPointerCancel()
      }
    }}
    onPointerMove={(event) => { if (Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 10) touch.pressProps.onPointerCancel() }}
    onPointerUp={touch.pressProps.onPointerUp} onPointerLeave={touch.pressProps.onPointerLeave} onPointerCancel={touch.pressProps.onPointerCancel}
    onContextMenu={(event) => {
      if (!onMenu) return
      event.preventDefault()
      event.stopPropagation()
      const bounds = event.currentTarget.getBoundingClientRect()
      pointer.current = { x: event.clientX || bounds.left + 16, y: event.clientY || bounds.top + bounds.height / 2 }
      event.currentTarget.focus()
      touch.pressProps.onContextMenu(event)
    }}
    aria-expanded={entry.type === 'dir' ? expanded : undefined}
    className="group flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-surface-raised disabled:opacity-40"
    style={depth ? { paddingLeft: depth * 16 + 8 } : undefined} title={entry.path}>
    <Icon width={16} height={16} className="shrink-0 text-ink-secondary" />
    <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
    {entry.git && <span className="flex shrink-0 items-center gap-1 text-xs text-ink-secondary"><GitBranch width={13} height={13} />Git</span>}
    {entry.type === 'dir' && <Chevron width={15} height={15} className="shrink-0 text-ink-secondary" />}
  </button>
}

/** Shared browsing surface; callers own permissions, loading and file operations. */
export function FileBrowser({ result, error, draft, onDraftChange, onNavigate, busy = false, foldersOnly = false, autocomplete = false, autoFocusPath = true, toolbar, notice, footerActions, renderEntry, onFilesChanged, onRenamed, onDeleted, onOpenProject }: {
  result: ExternalEntriesResult | null; error: string | null; draft: string
  onDraftChange: (value: string) => void; onNavigate: (path: string) => void
  busy?: boolean; foldersOnly?: boolean; autocomplete?: boolean; autoFocusPath?: boolean
  toolbar?: ReactNode; notice?: ReactNode; footerActions?: ReactNode
  renderEntry?: (entry: ExternalEntry, onMenu: EntryMenu) => ReactNode
  onFilesChanged: (directories: string[]) => void
  onRenamed?: (oldPath: string, newPath: string, type: ExternalEntry['type']) => void
  onDeleted?: (path: string, type: ExternalEntry['type']) => void
  onOpenProject?: (path: string) => void
}) {
  const { t } = useI18n()
  const actions = useExternalFileActions({ onRefresh: onFilesChanged, onRenamed, onDeleted, onOpenProject })
  const locked = busy || actions.busy
  const [filter, setFilter] = useState('')
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<{ name: string; path: string }[]>([])
  useEffect(() => { setFilter('') }, [result])
  useEffect(() => {
    setSuggestions([])
    if (!autocomplete || !focused || !result) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      fetchAgentCwdSuggestions(draft, result.path, draft === result.path)
        .then((next) => { if (!cancelled) setSuggestions(next.dirs) })
        .catch(() => { if (!cancelled) setSuggestions([]) })
    }, 100)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [autocomplete, focused, draft, result])
  const navigate = (path: string) => { actions.closeMenu(); setFocused(false); onNavigate(path) }
  const entries = result?.entries.filter((entry) => !foldersOnly || entry.type === 'dir') ?? []
  const visible = entries.filter((entry) => entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
  const filterLabel = t(foldersOnly ? 'project.filter' : 'fileExplorer.filter')

  return <>
    <FileBrowserFavorites currentPath={result?.canonicalPath ?? result?.path} disabled={locked} onSelect={navigate} />
    <form noValidate className="flex shrink-0 gap-1 px-3 pb-2 sm:px-4" onSubmit={(event) => { event.preventDefault(); if (!locked) navigate(draft) }}>
      <button type="button" disabled={locked} onClick={() => navigate('')} className={`${fileBrowserButton} px-2`} aria-label={t('project.home')} title={t('project.home')}><HomeSimple width={18} height={18} /></button>
      <button type="button" disabled={locked || !result?.parent} onClick={() => { if (result?.parent) navigate(result.parent) }} className={`${fileBrowserButton} px-2`} aria-label={t('project.parent')} title={t('project.parent')}><ArrowUp width={18} height={18} /></button>
      <div className="relative min-w-0 flex-1" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
        <input data-dialog-autofocus={autoFocusPath || undefined} value={draft} disabled={locked} onChange={(event) => { onDraftChange(event.target.value); setFocused(true) }} onFocus={() => setFocused(true)} spellCheck={false} autoComplete="off" className={`${fileBrowserInput} font-mono !text-xs`} aria-label={t(foldersOnly ? 'project.path' : 'fileExplorer.pathPlaceholder')} />
        {focused && suggestions.length > 0 && <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-md border border-edge bg-surface-raised py-1 shadow-lg">
          {suggestions.map((entry) => <button key={entry.path} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => navigate(entry.path)} className="block min-h-8 w-full truncate px-2 text-left font-mono text-xs text-ink hover:bg-surface-hover">{entry.path}</button>)}
        </div>}
      </div>
      <button type="submit" disabled={locked} className={fileBrowserButton}>{t('folder.go')}</button>
    </form>
    {toolbar}
    {notice}
    {actions.error && <p role="alert" className="select-text mx-3 mb-2 break-words text-xs text-danger-ink sm:mx-4">{actions.error}</p>}
    <div className="flex shrink-0 items-center gap-2 px-3 py-1 sm:px-4">
      <span className="shrink-0 text-xs font-medium text-ink-secondary">{t(foldersOnly ? 'project.folders' : 'fileExplorer.items')}{result && <span className="ml-2 tabular-nums">{entries.length}</span>}</span>
      <label className="ml-auto flex min-w-0 max-w-56 items-center gap-2 text-ink-secondary"><Search width={15} height={15} className="shrink-0" /><input value={filter} onChange={(event) => setFilter(event.target.value)} disabled={!result || locked} aria-label={filterLabel} placeholder={filterLabel} className="min-h-8 w-full min-w-0 rounded-md bg-transparent px-1 text-xs text-ink" /></label>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1 sm:px-2" aria-busy={!result && !error}>
      {error && <div role="alert" className="mx-2 rounded-lg bg-danger-surface p-4 text-sm text-danger-ink"><p className="whitespace-pre-wrap break-words">{error}</p><button type="button" disabled={locked} onClick={() => navigate(draft)} className={`${fileBrowserButton} mt-2 !text-danger-ink`}><RefreshDouble width={16} height={16} />{t('project.retry')}</button></div>}
      {!result ? !error && <div role="status" className="px-3 py-6 text-center text-sm text-ink-secondary">{t('common.loading')}</div>
        : visible.length === 0 ? <div className="flex flex-col items-center px-3 py-6 text-center"><Folder width={28} height={28} className="mb-3 text-ink-secondary" /><p className="text-sm font-medium text-ink">{t(filter ? (foldersOnly ? 'project.noMatches' : 'fileExplorer.noMatches') : (foldersOnly ? 'folder.empty' : 'fileExplorer.empty'))}</p>{foldersOnly && <p className="mt-2 text-xs text-ink-secondary">{t(filter ? 'project.filterHint' : 'project.emptyHint')}</p>}</div>
        : visible.map((entry) => renderEntry ? renderEntry(entry, actions.openMenu) : <FileBrowserEntry key={entry.path} entry={entry} busy={locked} onMenu={actions.openMenu} onClick={() => navigate(entry.path)} />)}
    </div>
    <footer className="shrink-0 border-t border-edge bg-surface-deep px-3 py-2 sm:px-4">
      <div className={`flex min-w-0 items-center gap-2 ${footerActions ? 'mb-2' : ''}`}><p className="shrink-0 text-xs text-ink-secondary">{t(foldersOnly ? 'project.selectedFolder' : 'fileExplorer.currentFolder')}</p><p className="select-text min-w-0 truncate font-mono text-xs text-ink" title={result?.path}>{result?.path ?? '—'}</p></div>
      {footerActions && <div className="flex items-center justify-end gap-2">{footerActions}</div>}
    </footer>
    {actions.menu}
    {actions.dialog}
  </>
}
