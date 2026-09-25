import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { DialogFrame, useDialog } from '@mew/ui'
import {
  browseExternalEntries,
  openExternalProject,
  setProject,
  type ExternalEntriesResult,
  type ExternalEntry,
} from '../api/client'
import { FileBrowser, FileBrowserEntry, FileBrowserHeader } from './file-browser'
import { useI18n } from '../i18n'

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
      <FileBrowserEntry entry={entry} depth={depth} expanded={entry.type === 'dir' ? open : undefined}
        onClick={() => (entry.type === 'dir' ? onToggle(entry) : onOpen(entry.path))}
        onMenu={onMenu}
      />
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
  const dialogs = useDialog()
  const id = useId()
  const [current, setCurrent] = useState('')
  const [draft, setDraft] = useState('~')
  const [root, setRoot] = useState<ExternalEntriesResult | null>(null)
  const [children, setChildren] = useState<Record<string, ExternalEntriesResult>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const navigate = useCallback((path: string) => {
    const seq = ++requestSeq.current
    setRoot(null)
    setDraft(path)
    setLoading(new Set())
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

  const invalidateRequests = useCallback(() => { requestSeq.current++ }, [])
  useEffect(() => { navigate(''); return invalidateRequests }, [navigate, invalidateRequests])

  const loadDir = useCallback((path: string) => {
    const seq = requestSeq.current
    setLoading((old) => new Set(old).add(path))
    return browseExternalEntries(path)
      .then((result) => { if (requestSeq.current === seq) setChildren((old) => ({ ...old, [path]: result })) })
      .catch((err: unknown) => { if (requestSeq.current === seq) setError(err instanceof Error ? err.message : t('fileExplorer.loadFailed')) })
      .finally(() => setLoading((old) => {
        if (requestSeq.current !== seq) return old
        const next = new Set(old)
        next.delete(path)
        return next
      }))
  }, [t])

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

  const openProject = async (path: string) => {
    if (!(await dialogs.confirm({ message: t('fileExplorer.openProjectConfirm'), detail: path, confirmLabel: t('project.openHere'), cancelLabel: t('common.cancel') }))) return
    openExternalProject(path)
      .then((result) => {
        try {
          const previous: unknown = JSON.parse(localStorage.getItem('mew:open-project-paths') ?? '[]')
          const paths = Array.isArray(previous) ? previous.filter((item): item is string => typeof item === 'string') : []
          localStorage.setItem('mew:open-project-paths', JSON.stringify([...new Set([...paths, path])]))
        } catch {
          // localStorage가 막혀도 이번 열기는 계속한다.
        }
        setProject(result.project)
        location.reload()
      })
      .catch(fail)
  }

  return <>
    <DialogFrame labelledBy={id} onClose={onClose} className="flex h-[min(680px,90dvh)] max-w-2xl flex-col">
      <FileBrowserHeader id={id} title={t('fileExplorer.title')} onClose={onClose} />
      <FileBrowser result={root} error={error} draft={draft} onDraftChange={setDraft} onNavigate={navigate} autocomplete
        onFilesChanged={(directories) => {
          if (directories.includes(current)) navigate(current)
          else for (const directory of directories) if (children[directory]) void loadDir(directory)
        }}
        onRenamed={onRenamed} onDeleted={onDeleted} onOpenProject={isOwner ? openProject : undefined}
        renderEntry={(entry, onMenu) => <TreeEntry key={entry.path} entry={entry} depth={0} expanded={expanded} directoryResults={children} loading={loading} onToggle={toggle} onOpen={(path) => { onOpenFile(path); onClose() }} onMenu={onMenu} />}
      />

    </DialogFrame>
    {dialogs.dialog}
  </>
}
