import { useEffect, useRef, useState } from 'react'
import { DialogFrame } from '@mew/ui'
import { AgentSetPicker } from './AgentSetPicker'
import { applyGitAiCommit, fetchGitAiCommit, fetchWorkspace, startGitAiCommit, stopGitAiCommit, type AgentSet } from '../api/client'
import { gitAiCommitActive, type GitAiCommitDraft, type GitAiCommitJob } from '../../shared/git-ai-commit'
import { uuid } from '../utils/uuid'

export function GitAiCommitDialog({ project, onApply, onClose }: {
  project: string
  onApply: (draft: GitAiCommitDraft) => void
  onClose: () => void
}) {
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [job, setJob] = useState<GitAiCommitJob | null>(null)
  const [selected, setSelected] = useState<AgentSet | null>(null)
  const [choosing, setChoosing] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const alive = useRef(true)
  const retryId = useRef<string | null>(null)
  const active = gitAiCommitActive(job)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    void fetchWorkspace().then(async info => {
      const result = await fetchGitAiCommit(project, info.path)
      if (disposed) return
      setWorkspace(info.path); setJob(result.job)
      setChoosing(!result.job)
    }).catch(err => { if (!disposed) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [project, reload])
  useEffect(() => {
    if (!active || !workspace) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await fetchGitAiCommit(project, workspace)
        if (!disposed) { setJob(result.job); setError(null) }
      } catch (err) { if (!disposed) setError(err instanceof Error ? err.message : String(err)) }
      if (!disposed) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 500)
    return () => { disposed = true; clearTimeout(timer) }
  }, [active, project, workspace])
  const choose = (set: AgentSet) => { setSelected(set); setChoosing(false); retryId.current = null }
  const generate = async () => {
    if (!workspace || !selected || busy || active) return
    setBusy(true); setStopping(false); setError(null)
    retryId.current ??= uuid()
    try {
      const result = await startGitAiCommit(project, workspace, retryId.current, selected.id)
      if (alive.current) { setJob(result.job); retryId.current = null }
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)) }
    finally { if (alive.current) setBusy(false) }
  }
  const stop = async () => {
    if (!workspace || !job || stopping) return
    setStopping(true)
    try { await stopGitAiCommit(project, workspace, job.id) }
    catch (err) { if (alive.current) { setError(err instanceof Error ? err.message : String(err)); setStopping(false) } }
  }
  const apply = async () => {
    if (!workspace || !job || busy) return
    setBusy(true); setError(null)
    try {
      const { draft } = await applyGitAiCommit(project, workspace, job.id)
      if (alive.current) onApply(draft)
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)) }
    finally { if (alive.current) setBusy(false) }
  }
  return (
    <DialogFrame labelledBy="git-ai-title" onClose={onClose} className="flex max-h-[90dvh] max-w-lg flex-col text-ink">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 id="git-ai-title" className="text-sm font-semibold">AI Commit</h2>
          <button type="button" onClick={onClose} className="rounded px-3 py-2 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-link">닫기</button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <p className="text-xs leading-relaxed text-ink-secondary">에이전트셋으로 변경사항을 분석해 커밋 제목과 설명을 작성합니다. 초안을 적용한 뒤 커밋 버튼으로 확정하세요.</p>
          {loading ? <p role="status" className="text-sm text-ink-secondary">생성 작업을 확인하는 중…</p> : <>
            {error && <div role="alert" className="space-y-2 text-xs text-danger"><p className="whitespace-pre-wrap break-words">{error}</p>{!workspace && <button type="button" onClick={() => setReload(value => value + 1)} className="rounded border border-edge-strong px-3 py-2 text-ink">다시 시도</button>}</div>}
            {job && <section className="space-y-2" aria-label="생성 작업">
              <div role="status" className="text-sm font-medium">{job.agentSetName} · {active ? stopping ? '취소 중…' : '생성 중…' : job.state === 'completed' ? '초안 생성 완료' : job.state === 'cancelled' ? '생성 취소됨' : '생성 실패'}</div>
              <p className="text-xs text-ink-secondary">{new Date(job.startedAt).toLocaleString()} 기준 변경사항</p>
              {job.truncated && <p className="text-xs text-warning">변경량이 커서 일부 diff가 생략됐습니다. 적용 전 내용을 확인하세요.</p>}
              {job.error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-danger">{job.error}</p>}
              {job.result && <div className="space-y-2 rounded-md border border-edge-strong bg-surface p-3"><p className="select-text break-words text-sm font-medium">{job.result.title}</p><p className="select-text whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-secondary">{job.result.description}</p></div>}
              {job.output && <details className="text-xs text-ink-secondary"><summary className="cursor-pointer py-2">진행 로그</summary><pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-words rounded bg-surface p-3 font-mono text-xs">{job.output}</pre></details>}
              {active && <p className="text-xs text-ink-secondary">창을 닫아도 생성은 계속됩니다. AI Commit을 다시 열면 확인할 수 있습니다.</p>}
            </section>}
            {!active && !busy && (choosing ? <section aria-label="에이전트셋 선택"><h3 className="mb-3 text-xs font-medium text-ink-secondary">에이전트셋 선택</h3><AgentSetPicker onSelect={choose} onCreated={choose} /></section> : <div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-ink-secondary">{selected?.name ?? '다시 생성할 에이전트셋을 선택하세요'}</span><button type="button" onClick={() => setChoosing(true)} className="shrink-0 rounded border border-edge-strong px-3 py-2 hover:bg-surface-hover">에이전트셋 선택</button></div>)}
          </>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge p-3">
          {active ? <button type="button" disabled={stopping} onClick={() => void stop()} className="rounded border border-edge-strong px-4 py-2 text-xs hover:bg-surface-hover disabled:opacity-40">생성 취소</button> : <>
            <button type="button" disabled={loading || busy || !workspace || !selected || choosing} onClick={() => void generate()} className="rounded border border-edge-strong px-4 py-2 text-xs hover:bg-surface-hover disabled:opacity-40">{busy ? '처리 중…' : job ? '다시 생성' : '초안 생성'}</button>
            {job?.result && <button type="button" disabled={busy} onClick={() => void apply()} className="rounded bg-accent px-4 py-2 text-xs text-ink-on-accent hover:bg-accent-strong disabled:opacity-40">초안 적용</button>}
          </>}
        </div>
    </DialogFrame>
  )
}
