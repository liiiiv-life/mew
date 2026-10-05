import { PanelCloseButton } from './panel-close-button'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useCallback, useEffect, useState } from 'react'
import { copyText } from '@mew/ui'
import { Check, Copy, Refresh } from 'iconoir-react'
import {
  fetchAndroidEnvStatus,
  fetchBrowserFrameUrl,
  killTmuxSession,
  runAndroidCommand,
  type AndroidCommandItem,
  type AndroidEnvStatus,
} from '../api/client'
import { SessionTerminalPopup } from './SessionTerminalPopup'

const GATEWAY_KEY = 'mew:android-gateway-url'
const DEFAULT_GATEWAY = 'http://localhost:8080/'

function loadGatewayUrl(): string {
  return localStorage.getItem(GATEWAY_KEY) || DEFAULT_GATEWAY
}

type RunnableAndroidCommand = AndroidCommandItem & {
  id: string
  command: string
  session: string
  running: boolean
}

function isRunnableCommand(item: AndroidCommandItem): item is RunnableAndroidCommand {
  return typeof item.id === 'string'
    && typeof item.command === 'string'
    && typeof item.session === 'string'
    && typeof item.running === 'boolean'
}

function CopyableCode({ text, label = uiText("복사"), action, busy, onRun, onStop, onOpenSession }: {
  text: string
  label?: string
  action?: RunnableAndroidCommand
  busy?: boolean
  onRun?: () => void
  onStop?: () => void
  onOpenSession?: () => void
}) {
  useUiLocale()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <span className="mt-1 flex min-w-0 items-start gap-1 rounded bg-surface-deep px-1.5 py-1">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-ink-muted">{text}</code>
      <button
        type="button"
        onClick={() => void copyText(text).then((ok) => ok && setCopied(true))}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
        aria-label={label}
        title={label}
      >
        {copied ? <Check width={12} height={12} strokeWidth={2.2} aria-hidden="true" /> : <Copy width={12} height={12} strokeWidth={2} aria-hidden="true" />}
      </button>
      {action && (
        <>
          <button
            type="button"
            onClick={action.running ? onStop : onRun}
            disabled={busy}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover disabled:opacity-40 ${
              action.running ? 'hover:text-danger-strong' : 'hover:text-accent-strong'
            }`}
            aria-label={`${action.context} ${action.running ? uiText("정지") : uiText("실행")}`}
            title={action.running ? uiText("정지 — tmux 세션 종료") : uiText("tmux에서 실행")}
          >
            {action.running ? <StopGlyph /> : <PlayGlyph />}
          </button>
          <button
            type="button"
            onClick={onOpenSession}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
            aria-label={uiText("{p0} 터미널 세션", { p0: action.context })}
            title={uiText("터미널 세션 보기")}
          >
            <TerminalGlyph />
          </button>
        </>
      )}
    </span>
  )
}

function CheckRow({ label, ok, detail, fixes, busyId, onRun, onStop, onOpenSession }: {
  label: string
  ok: boolean
  detail: string
  fixes?: AndroidCommandItem[]
  busyId: string | null
  onRun: (command: RunnableAndroidCommand) => void
  onStop: (command: RunnableAndroidCommand) => void
  onOpenSession: (command: RunnableAndroidCommand) => void
}) {
  useUiLocale()
  return (
    <div className="grid grid-cols-[1.5rem_7rem_1fr] gap-2 border-b border-edge px-3 py-2 text-xs last:border-b-0">
      <span className={ok ? 'text-success' : 'text-warning'} aria-hidden="true">
        {ok ? '●' : '●'}
      </span>
      <span className="font-medium text-ink">{label}</span>
      <span className="min-w-0 text-ink-secondary">
        <span className="break-words">{detail}</span>
        {fixes?.map((step) => (
          <span key={`${step.context}:${step.command}`} className="mt-1 block">
            <span className="text-[11px] text-ink-muted">{step.context}</span>
            {step.command && (
              <CopyableCode
                text={step.command}
                label={uiText("{p0} 명령 복사", { p0: step.context })}
                action={isRunnableCommand(step) ? step : undefined}
                busy={step.id === busyId}
                onRun={() => isRunnableCommand(step) && onRun(step)}
                onStop={() => isRunnableCommand(step) && onStop(step)}
                onOpenSession={() => isRunnableCommand(step) && onOpenSession(step)}
              />
            )}
          </span>
        ))}
      </span>
    </div>
  )
}

export function AndroidPanel({ onClose }: { onClose: () => void }) {
  useUiLocale()
  const [status, setStatus] = useState<AndroidEnvStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [popup, setPopup] = useState<RunnableAndroidCommand | null>(null)
  const [gatewayDraft, setGatewayDraft] = useState(loadGatewayUrl)
  const [gatewayUrl, setGatewayUrl] = useState(loadGatewayUrl)
  const [frameSrc, setFrameSrc] = useState('about:blank')
  const [frameError, setFrameError] = useState<string | null>(null)

  const refreshStatus = useCallback(() => {
    setLoading(true)
    setStatusError(null)
    return fetchAndroidEnvStatus()
      .then(setStatus)
      .catch((err) => setStatusError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const running = status?.suggestedCommands.some((item) => item.running)
    || status?.checks.some((check) => check.fixes?.some((item) => item.running))

  // one-shot 명령이 끝나 자기 세션을 닫으면 ▶ 상태도 자동으로 돌아오게, 실행 중일 때만 폴링한다.
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void refreshStatus(), 2000)
    return () => window.clearInterval(timer)
  }, [refreshStatus, running])

  async function run(command: RunnableAndroidCommand) {
    if (busyId) return
    setBusyId(command.id)
    setCommandError(null)
    try {
      await runAndroidCommand(command.id)
      await refreshStatus()
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : uiText("실행 실패"))
    } finally {
      setBusyId(null)
    }
  }

  async function stop(command: RunnableAndroidCommand) {
    if (busyId) return
    setBusyId(command.id)
    setCommandError(null)
    try {
      await killTmuxSession(command.session)
      await refreshStatus()
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : uiText("종료 실패"))
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    let alive = true
    localStorage.setItem(GATEWAY_KEY, gatewayUrl)
    fetchBrowserFrameUrl(gatewayUrl)
      .then(({ url }) => {
        if (alive) {
          setFrameSrc(url)
          setFrameError(null)
        }
      })
      .catch((err) => {
        if (alive) {
          setFrameSrc('about:blank')
          setFrameError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      alive = false
    }
  }, [gatewayUrl])

  return (
    <>
      <section className="flex h-full min-w-0 flex-col bg-surface-deep text-ink" aria-label="Android">
      <div className="flex h-9 shrink-0 items-center border-b border-edge bg-surface pl-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="4" width="14" height="16" rx="2" />
            <path d="M9 8h6" />
            <path d="M9 17h6" />
            <path d="M8 2 6 5" />
            <path d="m16 2 2 3" />
          </svg>
          <span className="truncate text-sm font-medium">Android</span>
        </div>
        <button type="button" onClick={refreshStatus} className="rounded p-1 text-ink-secondary hover:bg-surface-hover hover:text-ink" title={uiText("상태 새로고침")} aria-label={uiText("상태 새로고침")}>
          <Refresh width={15} height={15} strokeWidth={2} aria-hidden="true" />
        </button>
        <PanelCloseButton onClick={onClose} aria-label={uiText("Android 닫기")} />
      </div>

      <div className="shrink-0 border-b border-edge bg-surface">
        <form
          className="flex items-center gap-1 px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault()
            setGatewayUrl(gatewayDraft)
          }}
        >
          <input
            value={gatewayDraft}
            onChange={(e) => setGatewayDraft(e.target.value)}
            className="min-w-0 flex-1 rounded border border-edge-strong bg-surface-deep px-2 py-1 font-mono text-xs text-ink outline-none focus:border-edge-bright"
            spellCheck={false}
            inputMode="url"
            aria-label={uiText("Android gateway 주소")}
          />
          <button type="submit" className="rounded bg-surface-raised px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">
            {uiText("열기")}</button>
        </form>
        {frameError && <div className="select-text border-t border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{frameError}</div>}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,18rem)_1fr] md:grid-rows-[minmax(11rem,16rem)_1fr]">
        <div className="min-h-0 overflow-auto border-b border-edge bg-surface">
          {statusError ? (
            <div className="select-text px-3 py-2 text-xs text-danger">{statusError}</div>
          ) : status ? (
            <>
              {commandError && <div className="select-text border-b border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{commandError}</div>}
              <div className="border-b border-edge px-3 py-2 text-xs text-ink-muted">
                <span>SDK</span>
                <CopyableCode text={status.sdkRoot} label={uiText("SDK 경로 복사")} />
              </div>
              {status.checks.map((check) => (
                <CheckRow
                  key={check.id}
                  label={check.label}
                  ok={check.ok}
                  detail={check.detail}
                  fixes={check.fixes}
                  busyId={busyId}
                  onRun={(command) => void run(command)}
                  onStop={(command) => void stop(command)}
                  onOpenSession={setPopup}
                />
              ))}
              {status.suggestedCommands.length > 0 && (
                <div className="border-t border-edge px-3 py-2 text-xs text-ink-muted">
                  <div className="mb-1 font-medium text-ink-secondary">{uiText("실행 예시")}</div>
                  <div className="space-y-1">
                    {status.suggestedCommands.map((item) => (
                      <div key={`${item.context}:${item.command}`}>
                        <div className="text-[11px] text-ink-muted">{item.context}</div>
                        <CopyableCode
                          text={item.command}
                          label={uiText("{p0} 명령 복사", { p0: item.context })}
                          action={item}
                          busy={item.id === busyId}
                          onRun={() => void run(item)}
                          onStop={() => void stop(item)}
                          onOpenSession={() => setPopup(item)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-2 text-xs text-ink-muted">{loading ? uiText("확인 중") : uiText("상태 없음")}</div>
          )}
        </div>
        <iframe
          key={frameSrc}
          src={frameSrc}
          title="Android gateway"
          className="min-h-0 w-full border-0 bg-black"
          sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts"
          referrerPolicy="same-origin"
        />
      </div>
      </section>

      {popup && (
        <SessionTerminalPopup
          title={popup.context}
          subtitle={popup.command}
          idleNote={popup.command}
          session={popup.session}
          running={popup.running}
          onRun={() => runAndroidCommand(popup.id)}
          onClose={() => setPopup(null)}
          onChanged={() => void refreshStatus()}
        />
      )}
    </>
  )
}

function PlayGlyph() {
  useUiLocale()
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function StopGlyph() {
  useUiLocale()
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

function TerminalGlyph() {
  useUiLocale()
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  )
}
