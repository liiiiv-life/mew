import { useEffect, useState, type RefObject } from 'react'
import { useMewcatBubble } from '../hooks/use-mewcat-bubble'
import { useOverlayDismiss } from '@mew/ui'
import { Check, WarningTriangle, Xmark } from 'iconoir-react'
import { fetchSystemStats, type SystemStats } from '../api/client'
import { useI18n } from '../i18n'
import { dismissMewcatNotice, openMewcatNotice, useMewcatNotices } from '../utils/mewcat-notifications'

const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`

export function MewcatResources({ anchorRef, onOpen, onClose }: { anchorRef: RefObject<HTMLDivElement | null>; onOpen?: () => void; onClose: () => void }) {
  const bubbleRef = useMewcatBubble(anchorRef, true, 260)
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
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-xs font-medium text-ink">{t('mewcat.recent')}</h2>
        <button type="button" className="mewcat-notification-button -mr-1 shrink-0 text-ink-secondary" onClick={onClose} aria-label={t('common.close')}><Xmark width={14} height={14} /></button>
      </header>
      {recent.length ? <ul className="max-h-[min(32dvh,240px)] overflow-y-auto px-3 pb-2">
        {recent.map(notice => {
          const Icon = notice.level === 'success' ? Check : WarningTriangle
          const body = <>
            <span className="block text-xs leading-relaxed text-ink">{notice.kind === 'test' ? t('mewcat.testBody') : t(`mewcat.${notice.kind}`)}</span>
            <span className="mt-1 block break-words text-[11px] leading-relaxed text-ink-secondary">{notice.kind === 'test' ? t('settings.mewcat') : notice.source}</span>
          </>
          return <li key={notice.id} className="flex items-start gap-1.5 border-t border-edge py-2">
            <Icon width={13} height={13} className={`mt-2 shrink-0 ${notice.level === 'danger' ? 'text-danger' : notice.level === 'warning' ? 'text-warning' : 'text-success'}`} aria-hidden="true" />
            {notice.target ? <button type="button" className="min-w-0 flex-1 rounded px-1 py-1.5 text-left hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { onClose(); openMewcatNotice(notice) }}>{body}</button>
              : <div className="min-w-0 flex-1 px-1 py-1.5">{body}</div>}
            <button type="button" className="mewcat-notification-button -mr-1 shrink-0 text-ink-secondary" aria-label={`${t('mewcat.dismiss')}: ${notice.kind === 'test' ? t('settings.mewcat') : notice.source}`} onClick={() => dismissMewcatNotice(notice.id)}><Xmark width={13} height={13} /></button>
          </li>
        })}
      </ul> : <p className="px-3 pb-4 pt-1 text-xs leading-relaxed text-ink-secondary">{t('mewcat.empty')}</p>}
      {canReadResources && <button type="button" onClick={onOpen} aria-label={t('mewcat.system')}
        title={t(failed ? 'system.resourceLoadFailed' : stats ? 'system.title' : 'system.loading')}
        className="flex min-h-8 w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-edge px-2 py-2 text-[11px] tabular-nums text-ink-secondary hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
        {metrics.map(([label, value]) => <span key={label}>{label}-{value}</span>)}
      </button>}
    </div>
  </aside>
}
