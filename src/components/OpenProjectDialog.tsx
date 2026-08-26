import { useCallback, useEffect, useRef, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchAgentCwdSuggestions, resolveAgentCwd, type AgentCwdSuggestions } from '../api/client'
import { useI18n } from '../i18n'

export function OpenProjectDialog({ basePath, onOpen, onClose }: {
  basePath: string
  onOpen: (path: string) => Promise<void> | void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(basePath)
  const [browsedPath, setBrowsedPath] = useState<string | null>(basePath)
  const [suggestions, setSuggestions] = useState<AgentCwdSuggestions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useOverlayDismiss(onClose)

  const load = useCallback((input: string, entered: boolean) => {
    void fetchAgentCwdSuggestions(input, basePath, entered)
      .then((result) => {
        setSuggestions(result)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [basePath])

  useEffect(() => {
    inputRef.current?.focus()
    load(basePath, true)
  }, [basePath, load])

  const enterDir = (path: string) => {
    setDraft(path)
    setBrowsedPath(path)
    load(path, true)
    inputRef.current?.focus()
  }

  const confirm = async () => {
    if (!draft.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const { cwd } = await resolveAgentCwd(draft, basePath)
      await onOpen(cwd)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-edge px-3 py-2.5 text-sm font-semibold text-ink">{t('project.open')}</div>
        <div className="flex h-10 items-center gap-2 border-b border-edge px-3">
          <span aria-hidden="true">📁</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setBrowsedPath(null)
              load(e.target.value, false)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              if (browsedPath === draft) void confirm()
              else if (suggestions?.dirs[0]) enterDir(suggestions.dirs[0].path)
              else setBrowsedPath(draft)
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none"
            aria-label={t('project.path')}
            placeholder="~/dev/project"
          />
          <button type="button" disabled={busy || !draft.trim()} onClick={() => void confirm()} className="flex h-7 w-8 items-center justify-center rounded bg-accent text-ink-on-accent disabled:opacity-40" title={t('project.openHere')}>
            →
          </button>
        </div>
        {error && <div className="px-3 py-2 text-xs text-danger-strong">{error}</div>}
        <div className="max-h-[42vh] overflow-y-auto py-1">
          {suggestions?.dirs.map((dir) => (
            <button key={dir.path} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => enterDir(dir.path)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">
              <span aria-hidden="true">📁</span><span>{dir.name}</span><span className="ml-auto max-w-[65%] truncate font-mono text-[10px] text-ink-muted">{dir.path}</span>
            </button>
          ))}
          {suggestions && suggestions.dirs.length === 0 && <div className="px-3 py-3 text-xs text-ink-muted">{t('project.emptyFolder')}</div>}
        </div>
      </div>
    </div>
  )
}
