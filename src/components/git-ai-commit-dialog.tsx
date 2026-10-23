import { uiText, getUiLocale } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useRef, useState } from 'react'
import { DialogFrame } from '@mew/ui'
import { AgentSetPicker } from './AgentSetPicker'
import { fetchGitAiCommit, fetchWorkspace, startGitAiCommit, stopGitAiCommit, type AgentSet } from '../api/client'
import { gitAiCommitActive, type GitAiCommitJob } from '../../shared/git-ai-commit'
import { uuid } from '../utils/uuid'

export function GitAiCommitDialog({ project, files, onFinished, onClose }: {
  project: string
  files: string[]
  onFinished: () => void
  onClose: () => void
}) {
  useUiLocale()
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
  const notified = useRef('')
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  const active = gitAiCommitActive(job)
  useEffect(() => {
    if (!job || active || notified.current === job.id) return
    notified.current = job.id
    onFinishedRef.current()
  }, [job, active])
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
      const result = await startGitAiCommit(project, workspace, retryId.current, selected.id, files)
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
  return (
    <DialogFrame labelledBy="git-ai-title" onClose={onClose} className="flex max-h-[90dvh] max-w-lg flex-col text-ink">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 id="git-ai-title" className="text-sm font-semibold">{uiText("AI 자동 커밋")}</h2>
          <button type="button" onClick={onClose} className="rounded px-3 py-2 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-link">{uiText("닫기")}</button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <p className="text-xs leading-relaxed text-ink-secondary">{uiText("선택한 파일 {count}개를 Mew 커밋 스킬로 분석해 작업 단위로 나누고 실제 커밋을 만듭니다. 필요하면 여러 커밋으로 나누며 push는 하지 않습니다.", { count: files.length })}</p>
          <p className="text-xs text-ink-secondary">{uiText("지침 파일은 Skills 관리 → Mew → commit에서 편집할 수 있습니다.")}</p>
          {loading ? <p role="status" className="text-sm text-ink-secondary">{uiText("커밋 작업을 확인하는 중…")}</p> : <>
            {error && <div role="alert" className="space-y-2 text-xs text-danger"><p className="whitespace-pre-wrap break-words">{error}</p>{!workspace && <button type="button" onClick={() => setReload(value => value + 1)} className="rounded border border-edge-strong px-3 py-2 text-ink">{uiText("다시 시도")}</button>}</div>}
            {job && <section className="space-y-2" aria-label={uiText("커밋 작업")}>
              <div role="status" className="text-sm font-medium">{job.agentSetName} · {active ? stopping ? uiText("중단 중…") : job.state === 'committing' ? uiText("커밋 중…") : uiText("변경사항 분석 중…") : job.state === 'completed' ? uiText("자동 커밋 완료") : job.state === 'cancelled' ? uiText("작업 중단됨") : uiText("자동 커밋 실패")}</div>
              <p className="text-xs text-ink-secondary">{uiText("{time} 기준 변경사항", { time: new Date(job.startedAt).toLocaleString(getUiLocale()) })}</p>

              {job.error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-danger">{job.error}</p>}
              {job.result?.commits?.map(commit => <div key={commit.hash} className="space-y-1 border-b border-edge py-2">
                <p className="select-text break-words text-sm font-medium">{commit.title}</p>
                <p className="select-text text-xs text-ink-secondary">{commit.hash.slice(0, 8)} · {commit.files.length}{uiText("개 파일")}</p>
                {commit.description && <p className="select-text whitespace-pre-wrap break-words text-xs text-ink-secondary">{commit.description}</p>}
                <details className="text-xs text-ink-secondary"><summary className="cursor-pointer py-1">{uiText("포함 파일")}</summary>{commit.files.map(file => <p key={file} className="select-text break-all">{file}</p>)}</details>
              </div>)}
              {job.result?.skipped?.map(item => <p key={item.file} className="select-text break-words text-xs text-ink-secondary">{uiText("남김 ·")} {item.file}: {item.reason}</p>)}
              {job.result && job.state !== 'completed' && !!job.result.commits.length && <p className="text-xs text-ink-secondary">{uiText("이미 만든 커밋은 유지됩니다. 남은 변경을 확인한 뒤 다시 실행하세요.")}</p>}
              {job.output && <details className="text-xs text-ink-secondary"><summary className="cursor-pointer py-2">{uiText("진행 로그")}</summary><pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-words rounded bg-surface p-3 font-mono text-xs">{job.output}</pre></details>}
              {active && <p className="text-xs text-ink-secondary">{uiText("창을 닫아도 커밋 작업은 계속됩니다. AI 자동 커밋을 다시 열면 확인할 수 있습니다.")}</p>}
            </section>}
            {!active && !busy && (choosing ? <section aria-label={uiText("에이전트셋 선택")}><h3 className="mb-3 text-xs font-medium text-ink-secondary">{uiText("에이전트셋 선택")}</h3><AgentSetPicker onSelect={choose} onCreated={choose} /></section> : <div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-ink-secondary">{selected?.name ?? uiText("다음 작업의 에이전트셋을 선택하세요")}</span><button type="button" onClick={() => setChoosing(true)} className="shrink-0 rounded border border-edge-strong px-3 py-2 hover:bg-surface-hover">{uiText("에이전트셋 선택")}</button></div>)}
          </>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge p-3">
          {active ? <button type="button" disabled={stopping} onClick={() => void stop()} className="rounded border border-edge-strong px-4 py-2 text-xs hover:bg-surface-hover disabled:opacity-40">{uiText("작업 중단")}</button> : <>
            <button type="button" disabled={loading || busy || !workspace || !selected || choosing || !files.length} onClick={() => void generate()} className="rounded border border-edge-strong px-4 py-2 text-xs hover:bg-surface-hover disabled:opacity-40">{busy ? uiText("처리 중…") : uiText("자동 커밋 실행")}</button>
          </>}
        </div>
    </DialogFrame>
  )
}
