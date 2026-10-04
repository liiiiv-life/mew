import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchAgentRuntimeAccount } from '../api/client'
import { useI18n } from '../i18n'
import { shortestQuota, type QuotaWindow } from '../../shared/agent-quota'

const interval = 5 * 60_000
const reads = new Map<string, { at: number; value: QuotaWindow[]; pending?: Promise<QuotaWindow[]> }>()
function read(runtime: string, account: string): Promise<QuotaWindow[]> {
  const key = `${account}:${runtime}`
  const previous = reads.get(key)
  if (previous?.pending) return previous.pending
  if (previous && Date.now() - previous.at < interval) return Promise.resolve(previous.value)
  const entry = { at: Date.now(), value: [] as QuotaWindow[], pending: undefined as Promise<QuotaWindow[]> | undefined }
  entry.pending = fetchAgentRuntimeAccount(runtime).then(result => result.account.quota ?? []).catch(() => [])
    .then(value => {
      entry.value = value; entry.at = Date.now(); entry.pending = undefined
      if (reads.size > 30) for (const [oldKey, old] of reads) { if (oldKey !== key && !old.pending) { reads.delete(oldKey); break } }
      return value
    })
  reads.set(key, entry)
  return entry.pending
}

const copy = {
  ko: { title: '전체 구독 한도', remaining: '구독 한도 {period} · {value}% 남음', unavailable: '구독 잔여량을 확인할 수 없음', reset: '초기화', minute: '분', hour: '시간', day: '일', week: '주' },
  en: { title: 'All subscription limits', remaining: 'Subscription quota {period} · {value}% remaining', unavailable: 'Subscription quota unavailable', reset: 'Resets', minute: 'm', hour: 'h', day: 'd', week: 'w' },
  ja: { title: '契約の全上限', remaining: '契約上限 {period} · 残り{value}%', unavailable: '契約の残量を確認できません', reset: 'リセット', minute: '分', hour: '時間', day: '日', week: '週' },
  'zh-CN': { title: '全部订阅额度', remaining: '订阅额度 {period} · 剩余{value}%', unavailable: '无法查询订阅余额', reset: '重置', minute: '分钟', hour: '小时', day: '天', week: '周' },
}

export function AgentQuotaBattery({ runtime, account, enabled }: { runtime: string; account: string; enabled: boolean }) {
  const { locale } = useI18n()
  const key = `${account}:${runtime}`
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const popupId = useId()
  const [position, setPosition] = useState({ left: 0, top: 0, width: 288, maxHeight: 320 })
  const close = useCallback(() => { setOpen(false); buttonRef.current?.focus() }, [])
  useOverlayDismiss(open && close, { outside: () => rootRef.current })
  useEffect(() => { setOpen(false) }, [key, enabled])
  useEffect(() => {
    if (!open) return
    const place = () => {
      const bounds = buttonRef.current?.getBoundingClientRect()
      if (!bounds) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = Math.min(288, (viewport?.width ?? window.innerWidth) - 16)
      const y = bounds.bottom + 4
      setPosition({ left: Math.max(left + 8, Math.min(bounds.right - width, left + (viewport?.width ?? window.innerWidth) - width - 8)), top: y, width, maxHeight: Math.max(40, top + (viewport?.height ?? window.innerHeight) - y - 8) })
    }
    place()
    popupRef.current?.focus()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place) }
  }, [open])
  const [snapshot, setSnapshot] = useState<{ key: string; windows: QuotaWindow[] }>({ key, windows: [] })
  const [now, setNow] = useState(Date.now)
  const supported = ['codex', 'claude', 'kimi'].includes(runtime)
  useEffect(() => {
    setSnapshot({ key, windows: [] })
    if (!enabled || !supported) return
    let alive = true
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      setNow(Date.now())
      void read(runtime, account).then(windows => { if (alive) { setSnapshot({ key, windows }); setNow(Date.now()) } })
    }
    refresh()
    const timer = window.setInterval(refresh, interval)
    document.addEventListener('visibilitychange', refresh)
    // Expired windows are unknown until the next read, never assumed to be full.
    const clock = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => { alive = false; clearInterval(timer); clearInterval(clock); document.removeEventListener('visibilitychange', refresh) }
  }, [runtime, account, key, enabled, supported])
  if (!supported) return null
  const windows = snapshot.key === key && enabled ? snapshot.windows : []
  const quota = shortestQuota(windows, now)
  const value = quota ? Math.floor(quota.remainingPercent) : null
  const c = copy[locale] ?? copy.en
  const period = (row: QuotaWindow) => {
    const minutes = row.windowMinutes
    const [unit, divisor] = minutes % 10080 === 0 ? ['week', 10080] as const : minutes % 1440 === 0 ? ['day', 1440] as const : minutes % 60 === 0 ? ['hour', 60] as const : ['minute', 1] as const
    return `${minutes / divisor}${c[unit]}${row.name ? ` · ${row.name}` : ''}`
  }
  let label = quota ? c.remaining.replace('{period}', period(quota)).replace('{value}', String(value)) : c.unavailable
  if (quota?.resetsAt) label += ` · ${c.reset} ${new Date(quota.resetsAt).toLocaleString(locale)}`
  return <div ref={rootRef} className="shrink-0">
    <button ref={buttonRef} type="button" onClick={() => setOpen(value => !value)} aria-label={label} aria-expanded={open} aria-controls={open ? popupId : undefined} aria-haspopup="dialog" className="rounded-full focus-visible:outline-2 focus-visible:outline-accent">
    <span role={quota ? 'meter' : 'img'} aria-label={label} aria-valuemin={quota ? 0 : undefined} aria-valuemax={quota ? 100 : undefined} aria-valuenow={value ?? undefined} aria-valuetext={quota ? label : undefined} data-tip={label}
    className="relative my-1 flex h-5 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge-bright bg-surface-deep text-[11px] font-medium tabular-nums text-ink">
    {quota && <span aria-hidden="true" className={`absolute inset-y-0 left-0 ${value! <= 10 ? 'bg-danger/25' : value! <= 25 ? 'bg-warning/25' : 'bg-accent/25'}`} style={{ width: `${quota.remainingPercent}%` }} />}
    <span aria-hidden="true" className="relative">{value ?? '—'}</span>
  </span>
    </button>
    {open && <div ref={popupRef} id={popupId} role="dialog" tabIndex={-1} aria-label={c.title} className="fixed z-50 overflow-y-auto overscroll-contain rounded-lg border border-edge-bright bg-surface p-2 text-xs text-ink shadow-lg outline-none" style={position}>
      <div className="mb-2 font-medium">{c.title}</div>
      {windows.length ? [...windows].sort((a, b) => a.windowMinutes - b.windowMinutes).map((row, index) => {
        const valid = !row.resetsAt || Date.parse(row.resetsAt) > now
        return <div key={index} className="mb-2 last:mb-0">
          <div className="flex items-center justify-between gap-2"><span>{period(row)}</span><span className="shrink-0 tabular-nums">{valid ? `${Math.floor(row.remainingPercent)}%` : '—'}</span></div>
          <div className="my-1 h-1 overflow-hidden rounded-full bg-surface-deep"><div className="h-full rounded-full bg-accent" style={{ width: valid ? `${row.remainingPercent}%` : '0%' }} /></div>
          {row.resetsAt && <div className="text-ink-secondary">{c.reset} {new Date(row.resetsAt).toLocaleString(locale)}</div>}
        </div>
      }) : <div className="text-ink-secondary">{c.unavailable}</div>}
    </div>}
  </div>
}
