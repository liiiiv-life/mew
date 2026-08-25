import { useCallback, useEffect, useRef, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import {
  browseExternalEntries,
  deleteExternalPath,
  externalDownloadUrl,
  fetchAgentCwdSuggestions,
  forgetSavedProject,
  openExternalProject,
  pasteExternalPath,
  renameExternalPath,
  setProject,
  switchWorkspace,
  type ExternalEntriesResult,
  type ExternalEntry,
} from '../api/client'
import { useI18n } from '../i18n'

type Clipboard = { path: string; mode: 'copy' | 'cut' } | null
type Menu = { entry: ExternalEntry; x: number; y: number } | null

function parentOf(value: string): string {
  const index = value.lastIndexOf('/')
  return index <= 0 ? '/' : value.slice(0, index)
}

function TreeEntry({
  entry,
  depth,
  expanded,
  directoryResults,
  loading,
  onToggle,
  onOpen,
  onMenu,
}: {
  entry: ExternalEntry
  depth: number
  expanded: Set<string>
  directoryResults: Record<string, ExternalEntriesResult>
  loading: Set<string>
  onToggle: (entry: ExternalEntry) => void
  onOpen: (path: string) => void
  onMenu: (entry: ExternalEntry, x: number, y: number) => void
}) {
  const open = expanded.has(entry.path)
  return (
    <div>
      <button
        type="button"
        onClick={() => (entry.type === 'dir' ? onToggle(entry) : onOpen(entry.path))}
        onContextMenu={(event) => {
          event.preventDefault()
          onMenu(entry, event.clientX, event.clientY)
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ink-secondary hover:bg-surface-hover"
        style={{ paddingLeft: depth * 16 + 10 }}
        title={entry.path}
      >
        <span className="w-3 shrink-0 text-ink-muted">{entry.type === 'dir' ? (open ? '▾' : '▸') : '·'}</span>
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {entry.type === 'dir' && open && (
        <div>
          {loading.has(entry.path) ? (
            <div className="py-1 text-xs text-ink-muted" style={{ paddingLeft: (depth + 1) * 16 + 10 }}>…</div>
          ) : (
            directoryResults[entry.path]?.entries.map((child) => (
              <TreeEntry
                key={child.path}
                entry={child}
                depth={depth + 1}
                expanded={expanded}
                directoryResults={directoryResults}
                loading={loading}
                onToggle={onToggle}
                onOpen={onOpen}
                onMenu={onMenu}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function ServerFileExplorer({
  isOwner,
  onOpenFile,
  onRenamed,
  onDeleted,
  onClose,
}: {
  isOwner: boolean
  onOpenFile: (path: string) => void
  onRenamed: (oldPath: string, newPath: string, type: 'file' | 'dir') => void
  onDeleted: (path: string, type: 'file' | 'dir') => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [current, setCurrent] = useState('')
  const [draft, setDraft] = useState('~')
  const [root, setRoot] = useState<ExternalEntriesResult | null>(null)
  const [children, setChildren] = useState<Record<string, ExternalEntriesResult>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const [clipboard, setClipboard] = useState<Clipboard>(null)
  const [suggestions, setSuggestions] = useState<{ name: string; path: string }[]>([])
  const [addressFocused, setAddressFocused] = useState(false)
  const requestSeq = useRef(0)

  useOverlayDismiss(onClose)

  const navigate = useCallback((path: string) => {
    const seq = ++requestSeq.current
    setRoot(null)
    setError(null)
    browseExternalEntries(path)
      .then((result) => {
        if (requestSeq.current !== seq) return
        setCurrent(result.path)
        setDraft(result.path)
        setRoot(result)
        setChildren({})
        setExpanded(new Set())
      })
      .catch((err: unknown) => {
        if (requestSeq.current === seq) setError(err instanceof Error ? err.message : t('fileExplorer.loadFailed'))
      })
  }, [t])

  useEffect(() => navigate(''), [navigate])

  useEffect(() => {
    if (!addressFocused || !current) return
    const timer = window.setTimeout(() => {
      fetchAgentCwdSuggestions(draft, current, draft === current)
        .then((result) => setSuggestions(result.dirs))
        .catch(() => setSuggestions([]))
    }, 100)
    return () => clearTimeout(timer)
  }, [addressFocused, current, draft])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close, { once: true })
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const loadDir = useCallback((path: string) => {
    setLoading((old) => new Set(old).add(path))
    return browseExternalEntries(path)
      .then((result) => setChildren((old) => ({ ...old, [path]: result })))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('fileExplorer.loadFailed')))
      .finally(() => setLoading((old) => {
        const next = new Set(old)
        next.delete(path)
        return next
      }))
  }, [t])

  const refreshParent = (path: string) => {
    const parent = parentOf(path)
    if (parent === current) navigate(current)
    else void loadDir(parent)
  }

  const toggle = (entry: ExternalEntry) => {
    setExpanded((old) => {
      const next = new Set(old)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
    if (!expanded.has(entry.path) && !children[entry.path]) void loadDir(entry.path)
  }

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : t('fileExplorer.operationFailed'))

  const rename = (entry: ExternalEntry) => {
    const name = window.prompt(t('fileExplorer.renameTitle'), entry.name)
    if (!name || name === entry.name) return
    renameExternalPath(entry.path, name)
      .then(({ path }) => {
        onRenamed(entry.path, path, entry.type)
        refreshParent(entry.path)
      })
      .catch(fail)
  }

  const remove = (entry: ExternalEntry) => {
    if (!window.confirm(`${t('fileExplorer.deleteTitle')}\n${t('fileExplorer.deleteDescription')}\n\n${entry.path}`)) return
    deleteExternalPath(entry.path)
      .then(() => {
        onDeleted(entry.path, entry.type)
        refreshParent(entry.path)
      })
      .catch(fail)
  }

  const paste = (destination: string) => {
    if (!clipboard) return
    pasteExternalPath(clipboard.path, destination, clipboard.mode)
      .then(() => {
        if (clipboard.mode === 'cut') setClipboard(null)
        if (destination === current) navigate(current)
        else void loadDir(destination)
      })
      .catch(fail)
  }

  const openWorkspace = (path: string) => {
    if (!window.confirm(`${t('fileExplorer.openWorkspaceConfirm')}\n\n${path}`)) return
    switchWorkspace(path)
      .then(() => {
        forgetSavedProject()
        location.reload()
      })
      .catch(fail)
  }

  const openProject = (path: string) => {
    if (!window.confirm(`${t('fileExplorer.openProjectConfirm')}\n\n${path}`)) return
    openExternalProject(path)
      .then((result) => {
        setProject(result.project)
        location.reload()
      })
      .catch(fail)
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-3" onMouseDown={onClose}>
      <div className="flex h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center border-b border-edge px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{t('fileExplorer.title')}</span>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-ink-muted hover:bg-surface-hover" aria-label={t('settings.close')}>×</button>
        </div>
        <form className="relative flex items-center gap-1.5 border-b border-edge px-3 py-2" onSubmit={(event) => { event.preventDefault(); navigate(draft) }}>
          <button type="button" onClick={() => navigate('')} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover" title={t('fileExplorer.home')}>⌂</button>
          <button type="button" disabled={!root?.parent} onClick={() => root?.parent && navigate(root.parent)} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-30" title={t('fileExplorer.parent')}>↑</button>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setAddressFocused(true)}
            onBlur={() => window.setTimeout(() => setAddressFocused(false), 120)}
            spellCheck={false}
            placeholder={t('fileExplorer.pathPlaceholder')}
            className="min-w-0 flex-1 rounded border border-edge bg-surface px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
          />
          <button type="submit" className="rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent hover:bg-accent-strong">{t('fileExplorer.go')}</button>
          {addressFocused && suggestions.length > 0 && (
            <div className="absolute left-[5.5rem] right-[3.75rem] top-[calc(100%-0.35rem)] z-20 max-h-52 overflow-y-auto rounded border border-edge-bright bg-surface-raised py-1 shadow-xl">
              {suggestions.map((item) => (
                <button key={item.path} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => navigate(item.path)} className="block w-full truncate px-2 py-1.5 text-left font-mono text-xs text-ink-secondary hover:bg-surface-hover">{item.path}</button>
              ))}
            </div>
          )}
        </form>
        {error && <div className="border-b border-edge bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {!root ? (
            !error && <div className="px-3 py-5 text-center text-xs text-ink-muted">{t('fileExplorer.loading')}</div>
          ) : root.entries.length === 0 ? (
            <div className="px-3 py-5 text-center text-xs text-ink-muted">{t('fileExplorer.empty')}</div>
          ) : root.entries.map((entry) => (
            <TreeEntry key={entry.path} entry={entry} depth={0} expanded={expanded} directoryResults={children} loading={loading} onToggle={toggle} onOpen={(path) => { onOpenFile(path); onClose() }} onMenu={(item, x, y) => setMenu({ entry: item, x, y })} />
          ))}
        </div>
        <div className="truncate border-t border-edge px-3 py-2 font-mono text-[11px] text-ink-muted" title={current}>{current}</div>
      </div>
      {menu && (
        <div
          className="fixed z-[1200] min-w-48 overflow-hidden rounded-lg border border-edge-bright bg-surface-raised py-1 text-xs shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 300) }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => rename(menu.entry)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.rename')}</button>
          <button type="button" onClick={() => setClipboard({ path: menu.entry.path, mode: 'copy' })} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.copy')}</button>
          <button type="button" onClick={() => setClipboard({ path: menu.entry.path, mode: 'cut' })} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.cut')}</button>
          {menu.entry.type === 'dir' && clipboard && <button type="button" onClick={() => paste(menu.entry.path)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.paste')}</button>}
          {menu.entry.type === 'file' && <a href={externalDownloadUrl(menu.entry.path)} download={menu.entry.name} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.download')}</a>}
          {menu.entry.type === 'dir' && isOwner && <button type="button" onClick={() => openProject(menu.entry.path)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.openProject')}</button>}
          {menu.entry.type === 'dir' && isOwner && <button type="button" onClick={() => openWorkspace(menu.entry.path)} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.openWorkspace')}</button>}
          <button type="button" onClick={() => remove(menu.entry)} className="block w-full px-3 py-2 text-left text-danger hover:bg-surface-hover">{t('fileExplorer.delete')}</button>
        </div>
      )}
    </div>
  )
}
