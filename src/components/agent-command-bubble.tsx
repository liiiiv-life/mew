import { useEffect, useState } from 'react'
import { Terminal as TerminalIcon, NavArrowRight } from 'iconoir-react'
import type { AgentCommandRecord } from '../../shared/agent-command'
import { agentCommandArchiveUrl, readAgentCommandOutput, stopAgentCommand } from '../api/agent-commands'
import { formatDuration } from '../utils/agentFold'
import { SessionTerminalPopup } from './SessionTerminalPopup'

const stateLabels = { queued: '대기 중', running: '실행 중', completed: '완료', failed: '실패', interrupted: '중단됨' }
const stateStyles = {
  queued: 'border-edge-bright bg-surface-raised text-ink-secondary',
  running: 'border-blue-500/40 bg-blue-500/10 text-ink',
  completed: 'border-success/40 bg-success/10 text-success-ink',
  failed: 'border-danger/30 bg-danger/10 text-danger-ink',
  interrupted: 'border-edge-bright bg-surface-raised text-ink-secondary',
}

export function AgentCommandBubble({ command, onOpen }: { command: AgentCommandRecord; onOpen: () => void }) {
  return <div className="space-y-2">
    <div className="ml-6 flex items-start gap-2 rounded-lg border border-edge-bright bg-surface-raised px-3 py-2.5 text-ink">
      <span aria-hidden="true" className="select-none font-mono text-ink-muted">$</span>
      <pre aria-label="CLI 명령" className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{command.command}</pre>
    </div>
    <button type="button" onClick={onOpen} className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${stateStyles[command.state]}`}>
      <TerminalIcon width={16} height={16} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{command.state === 'running' ? '터미널 열기' : '실행 기록 보기'}</span>
      <span className="shrink-0">{stateLabels[command.state]}</span>
      {command.finishedAt !== null && <span className="shrink-0 tabular-nums">{formatDuration(command.finishedAt - command.startedAt)}</span>}
      <NavArrowRight width={14} height={14} className="shrink-0" aria-hidden="true" />
    </button>
  </div>
}

export function AgentCommandPopup({ command, onClose, onChanged, onCancel }: { command: AgentCommandRecord; onClose: () => void; onChanged: () => void; onCancel?: () => void }) {
  const [output, setOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const running = command.state === 'running'
  useEffect(() => {
    if (running) return
    let disposed = false
    setError(null)
    void readAgentCommandOutput(command.id).then(result => { if (!disposed) setOutput(result.text) })
      .catch(error => { if (!disposed) setError(error instanceof Error ? error.message : String(error)) })
    return () => { disposed = true }
  }, [command.id, running, attempt])
  return <SessionTerminalPopup
    title="CLI 실행" subtitle={command.command} session={command.session} running={running}
    statusNote={`${stateLabels[command.state]}${command.exitCode === null ? '' : ` · 종료 코드 ${command.exitCode}`}${command.error ? ` · ${command.error}` : ''}`}
    statusTone={command.state === 'completed' ? 'success' : command.state === 'failed' ? 'danger' : 'muted'}
    onRun={async () => {}} onClose={onClose} onChanged={onChanged}
    onStop={async () => { if (onCancel) onCancel(); else await stopAgentCommand(command.id) }}
    completedContent={running ? undefined : <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2 text-xs text-ink-secondary">
        <span className="flex-1">{command.previewTruncated ? '최근 출력만 표시합니다. 전체 출력은 다운로드하세요.' : '저장된 출력 · 읽기 전용'}</span>
        {command.archived && <a href={agentCommandArchiveUrl(command.id)} className="rounded px-2 py-1 text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink-secondary">전체 출력 다운로드</a>}
      </div>
      {error ? <div role="alert" className="p-4 text-sm text-danger-strong">{error}<button type="button" className="ml-2 underline" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></div>
        : output === null ? <div role="status" className="p-4 text-sm text-ink-muted">출력을 불러오는 중…</div>
          : <pre tabIndex={0} aria-label="저장된 터미널 출력" className="min-h-0 flex-1 select-text overflow-auto whitespace-pre p-3 font-mono text-xs leading-relaxed text-ink outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent">{output || '출력 없음'}</pre>}
    </div>}
  />
}
