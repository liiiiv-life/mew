// 서버가 도는 기계의 CPU·메모리·GPU 사용량과 온도, 그리고 프로세스별 점유를 보는 팝업 —
// 도구 줄의 계기판 아이콘으로 연다. 2초마다 다시 읽는다(CPU 사용률은 서버가 이 호출 간격을
// 구간으로 삼아 계산한다). 추이 그래프는 팝업이 열려 있는 동안 클라이언트가 모은 표본만 쓴다 —
// 서버는 링버퍼를 두지 않으므로 닫으면 이력도 사라진다.
import { useEffect, useMemo, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchSystemStats, type ProcStat, type SystemStats } from '../api/client'
import { useI18n } from '../i18n'

const POLL_MS = 2000
/** 표본 보관 개수 — 2분치 */
const HISTORY_MAX = 60

interface Sample {
  t: number
  stats: SystemStats
}

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1)
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`)
const temp = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}℃`)
const mb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)}GB` : `${v.toFixed(0)}MB`)

type Translate = ReturnType<typeof useI18n>['t']

function uptimeText(seconds: number, t: Translate) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return t('system.uptimeDaysHours', { days: d, hours: h })
  if (h > 0) return t('system.uptimeHoursMinutes', { hours: h, minutes: m })
  return t('system.uptimeMinutes', { minutes: m })
}

/** 사용률 막대 — 값이 없으면(null) 빈 막대만 그린다 */
function Bar({ value }: { value: number | null }) {
  const filled = Math.min(100, Math.max(0, value ?? 0))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-surface-hover">
      <div
        className={`h-full rounded transition-[width] duration-500 ${filled >= 90 ? 'bg-danger-strong' : 'bg-accent'}`}
        style={{ width: `${filled}%` }}
      />
    </div>
  )
}

function Row({ label, right, value }: { label: string; right: string; value: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-ink-secondary">{label}</span>
        <span className="shrink-0 tabular-nums text-ink">{right}</span>
      </div>
      <Bar value={value} />
    </div>
  )
}

interface Series {
  label: string
  /** 리터럴이어야 Tailwind가 클래스를 생성한다 — 동적 조합 금지 */
  stroke: string
  text: string
  points: (number | null)[]
  format: (v: number) => string
}

/**
 * 시간-점유율 꺾은선. x는 표본 순서(왼쪽이 과거), y는 0..max.
 * 표본이 두 개 미만이면 선이 안 그려진다 — 팝업을 연 직후 몇 초는 빈 판이다.
 */
function Chart({ series, max, span }: { series: Series[]; max: number; span: string }) {
  const n = Math.max(...series.map((s) => s.points.length), 0)
  const line = (points: (number | null)[]) =>
    n < 2
      ? ''
      : points
          .map((v, i) =>
            v === null
              ? null
              : `${(i / (n - 1)) * 100},${100 - Math.min(100, Math.max(0, (v / max) * 100))}`,
          )
          .filter((p): p is string => p !== null)
          .join(' ')

  return (
    <div>
      <div className="h-20 w-full overflow-hidden rounded bg-surface">
        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            className="stroke-edge-strong"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          {series.map((s) => (
            <polyline
              key={s.label}
              points={line(s.points)}
              fill="none"
              className={s.stroke}
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[11px]">
        {series.map((s) => {
          const last = [...s.points].reverse().find((v) => v !== null && v !== undefined)
          return (
            <span key={s.label} className={`${s.text} tabular-nums`}>
              {s.label} {last === undefined || last === null ? '—' : s.format(last)}
            </span>
          )
        })}
        <span className="ml-auto text-ink-faint">{span}</span>
      </div>
    </div>
  )
}

/** 축 상한 — 최댓값보다 살짝 위로 잡아 선이 천장에 붙지 않게 한다 */
const axisMax = (values: number[], floor: number) =>
  Math.max(floor, Math.ceil(Math.max(0, ...values) * 1.2) || floor)

const spanText = (history: Sample[], t: Translate) => {
  if (history.length < 2) return t('system.collectingSamples')
  const seconds = Math.round((history[history.length - 1].t - history[0].t) / 1000)
  return t('system.elapsedSeconds', { seconds })
}

type SortKey = 'cpu' | 'memMb' | 'gpuMemMb'

/** 프로세스 하나의 추이 — 목록에서 행을 누르면 위에 겹쳐 뜬다 */
function ProcessDetailModal({
  pid,
  history,
  onClose,
}: {
  pid: number
  history: Sample[]
  onClose: () => void
}) {
  const { t } = useI18n()
  useOverlayDismiss(onClose)

  const rows = history.map((s) => s.stats.processes.find((p) => p.pid === pid) ?? null)
  const latest = [...rows].reverse().find((p): p is ProcStat => p !== null)
  const cpuPoints = rows.map((p) => (p ? p.cpu : null))
  const memPoints = rows.map((p) => (p ? p.memMb : null))
  const gpuPoints = rows.map((p) => (p ? p.gpuMemMb : null))
  const hasGpu = gpuPoints.some((v) => v !== null && v > 0)
  const span = spanText(history, t)

  return (
    <div
      className="fixed inset-0 z-[1110] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-ink">
            {latest?.name ?? t('system.unknownProcess')}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">pid {pid}</span>
        </div>
        <div className="mb-3 break-all text-[11px] text-ink-faint">{latest?.cmd || '—'}</div>

        {rows[rows.length - 1] === null && (
          <div className="mb-3 text-[11px] text-warning">{t('system.processEnded')}</div>
        )}

        <div className="space-y-3">
          <Chart
            series={[
              {
                label: 'CPU',
                stroke: 'stroke-link',
                text: 'text-link',
                points: cpuPoints,
                format: (v) => `${v.toFixed(1)}%`,
              },
            ]}
            max={axisMax(cpuPoints.filter((v): v is number => v !== null), 100)}
            span={span}
          />
          <Chart
            series={[
              {
                label: t('system.memory'),
                stroke: 'stroke-success-ink',
                text: 'text-success-ink',
                points: memPoints,
                format: mb,
              },
              ...(hasGpu
                ? [
                    {
                      label: t('system.gpuMemory'),
                      stroke: 'stroke-warning-ink',
                      text: 'text-warning-ink',
                      points: gpuPoints,
                      format: mb,
                    },
                  ]
                : []),
            ]}
            max={axisMax(
              [...memPoints, ...(hasGpu ? gpuPoints : [])].filter((v): v is number => v !== null),
              64,
            )}
            span={span}
          />
        </div>
      </div>
    </div>
  )
}

export function SystemStatsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [history, setHistory] = useState<Sample[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('cpu')
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetchSystemStats()
        .then((s) => {
          if (cancelled) return
          setHistory((prev) => [...prev, { t: Date.now(), stats: s }].slice(-HISTORY_MAX))
          setError(null)
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : t('system.resourceLoadFailed'))
        })
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [t])

  useOverlayDismiss(onClose)

  const stats = history[history.length - 1]?.stats ?? null
  const memPct = stats ? (stats.memory.used / stats.memory.total) * 100 : null

  const rows = useMemo(() => {
    if (!stats) return []
    const q = query.trim().toLowerCase()
    const matched = q
      ? stats.processes.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.cmd.toLowerCase().includes(q) ||
            String(p.pid).includes(q),
        )
      : stats.processes
    return [...matched].sort((a, b) => b[sort] - a[sort])
  }, [stats, query, sort])

  const span = spanText(history, t)

  return (
    <>
      <div
        className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
        onMouseDown={onClose}
      >
        <div
          className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised p-4 shadow-xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{t('system.title')}</span>
            <span className="min-w-0 truncate text-[11px] text-ink-muted">
              {stats ? `${stats.hostname} · ${t('system.running', { uptime: uptimeText(stats.uptime, t) })}` : ''}
            </span>
          </div>

          {error ? (
            <div className="py-6 text-center text-xs text-danger-strong">{error}</div>
          ) : !stats ? (
            <div className="py-6 text-center text-xs text-ink-muted">{t('system.loading')}</div>
          ) : (
            <div className="space-y-4">
              <Chart
                series={[
                  {
                    label: 'CPU',
                    stroke: 'stroke-link',
                    text: 'text-link',
                    points: history.map((s) => s.stats.cpu.usage),
                    format: (v) => `${v.toFixed(0)}%`,
                  },
                  {
                    label: t('system.memory'),
                    stroke: 'stroke-success-ink',
                    text: 'text-success-ink',
                    points: history.map((s) => (s.stats.memory.used / s.stats.memory.total) * 100),
                    format: (v) => `${v.toFixed(0)}%`,
                  },
                  ...(stats.gpus.length > 0
                    ? [
                        {
                          label: 'GPU',
                          stroke: 'stroke-warning-ink',
                          text: 'text-warning-ink',
                          points: history.map((s) => s.stats.gpus[0]?.utilization ?? null),
                          format: (v: number) => `${v.toFixed(0)}%`,
                        },
                      ]
                    : []),
                ]}
                max={100}
                span={span}
              />

              <div className="space-y-1.5">
                <Row
                  label={t('system.cpuCores', { count: stats.cpu.cores })}
                  right={`${pct(stats.cpu.usage)} · ${temp(stats.cpu.temperature)}`}
                  value={stats.cpu.usage}
                />
                <div className="truncate text-[11px] text-ink-muted">{stats.cpu.model}</div>
                <div className="text-[11px] text-ink-faint">
                  {t('system.loadAverage', { value: stats.cpu.loadavg.map((l) => l.toFixed(2)).join(' · ') })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Row
                  label={t('system.memory')}
                  right={`${gb(stats.memory.used)} / ${gb(stats.memory.total)} GB`}
                  value={memPct}
                />
                <div className="text-[11px] text-ink-faint">{t('system.availableMemory', { value: gb(stats.memory.available) })}</div>
              </div>

              {stats.gpus.length === 0 ? (
                <div className="text-[11px] text-ink-faint">{t('system.noGpu')}</div>
              ) : (
                stats.gpus.map((g, i) => (
                  <div key={`${g.name}-${i}`} className="space-y-1.5">
                    <Row
                      label={g.name}
                      right={`${pct(g.utilization)} · ${temp(g.temperature)}`}
                      value={g.utilization}
                    />
                    {g.memoryTotalMb !== null && g.memoryUsedMb !== null && (
                      <Row
                        label={t('system.gpuMemory')}
                        right={`${g.memoryUsedMb} / ${g.memoryTotalMb} MB`}
                        value={(g.memoryUsedMb / g.memoryTotalMb) * 100}
                      />
                    )}
                  </div>
                ))
              )}

              {stats.cpu.temperature === null && (
                <div className="text-[11px] text-ink-faint">
                  {t('system.cpuTemperatureUnavailable')}
                </div>
              )}

              <ProcessTable
                rows={rows}
                total={stats.processes.length}
                query={query}
                onQuery={setQuery}
                sort={sort}
                onSort={setSort}
                onPick={setSelected}
              />
            </div>
          )}
        </div>
      </div>

      {selected !== null && (
        <ProcessDetailModal pid={selected} history={history} onClose={() => setSelected(null)} />
      )}
    </>
  )
}

/** 프로세스 목록 — 팝업이 길어지지 않도록 이 표만 따로 스크롤한다 */
function ProcessTable({
  rows,
  total,
  query,
  onQuery,
  sort,
  onSort,
  onPick,
}: {
  rows: ProcStat[]
  total: number
  query: string
  onQuery: (v: string) => void
  sort: SortKey
  onSort: (k: SortKey) => void
  onPick: (pid: number) => void
}) {
  const { t } = useI18n()
  const head = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={`w-14 shrink-0 text-right tabular-nums ${sort === key ? 'text-ink' : 'text-ink-faint hover:text-ink-secondary'}`}
    >
      {label}
      {sort === key ? ' ↓' : ''}
    </button>
  )

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-secondary">{t('system.processes')}</span>
        <span className="text-[11px] tabular-nums text-ink-faint">
          {rows.length}/{total}
        </span>
      </div>

      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('system.processSearch')}
        className="w-full rounded bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
      />

      <div className="flex gap-2 px-1 text-[11px] text-ink-faint">
        <span className="min-w-0 flex-1">{t('system.name')}</span>
        {head('cpu', 'CPU')}
        {head('memMb', 'RAM')}
        {head('gpuMemMb', 'GPU')}
      </div>

      {/* 여기만 스크롤한다 — 팝업 전체 높이는 프로세스 수와 무관하다 */}
      <div className="max-h-52 overflow-y-auto rounded bg-surface">
        {rows.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-ink-faint">{t('system.noMatchingProcesses')}</div>
        ) : (
          rows.map((p) => (
            <button
              key={p.pid}
              type="button"
              onClick={() => onPick(p.pid)}
              title={p.cmd || p.name}
              className="flex w-full gap-2 px-1 py-1 text-left text-[11px] hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1 truncate text-ink-secondary">
                {p.name} <span className="text-ink-faint">{p.pid}</span>
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-ink">
                {p.cpu.toFixed(1)}%
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-ink-secondary">
                {mb(p.memMb)}
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums text-ink-faint">
                {p.gpuMemMb > 0 ? mb(p.gpuMemMb) : '—'}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
