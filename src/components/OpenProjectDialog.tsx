import { useCallback, useEffect, useRef, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import {
  browseExternalEntries,
  cloneExternalGit,
  createExternalFolder,
  initializeExternalGit,
  type ExternalEntriesResult,
} from '../api/client'
import { useI18n } from '../i18n'

export function OpenProjectDialog({ basePath, onOpen, onClose }: {
  basePath: string
  onOpen: (path: string) => Promise<void> | void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [path, setPath] = useState(basePath)
  const [draft, setDraft] = useState(basePath)
  const [result, setResult] = useState<ExternalEntriesResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createMenu, setCreateMenu] = useState(false)
  const requestSeq = useRef(0)
  useOverlayDismiss(onClose)

  const load = useCallback((nextPath: string) => {
    const seq = ++requestSeq.current
    setResult(null)
    setError(null)
    browseExternalEntries(nextPath)
      .then((next) => {
        if (requestSeq.current !== seq) return
        setResult(next)
        setPath(next.path)
        setDraft(next.path)
      })
      .catch((err: unknown) => {
        if (requestSeq.current === seq) setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(() => load(basePath), [basePath, load])

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setCreateMenu(false)
    try {
      await action()
      after?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const makeFolder = () => {
    const name = window.prompt('새 폴더 이름')?.trim()
    if (!name) return
    void run(() => createExternalFolder(path, name), () => load(path))
  }

  const cloneRepository = () => {
    const url = window.prompt('clone할 Git 저장소 주소')?.trim()
    if (!url) return
    const suggested = url.replace(/[\\/]+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/i, '') ?? ''
    const name = window.prompt('만들 폴더 이름', suggested)
    if (name === null) return
    void run(() => cloneExternalGit(path, url, name.trim() || undefined), () => load(path))
  }

  const initRepository = () => {
    if (!window.confirm(`현재 폴더를 Git 저장소로 초기화할까요?\n\n${path}`)) return
    void run(() => initializeExternalGit(path), () => load(path))
  }

  const confirm = async () => {
    if (!path || busy) return
    setBusy(true)
    setError(null)
    try {
      await onOpen(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const directories = result?.entries.filter((entry) => entry.type === 'dir') ?? []
  const currentIsGit = result?.entries.some((entry) => entry.name === '.git') ?? false

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-3" onMouseDown={onClose}>
      <div className="flex h-[76vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center border-b border-edge px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{t('project.open')}</span>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-ink-muted hover:bg-surface-hover" aria-label="닫기">×</button>
        </div>

        <form className="flex items-center gap-1.5 border-b border-edge px-3 py-2" onSubmit={(event) => { event.preventDefault(); load(draft) }}>
          <button type="button" onClick={() => load('')} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover" title="홈">⌂</button>
          <button type="button" disabled={!result?.parent} onClick={() => result?.parent && load(result.parent)} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-30" title="상위 폴더">↑</button>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} className="min-w-0 flex-1 rounded border border-edge bg-surface px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent" aria-label={t('project.path')} />
          <button type="submit" className="rounded px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover">이동</button>
          <div className="relative">
            <button type="button" disabled={!result || busy} onClick={() => setCreateMenu((open) => !open)} className="flex h-7 w-7 items-center justify-center rounded bg-accent text-base text-ink-on-accent hover:bg-accent-strong disabled:opacity-40" title="만들기">+</button>
            {createMenu && (
              <div className="absolute right-0 top-9 z-20 min-w-52 overflow-hidden rounded-lg border border-edge-bright bg-surface-raised py-1 text-xs shadow-xl">
                <button type="button" onClick={makeFolder} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">새 폴더</button>
                <button type="button" onClick={cloneRepository} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">Git 저장소 clone</button>
                <button type="button" disabled={currentIsGit} onClick={initRepository} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">현재 폴더에서 Git init</button>
              </div>
            )}
          </div>
        </form>

        {error && <div className="border-b border-edge bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {!result ? (
            !error && <div className="px-3 py-5 text-center text-xs text-ink-muted">불러오는 중…</div>
          ) : directories.length === 0 ? (
            <div className="px-3 py-5 text-center text-xs text-ink-muted">하위 폴더가 없습니다</div>
          ) : directories.map((entry) => (
            <button key={entry.path} type="button" onClick={() => load(entry.path)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink" title={entry.path}>
              <span aria-hidden="true">📁</span>
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.git && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">Git</span>}
              <span className="text-ink-muted">›</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-muted" title={path}>{path}</span>
          {currentIsGit && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">Git 저장소</span>}
          <button type="button" onClick={onClose} className="shrink-0 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover">취소</button>
          <button type="button" disabled={busy || !result} onClick={() => void confirm()} className="shrink-0 rounded bg-accent px-3 py-1 text-xs text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">
            {busy ? '처리 중…' : t('project.openHere')}
          </button>
        </div>
      </div>
    </div>
  )
}
