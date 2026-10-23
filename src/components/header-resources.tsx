import { useEffect, useId, useState } from 'react'
import { HoverTipLayer } from '@mew/ui'
import { fetchSystemStats, type SystemStats } from '../api/client'
import { useI18n } from '../i18n'
import { headerIconControlClassName } from './header-control'

const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`

export function HeaderResources({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n()
  const summaryId = useId()
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
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
  }, [])

  const gpuUsage = stats?.gpus.map(gpu => gpu.utilization).filter((value): value is number => value !== null && Number.isFinite(value)) ?? []
  const metrics = [
    { label: 'CPU', usage: stats?.cpu.usage },
    { label: 'RAM', usage: stats && stats.memory.total > 0 ? stats.memory.used / stats.memory.total * 100 : null },
    { label: 'GPU', usage: gpuUsage.length ? Math.max(...gpuUsage) : null },
  ]
  const summary = metrics.map(({ label, usage }) => `${label} ${percent(usage)}`).join(' · ')
  const tip = stats ? `${t('system.title')}\n${summary}` : t(failed ? 'system.resourceLoadFailed' : 'system.loading')

  return <HoverTipLayer className="contents" placement="bottom">
    <button type="button" aria-label={t('mewcat.system')} aria-describedby={summaryId} aria-haspopup="dialog" data-tip={tip} onClick={onOpen}
      className={headerIconControlClassName}>
      <span aria-hidden="true" className="flex h-5 w-6 items-stretch gap-0.5 text-[10px] leading-none">
      {metrics.map(({ label, usage }) => {
        const available = usage != null && Number.isFinite(usage)
        const fill = available ? Math.min(100, Math.max(0, usage)) : 0
        return <span className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-sm bg-ink/10" key={label}>
          <span>{label[0]}</span>
          <span className="absolute inset-0 flex items-center justify-center bg-ink-secondary text-surface" style={{ clipPath: `inset(${100 - fill}% 0 0)` }}>
            {label[0]}
          </span>
        </span>
      })}
      </span>
    </button>
    <span id={summaryId} className="sr-only">{summary}</span>
  </HoverTipLayer>
}
