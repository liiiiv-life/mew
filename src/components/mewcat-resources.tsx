import { useEffect, useState, type RefObject, type ReactNode } from 'react'
import { useMewcatBubble } from '../hooks/use-mewcat-bubble'
import { useOverlayDismiss } from '@mew/ui'
import { Check, WarningTriangle, Xmark } from 'iconoir-react'
import { fetchSystemStats, type SystemStats } from '../api/client'
import { useI18n } from '../i18n'
import { dismissMewcatNotice, openMewcatNotice, useMewcatNotices } from '../utils/mewcat-notifications'

const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`

export function MewcatResources({ anchorRef, onOpen, onClose, assistant }: { assistant?: ReactNode; anchorRef: RefObject<HTMLDivElement | null>; onOpen?: () => void; onClose: () => void }) {
  const bubbleRef = useMewcatBubble(anchorRef, true, assistant ? 340 : 260)
  const { t } = useI18n()
  const notices = useMewcatNotices()
  const recent = [...notices].sort((a, b) => b.id - a.id)
  const canReadResources = !!onOpen
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [failed, setFailed] = useState(false)
  useOverlayDismiss(onClose)

  useEffect(() => {
    if (!canReadResources) { setStats(null); setFailed(false); return }
    const controller = new AbortController()
    let pending = false
    const poll = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const next = await fetchSystemStats(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
        if (controller.signal.aborted) return
        setStats(next)
        setFailed(false)
      } catch {
        if (controller.signal.aborted) return
        setStats(null)
        setFailed(true)
      } finally { pending = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [canReadResources])

  const gpuUsage = stats?.gpus.map(gpu => gpu.utilization).filter((value): value is number => value !== null && Number.isFinite(value)) ?? []
  const metrics = [
    ['CPU', percent(stats?.cpu.usage)],
    [t('system.memory'), percent(stats && stats.memory.total > 0 ? stats.memory.used / stats.memory.total * 100 : null)],
    ['GPU', percent(gpuUsage.length ? Math.max(...gpuUsage) : null)],
  ]

  return <aside ref={bubbleRef} className="mewcat-notifications mewcat-notifications-with-cat" aria-label={t('mewcat.recent')}>
    <div className="mewcat-notifications-content">
      <header className="mewcat-notification-header">
        <h2 className="text-xs font-medium text-ink">{t('mewcat.recent')}</h2>
        <button type="button" className="mewcat-notification-button shrink-0 text-ink-secondary" onClick={onClose} aria-label={t('common.close')}><Xmark width={16} height={16} /></button>
      </header>
      {recent.length ? <ul className="mewcat-notification-list">
        {recent.map(notice => {
          const Icon = notice.level === 'success' ? Check : WarningTriangle
          const body = <>
            <span className="block break-words text-xs leading-[18px] text-ink">{notice.kind === 'test' ? t('mewcat.testBody') : t(`mewcat.${notice.kind}`)}</span>
            <span className="mt-0.5 block break-words text-[11px] leading-4 text-ink-secondary">{notice.kind === 'test' ? t('settings.mewcat') : notice.source}</span>
          </>
          return <li key={notice.id} className="mewcat-notification-row">
            <Icon width={16} height={16} className={`mewcat-notification-status shrink-0 ${notice.level === 'danger' ? 'text-danger' : notice.level === 'warning' ? 'text-warning' : 'text-success'}`} aria-hidden="true" />
            {notice.target ? <button type="button" className="min-w-0 flex-1 self-stretch rounded text-left hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { onClose(); openMewcatNotice(notice) }}>{body}</button>
              : <div className="min-w-0 flex-1">{body}</div>}
            <button type="button" className="mewcat-notification-button shrink-0 text-ink-secondary" aria-label={`${t('mewcat.dismiss')}: ${notice.kind === 'test' ? t('settings.mewcat') : notice.source}`} onClick={() => dismissMewcatNotice(notice.id)}><Xmark width={16} height={16} /></button>
          </li>
        })}
      </ul> : <p className="mewcat-notification-empty text-xs leading-relaxed text-ink-secondary">{t('mewcat.empty')}</p>}
      {assistant}
      {canReadResources && <button type="button" onClick={onOpen} aria-label={t('mewcat.system')}
        title={t(failed ? 'system.resourceLoadFailed' : stats ? 'system.title' : 'system.loading')}
        className="mewcat-notification-metrics flex w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 border-t border-edge text-[11px] tabular-nums text-ink-secondary hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        {metrics.map(([label, value]) => <span key={label}>{label}-{value}</span>)}
      </button>}
    </div>
  </aside>
}
