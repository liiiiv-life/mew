// tmux 세션 하나를 붙여 보여주는 팝업 — 명령어 버튼(mewcmd-*)과 예약 작업(mewcmd-job-*)이 함께 쓴다.
// 두 기능 다 "전용 세션에서 무언가를 돌리고 그 화면을 들여다본다"가 같아서 창을 한 벌만 둔다.
// [종료]는 세션을 죽이고 닫고, [닫기]는 세션을 살려둔 채 팝업만 닫는다(다음에 다시 열면 이어서 보인다).
//
// **반드시 body로 포털한다.** 모바일 이름표(ProjectPeek)가 transform을 써서 fixed 자손의 containing
// block이 되기 때문에, 그 안에 두면 inset-0이 화면이 아니라 이름표 상자 크기로 잡혀 팝업이 손톱만 해진다.
// data-cmd-overlay도 함께 붙인다 — 없으면 팝업 안을 누를 때 이름표가 닫히며 팝업까지 사라진다.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { TmuxTerminal } from '@mew/tmux-term'
import { useOverlayDismiss } from '@mew/ui'
import { killTmuxSession } from '../api/client'
import { outsideTerminal } from '../utils/terminalFocus'
import { useI18n } from '../i18n'

export function SessionTerminalPopup({
  title,
  subtitle,
  session,
  running,
  idleNote,
  statusNote,
  statusTone = 'muted',
  browserLoginUrl,
  onOpenBrowserLogin,
  onRun,
  onClose,
  onChanged,
}: {
  title: string
  /** 제목 아래 한 줄(명령어·주기 등) */
  subtitle?: string
  /** 붙여 볼 tmux 세션 이름 */
  session: string
  /** 열 때 이미 세션이 떠 있는지 — 아니면 실행 버튼만 보여준다 */
  running: boolean
  /** 아직 실행 전일 때 가운데 보여줄 한 줄 */
  idleNote?: string
  /** 실행 중인 전용 작업의 외부 상태 — 로그인 exit code처럼 터미널 연결과 별개인 값 */
  statusNote?: string
  statusTone?: 'muted' | 'success' | 'danger'
  /** device-code 흐름에서 등록표가 검증한 사용자 브라우저 인증 URL */
  browserLoginUrl?: string | null
  onOpenBrowserLogin?: () => void
  /** 실행(=세션 생성) 요청 */
  onRun: () => Promise<unknown>
  /** 세션은 유지한 채 팝업만 닫는다 */
  onClose: () => void
  /** 실행/종료로 세션 상태가 바뀌었을 때 — 부모가 목록을 새로고침한다 */
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [started, setStarted] = useState(running)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 터미널 안에서 누른 Esc는 그 안의 프로그램에 양보하고, 그 밖에서 누른 Esc·뒤로가기만 팝업을 닫는다
  useOverlayDismiss(onClose, { closeOnEscape: outsideTerminal })

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onRun()
      setStarted(true)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('terminal.runFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function kill() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await killTmuxSession(session)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('terminal.stopFailed'))
      setBusy(false)
    }
  }

  return createPortal(
    <div
      data-cmd-overlay
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-3 sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
          <PlayGlyph className="shrink-0 text-accent-strong" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{title}</div>
            {subtitle && (
              <div className="truncate font-mono text-xs text-ink-muted" title={subtitle}>
                {subtitle}
              </div>
            )}
          </div>
          {started && <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] text-ink-secondary">{t('terminal.runningSession')}</span>}
        </div>

        <div className="relative min-h-0 flex-1 bg-surface-deep">
          {started ? (
            <div className="h-full">
              <TmuxTerminal sessionName={session} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="text-sm text-ink-muted">{t('terminal.notStarted')}</div>
              {idleNote && (
                <code className="max-w-full truncate rounded bg-surface px-2 py-1 font-mono text-xs text-ink-secondary">{idleNote}</code>
              )}
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-ink-on-accent disabled:opacity-50"
              >
                <PlayGlyph className="h-3.5 w-3.5" />
                {t('terminal.run')}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
          {error ? (
            <span className="mr-auto truncate text-xs text-danger-strong">{error}</span>
          ) : statusNote ? (
            <span className={`mr-auto truncate text-xs ${
              statusTone === 'danger'
                ? 'text-danger-strong'
                : statusTone === 'success' ? 'text-success' : 'text-ink-muted'
            }`}>{statusNote}</span>
          ) : null}
          {browserLoginUrl && onOpenBrowserLogin && (
            <button
              type="button"
              onClick={onOpenBrowserLogin}
              className="shrink-0 rounded bg-accent px-3 py-1 text-sm text-ink-on-accent"
            >
              {t('terminal.continueInBrowser')}
            </button>
          )}
          <button
            type="button"
            onClick={kill}
            disabled={busy}
            className="ml-auto rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
            title={t('terminal.stopTitle')}
          >
            {t('terminal.stop')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-edge-strong px-3 py-1 text-sm text-ink-secondary hover:bg-surface-hover"
            title={t('terminal.closeTitle')}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
