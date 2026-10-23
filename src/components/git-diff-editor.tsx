import { useEffect, useState } from 'react'
import { Page } from 'iconoir-react'
import { HoverTipLayer } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { fetchGitDiff, fetchGitWorkingTree, fetchGitWorkingTreeDiff } from '../api/client'
import { gitDiffTarget } from '../utils/git-diff-tabs'
import { subscribeLive } from '../utils/live-updates'
import { DiffView } from './git-diff-view'

export function GitDiffEditor({ path, visible, onOpenFile }: { path: string; visible: boolean; onOpenFile: (project: string, path: string) => void }) {
  useUiLocale()
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(true)
  const target = gitDiffTarget(path)
  useEffect(() => {
    const target = gitDiffTarget(path)
    if (!target) return
    let alive = true
    let revision = 0
    if (!visible) return
    const load = async () => {
      if (!alive || document.hidden) return
      const requested = revision
      try {
        const working = await fetchGitWorkingTree(target.repositoryPath, target.project)
        if (!alive || revision !== requested) return
        const file = working.files.find(file => file.path === target.filePath)
        const result = target.source.kind === 'commit'
          ? await fetchGitDiff(target.repositoryPath, target.source.hash, target.filePath, target.project)
          : file ? await fetchGitWorkingTreeDiff(target.repositoryPath, target.filePath, target.project) : { diff: '' }
        if (!alive || revision !== requested) return
        setDiff(result.diff)
        setDeleted(file?.status.includes('D') ?? false)
        setError(null)
      } catch (err) {
        if (alive && revision === requested) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    const unsubscribe = target.source.kind === 'working' ? subscribeLive<{ diff: string; deleted: boolean }>({ kind: 'git-diff', project: target.project, path: target.repositoryPath, file: target.filePath }, next => {
      ++revision; setDiff(next.diff); setDeleted(next.deleted); setError(null); setLoading(false)
    }, err => setError(err.message)) : undefined
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [path, visible])
  if (!target) return null
  return <div data-git-diff-editor className="mew-panel-surface flex min-h-0 min-w-0 flex-1 flex-col bg-surface-raised">
    <HoverTipLayer className="flex h-9 shrink-0 items-center gap-2 border-b border-edge px-2">
      <span className="min-w-0 flex-1 truncate text-[10px] text-ink" title={target.filePath}>{target.filePath}</span>
      {target.source.kind === 'commit' && <span className="font-mono text-[10px] text-ink-muted">{target.source.hash.slice(0, 8)}</span>}
      <button type="button" onClick={() => onOpenFile(target.project, [target.repositoryPath, target.filePath].filter(Boolean).join('/'))}
        disabled={deleted || loading} aria-label={uiText('파일 열기')} data-tip={uiText('파일 열기')}
        className="flex size-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
        <Page width={16} height={16} aria-hidden="true" />
      </button>
    </HoverTipLayer>
    {error && <div role="alert" className="border-b border-edge px-3 py-2 text-xs text-danger">{error}</div>}
    <div className="min-h-0 flex-1 overflow-auto"><DiffView diff={diff} loading={loading} /></div>
  </div>
}
