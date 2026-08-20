import { useEffect, useState } from 'react'
import { copyText } from '@mew/ui'
import { Check, Copy, Refresh, Xmark } from 'iconoir-react'
import { fetchAndroidEnvStatus, fetchBrowserFrameUrl, type AndroidEnvStatus } from '../api/client'

const GATEWAY_KEY = 'mew:android-gateway-url'
const DEFAULT_GATEWAY = 'http://localhost:8080/'

function loadGatewayUrl(): string {
  return localStorage.getItem(GATEWAY_KEY) || DEFAULT_GATEWAY
}

function CopyableCode({ text, label = '복사' }: { text: string; label?: string }) {
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
    </span>
  )
}

function CheckRow({ label, ok, detail, fixes }: {
  label: string
  ok: boolean
  detail: string
  fixes?: Array<{ context: string; command?: string }>
}) {
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
            {step.command && <CopyableCode text={step.command} label={`${step.context} 명령 복사`} />}
          </span>
        ))}
      </span>
    </div>
  )
}

export function AndroidPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<AndroidEnvStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [gatewayDraft, setGatewayDraft] = useState(loadGatewayUrl)
  const [gatewayUrl, setGatewayUrl] = useState(loadGatewayUrl)
  const [frameSrc, setFrameSrc] = useState('about:blank')
  const [frameError, setFrameError] = useState<string | null>(null)

  function refreshStatus() {
    setLoading(true)
    setStatusError(null)
    fetchAndroidEnvStatus()
      .then(setStatus)
      .catch((err) => setStatusError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refreshStatus()
  }, [])

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
    <section className="flex h-full min-w-0 flex-col bg-surface-deep text-ink" aria-label="Android">
      <div className="flex h-9 shrink-0 items-center border-b border-edge bg-surface px-2">
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
        <button type="button" onClick={refreshStatus} className="rounded p-1 text-ink-secondary hover:bg-surface-hover hover:text-ink" title="상태 새로고침" aria-label="상태 새로고침">
          <Refresh width={15} height={15} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" onClick={onClose} className="rounded p-1 text-ink-secondary hover:bg-surface-hover hover:text-ink" title="Android 닫기" aria-label="Android 닫기">
          <Xmark width={15} height={15} strokeWidth={2} aria-hidden="true" />
        </button>
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
            aria-label="Android gateway 주소"
          />
          <button type="submit" className="rounded bg-surface-raised px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">
            열기
          </button>
        </form>
        {frameError && <div className="border-t border-danger bg-danger-surface px-3 py-2 text-xs text-danger-ink">{frameError}</div>}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,18rem)_1fr] md:grid-rows-[minmax(11rem,16rem)_1fr]">
        <div className="min-h-0 overflow-auto border-b border-edge bg-surface">
          {statusError ? (
            <div className="px-3 py-2 text-xs text-danger">{statusError}</div>
          ) : status ? (
            <>
              <div className="border-b border-edge px-3 py-2 text-xs text-ink-muted">
                <span>SDK</span>
                <CopyableCode text={status.sdkRoot} label="SDK 경로 복사" />
              </div>
              {status.checks.map((check) => (
                <CheckRow key={check.id} label={check.label} ok={check.ok} detail={check.detail} fixes={check.fixes} />
              ))}
              {status.suggestedCommands.length > 0 && (
                <div className="border-t border-edge px-3 py-2 text-xs text-ink-muted">
                  <div className="mb-1 font-medium text-ink-secondary">실행 예시</div>
                  <div className="space-y-1">
                    {status.suggestedCommands.map((item) => (
                      <div key={`${item.context}:${item.command}`}>
                        <div className="text-[11px] text-ink-muted">{item.context}</div>
                        <CopyableCode text={item.command} label={`${item.context} 명령 복사`} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-2 text-xs text-ink-muted">{loading ? '확인 중' : '상태 없음'}</div>
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
  )
}
