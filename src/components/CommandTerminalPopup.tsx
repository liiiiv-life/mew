// 명령어 버튼의 터미널 아이콘으로 여는 팝업 — 그 버튼 전용 tmux 세션(mewcmd-*)을 붙여서 보여준다.
// [종료]는 세션을 죽이고 닫고, [닫기]는 세션을 살려둔 채 팝업만 닫는다(다음에 다시 열면 이어서 보인다).
import { useState } from 'react'
import { TmuxTerminal } from '@mew/tmux-term'
import { useOverlayDismiss } from '@mew/ui'
import { killTmuxSession, runCmdButton, type CmdButtonState } from '../api/client'
import { outsideTerminal } from '../utils/terminalFocus'

export function CommandTerminalPopup({
  project,
  button,
  onClose,
  onChanged,
}: {
  /** 이 버튼이 속한 프로젝트 — 화면의 활성 프로젝트와 다를 수 있다(다른 프로젝트 탭의 메뉴에서 열림) */
  project: string
  button: CmdButtonState
  /** 세션은 유지한 채 팝업만 닫는다 */
  onClose: () => void
  /** 실행/종료로 세션 상태가 바뀌었을 때 — 부모(드롭다운)가 목록을 새로고침한다 */
  onChanged: () => void
}) {
  const [started, setStarted] = useState(button.running)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 터미널 안에서 누른 Esc는 그 안의 프로그램에 양보하고, 그 밖에서 누른 Esc·뒤로가기만 팝업을 닫는다
  useOverlayDismiss(onClose, { closeOnEscape: outsideTerminal })

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await runCmdButton(project, button.name)
      setStarted(true)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '실행 실패')
    } finally {
      setBusy(false)
    }
  }

  async function kill() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await killTmuxSession(button.session)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '종료 실패')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
          <PlayGlyph className="shrink-0 text-accent-strong" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{button.name}</div>
            <div className="truncate font-mono text-xs text-ink-muted" title={button.command}>{button.command}</div>
          </div>
          {started && <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] text-ink-secondary">실행 세션</span>}
        </div>

        <div className="relative min-h-0 flex-1 bg-surface-deep">
          {started ? (
            <div className="h-full">
              <TmuxTerminal sessionName={button.session} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="text-sm text-ink-muted">이 명령은 아직 실행되지 않았습니다.</div>
              <code className="max-w-full truncate rounded bg-surface px-2 py-1 font-mono text-xs text-ink-secondary">{button.command}</code>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-ink-on-accent disabled:opacity-50"
              >
                <PlayGlyph className="h-3.5 w-3.5" />
                실행
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
          {error && <span className="mr-auto truncate text-xs text-danger-strong">{error}</span>}
          <button
            type="button"
            onClick={kill}
            disabled={busy}
            className="ml-auto rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
            title="tmux 세션을 종료하고 팝업을 닫습니다"
          >
            종료
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-edge-strong px-3 py-1 text-sm text-ink-secondary hover:bg-surface-hover"
            title="세션은 유지하고 팝업만 닫습니다"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
