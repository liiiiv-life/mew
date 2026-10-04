import { useEffect, useState } from 'react'
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
  ko: { remaining: '구독 한도 {period} · {value}% 남음', unavailable: '구독 잔여량을 확인할 수 없음', reset: '초기화', minute: '분', hour: '시간', day: '일', week: '주' },
  en: { remaining: 'Subscription quota {period} · {value}% remaining', unavailable: 'Subscription quota unavailable', reset: 'Resets', minute: 'm', hour: 'h', day: 'd', week: 'w' },
  ja: { remaining: '契約上限 {period} · 残り{value}%', unavailable: '契約の残量を確認できません', reset: 'リセット', minute: '分', hour: '時間', day: '日', week: '週' },
  'zh-CN': { remaining: '订阅额度 {period} · 剩余{value}%', unavailable: '无法查询订阅余额', reset: '重置', minute: '分钟', hour: '小时', day: '天', week: '周' },
}

export function AgentQuotaBattery({ runtime, account, enabled }: { runtime: string; account: string; enabled: boolean }) {
  const { locale } = useI18n()
  const key = `${account}:${runtime}`
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
  const quota = shortestQuota(snapshot.key === key && enabled ? snapshot.windows : [], now)
  const value = quota ? Math.floor(quota.remainingPercent) : null
  const c = copy[locale] ?? copy.en
  let label = c.unavailable
  if (quota) {
    const minutes = quota.windowMinutes
    const [unit, divisor] = minutes % 10080 === 0 ? ['week', 10080] as const : minutes % 1440 === 0 ? ['day', 1440] as const : minutes % 60 === 0 ? ['hour', 60] as const : ['minute', 1] as const
    label = c.remaining.replace('{period}', `${minutes / divisor}${c[unit]}`).replace('{value}', String(value))
    if (quota.resetsAt) label += ` · ${c.reset} ${new Date(quota.resetsAt).toLocaleString(locale)}`
  }
  return <span role={quota ? 'meter' : 'img'} aria-label={label} aria-valuemin={quota ? 0 : undefined} aria-valuemax={quota ? 100 : undefined} aria-valuenow={value ?? undefined} aria-valuetext={label} data-tip={label}
    className="relative my-1 flex h-5 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-edge-bright bg-surface-deep text-[11px] font-medium tabular-nums text-ink">
    {quota && <span aria-hidden="true" className={`absolute inset-y-0 left-0 ${value! <= 10 ? 'bg-danger/25' : value! <= 25 ? 'bg-warning/25' : 'bg-accent/25'}`} style={{ width: `${quota.remainingPercent}%` }} />}
    <span aria-hidden="true" className="relative">{value ?? '—'}</span>
  </span>
}
