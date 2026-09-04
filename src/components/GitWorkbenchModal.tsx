import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchGitRepositories } from '../api/client'
import { WORKSPACE_PROJECT } from '../utils/active-project'
import { GitWorkbench } from './GitWorkbench'

type RepositoryChoice = { project: string; path: string; label: string; detail: string }

/** Git은 먼저 저장소를 고른 뒤 그래프·변경사항 화면으로 들어가는 독립 팝업이다. */
export function GitWorkbenchModal({ onNotice, onClose }: { onNotice: (message: string) => void; onClose: () => void }) {
  const [choices, setChoices] = useState<RepositoryChoice[]>([])
  const [selected, setSelected] = useState<RepositoryChoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useOverlayDismiss(onClose)

  useEffect(() => {
    let alive = true
    Promise.all([fetchGitRepositories(WORKSPACE_PROJECT), fetchGitRepositories('docs')])
      .then(([workspace, docs]) => {
        if (!alive) return
        setChoices([
          ...workspace.repositories.map(({ path }) => ({ project: WORKSPACE_PROJECT, path, label: path || '루트 프로젝트', detail: path || '현재 프로젝트 루트' })),
          ...docs.repositories.map(({ path }) => ({ project: 'docs', path, label: path ? `Documents / ${path}` : 'Documents', detail: path || 'Documents 저장소' })),
        ])
      })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-3 sm:p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Git"
        className="flex h-[min(88vh,52rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-deep shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {selected ? (
          <GitWorkbench key={`${selected.project}:${selected.path}`} project={selected.project} repositoryPath={selected.path} onNotice={onNotice} onClose={onClose} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="flex h-11 shrink-0 items-center border-b border-edge px-3">
              <span className="flex-1 text-sm font-semibold text-ink">저장소 선택</span>
              <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink" aria-label="Git 팝업 닫기" title="닫기 (Esc)">×</button>
            </div>
            {error && <div className="flex items-center gap-2 border-b border-edge bg-danger/10 px-3 py-2 text-xs text-danger"><span className="min-w-0 flex-1">{error}</span><button type="button" onClick={() => setError(null)} aria-label="오류 닫기">×</button></div>}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="p-5 text-center text-xs text-ink-muted">저장소를 찾는 중…</div>
              ) : choices.length === 0 ? (
                <div className="p-5 text-center text-xs text-ink-muted">열 수 있는 Git 저장소가 없습니다.</div>
              ) : choices.map((choice) => (
                <button key={`${choice.project}:${choice.path}`} type="button" onClick={() => setSelected(choice)} className="flex w-full items-center gap-3 rounded px-3 py-3 text-left hover:bg-surface-hover">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-muted" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="7" cy="19" r="2" /><path d="M6 7v10M8 8.5c3.5 0 4.5-1.5 8-1.5" /></svg>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{choice.label}</span><span className="block truncate text-xs text-ink-muted">{choice.detail}</span></span>
                  <span className="text-ink-muted" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
