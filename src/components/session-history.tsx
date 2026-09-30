import { useEffect, useMemo, useState } from 'react'
import { SelectField } from '@mew/ui'
import { normalizeSessionHistoryFilter, type MewSessionHistory } from '../../shared/active-sessions'
import { downloadSessionHistory, fetchSessionHistory, sessionHistoryBounds, type SessionHistoryFilter } from '../api/session-history'
import { useI18n } from '../i18n'

function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const hour = (value: number) => `${String(value).padStart(2, '0')}:00`
const control = 'flex h-8 items-center justify-center gap-1 rounded px-2 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 pointer-coarse:min-h-11'
const PAGE_SIZE = 50

export function SessionHistory() {
  const { t, formatDate } = useI18n()
  const [filter, updateFilter] = useState<SessionHistoryFilter>(() => ({ day: localDay(), fromHour: 0, toHour: 24, person: '' }))
  const setFilter = (update: (previous: SessionHistoryFilter) => SessionHistoryFilter) => updateFilter(previous => normalizeSessionHistoryFilter(update(previous)))
  const [history, setHistory] = useState<MewSessionHistory | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [exportError, setExportError] = useState(false)
  const [revision, setRevision] = useState(0), [exporting, setExporting] = useState(false), [page, setPage] = useState(0)
  const bounds = useMemo(() => sessionHistoryBounds(filter), [filter])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(false); setExportError(false); setPage(0); setHistory(null)
    fetchSessionHistory(filter, controller.signal).then(value => {
      if (!controller.signal.aborted) { setHistory(value); setLoading(false) }
    }).catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false) } })
    return () => controller.abort()
  }, [filter, revision])
  useEffect(() => {
    if (filter.day !== localDay()) return
    const timer = setInterval(() => setRevision(value => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [filter.day])
  const groups = useMemo(() => {
    const people = new Map<string, { name: string; email: string | null; sessions: Map<string, NonNullable<typeof history>['records']> }>()
    for (const record of history?.records ?? []) {
      const key = record.email ?? 'guest'
      let person = people.get(key)
      if (!person) { person = { name: record.displayName ?? t('sessions.guest'), email: record.email, sessions: new Map() }; people.set(key, person) }
      const records = person.sessions.get(record.id) ?? []
      const last = records.at(-1)
      if (last && last.visible === record.visible && last.endedAt === record.startedAt) last.endedAt = record.endedAt
      else records.push({ ...record })
      person.sessions.set(record.id, records)
    }
    return [...people.values()]
  }, [history, t])
  const hourly = useMemo(() => Array.from({ length: 24 }, (_, index) => {
    const range = sessionHistoryBounds({ ...filter, fromHour: index, toHour: index + 1 })
    return new Set(history?.records.filter(record => record.startedAt < range.to && record.endedAt > range.from).map(record => record.id)).size
  }), [filter, history])
  const maxHourly = Math.max(1, ...hourly)
  const records = history?.records ?? []
  const sessions = new Set(records.map(record => record.id)).size
  const observed = records.reduce((sum, record) => sum + record.endedAt - record.startedAt, 0)
  const duration = (milliseconds: number) => t('sessions.history.duration', { hours: Math.floor(milliseconds / 3600_000), minutes: Math.floor(milliseconds / 60_000) % 60 })
  const time = (value: number) => formatDate(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const moveDay = (step: number) => {
    const date = new Date(bounds.dayFrom); date.setDate(date.getDate() + step)
    setFilter(value => ({ ...value, day: localDay(date) }))
  }
  const exportFile = async () => {
    setExporting(true); setExportError(false)
    try { await downloadSessionHistory(filter) } catch { setExportError(true) } finally { setExporting(false) }
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 border-b border-edge px-4 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0">
          <label htmlFor="session-history-day" className="mb-1 block text-xs text-ink-secondary">{t('sessions.history.day')}</label>
          <div className="flex items-center gap-1">
            <button type="button" aria-label={t('sessions.history.previousDay')} className={control} onClick={() => moveDay(-1)}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m14 6-6 6 6 6"/></svg></button>
            <input id="session-history-day" type="date" value={filter.day} max={localDay()} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setFilter(value => ({ ...value, day: event.target.value })) }} className="h-8 min-w-0 rounded border border-edge-strong bg-surface px-2 text-xs text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11" />
            <button type="button" aria-label={t('sessions.history.nextDay')} className={control} disabled={filter.day >= localDay()} onClick={() => moveDay(1)}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m10 6 6 6-6 6"/></svg></button>
          </div>
        </div>
        <div className="min-w-36 flex-1">
          <span className="mb-1 block text-xs text-ink-secondary">{t('sessions.history.person')}</span>
          <SelectField compact label={t('sessions.history.person')} value={filter.person} onChange={person => setFilter(value => ({ ...value, person }))}
            options={[{ value: '', label: t('sessions.history.allPeople') }, ...(history?.people ?? []).map(person => ({ value: person.email ?? 'guest', label: person.email ? `${person.displayName ?? person.email} · ${person.email}` : t('sessions.guest') })), ...(filter.person && !history?.people.some(person => (person.email ?? 'guest') === filter.person) ? [{ value: filter.person, label: filter.person }] : [])]} />
        </div>
        <div className="w-24">
          <span className="mb-1 block text-xs text-ink-secondary">{t('sessions.history.from')}</span>
          <SelectField compact label={t('sessions.history.from')} value={String(filter.fromHour)} options={Array.from({ length: 24 }, (_, index) => ({ value: String(index), label: hour(index) }))}
            onChange={value => setFilter(current => ({ ...current, fromHour: Number(value), toHour: Math.max(current.toHour, Number(value) + 1) }))} />
        </div>
        <div className="w-24">
          <span className="mb-1 block text-xs text-ink-secondary">{t('sessions.history.to')}</span>
          <SelectField compact label={t('sessions.history.to')} value={String(filter.toHour)} options={Array.from({ length: 24 }, (_, index) => ({ value: String(index + 1), label: hour(index + 1) }))}
            onChange={value => setFilter(current => ({ ...current, fromHour: Math.min(current.fromHour, Number(value) - 1), toHour: Number(value) }))} />
        </div>
        <button type="button" className={control} disabled={loading || exporting || !records.length || error} onClick={() => { void exportFile() }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg>
          {t(exporting ? 'sessions.history.exporting' : 'sessions.history.export')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
        <span>{timezone}</span>
        <button type="button" className={control} disabled={loading} onClick={() => setRevision(value => value + 1)}>{t('sessions.history.refresh')}</button>
      </div>
      {exportError && <p role="alert" className="mt-2 text-xs text-danger">{t('sessions.history.exportError')}</p>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-busy={loading}>
      {loading ? <div role="status" className="py-6 text-center text-sm text-ink-secondary">{t('sessions.history.loading')}</div>
        : error ? <div role="alert" className="py-6 text-center text-sm text-ink-secondary"><p>{t('sessions.history.error')}</p><button type="button" className={`${control} mx-auto mt-2`} onClick={() => setRevision(value => value + 1)}>{t('sessions.history.refresh')}</button></div>
          : history && <>
            <p className="mb-3 text-sm font-medium tabular-nums text-ink">{t('sessions.history.summary', { sessions, people: groups.length, duration: duration(observed) })}</p>
            <section aria-label={t('sessions.history.hourly')} className="mb-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-ink">{t('sessions.history.hourly')}</h3>
                {(filter.fromHour !== 0 || filter.toHour !== 24) && <button type="button" className={control} onClick={() => setFilter(value => ({ ...value, fromHour: 0, toHour: 24 }))}>{t('sessions.history.allDay')}</button>}
              </div>
              <div className="flex h-20 items-end gap-0.5 border-b border-edge" role="group" aria-label={t('sessions.history.hourly')}>
                {hourly.map((count, index) => <button type="button" key={index} aria-label={t('sessions.history.hourCount', { hour: hour(index), count })} title={t('sessions.history.hourCount', { hour: hour(index), count })}
                  aria-pressed={filter.fromHour === index && filter.toHour === index + 1}
                  className="group relative flex h-full min-w-0 flex-1 items-end rounded-t focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setFilter(value => ({ ...value, fromHour: index, toHour: index + 1 }))}>
                  <span className={`block w-full rounded-t ${count ? 'bg-accent/65 group-hover:bg-accent' : 'bg-surface-hover'}`} style={{ height: count ? `${Math.max(6, count / maxHourly * 100)}%` : '2px' }} />
                </button>)}
              </div>
              <div aria-hidden="true" className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-secondary"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
            </section>
            {!records.length ? <div className="py-6 text-center text-sm text-ink-secondary"><p>{t('sessions.history.empty')}</p><p className="mt-2 text-xs">{t('sessions.history.recordedSince', { date: formatDate(history.recordedSince, { dateStyle: 'medium' }) })}</p></div>
              : <>
                <section aria-label={t('sessions.history.timeline')}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <h3 className="font-medium text-ink">{t('sessions.history.timeline')}</h3>
                    <span className="flex items-center gap-3 text-ink-secondary"><span className="flex items-center gap-1"><i aria-hidden="true" className="h-2 w-2 rounded-sm bg-accent"/>{t('sessions.history.foreground')}</span><span className="flex items-center gap-1"><i aria-hidden="true" className="h-2 w-2 rounded-sm bg-ink-secondary/35"/>{t('sessions.background')}</span></span>
                  </div>
                  {groups.map(person => <div key={person.email ?? 'guest'} className="mb-4">
                    <div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs"><h4 className="font-medium text-ink">{person.name}</h4><span className="min-w-0 break-all text-ink-secondary">{person.email}</span><span className="ml-auto tabular-nums text-ink-secondary">{t('sessions.history.connectionCount', { count: person.sessions.size })}</span></div>
                    {[...person.sessions.values()].slice(0, 100).map(intervals => <div key={intervals[0].id} className="flex items-center gap-2 py-0.5">
                      <span className="w-20 shrink-0 text-[10px] text-ink-secondary"><span className="block truncate" title={[intervals[0].browser, intervals[0].device].filter(Boolean).join(' · ')}>{intervals[0].device ?? intervals[0].browser ?? t('sessions.browser')}</span><span className="block tabular-nums">{time(intervals[0].startedAt)}–{time(intervals.at(-1)!.endedAt)}</span></span>
                      <div className="relative h-5 min-w-0 flex-1 rounded-sm bg-surface-raised" aria-label={`${person.name} ${time(intervals[0].startedAt)}–${time(intervals.at(-1)!.endedAt)}`}>
                        {intervals.map(record => <span key={record.recordId} title={`${time(record.startedAt)}–${time(record.endedAt)} · ${record.visible ? t('sessions.history.foreground') : t('sessions.background')}`}
                          className={`absolute top-1 h-3 min-w-px rounded-sm ${record.visible ? 'bg-accent' : 'bg-ink-secondary/35'}`}
                          style={{ left: `${(record.startedAt - bounds.dayFrom) / (bounds.dayTo - bounds.dayFrom) * 100}%`, width: `${(record.endedAt - record.startedAt) / (bounds.dayTo - bounds.dayFrom) * 100}%` }} />)}
                      </div>
                    </div>)}
                    <div aria-hidden="true" className="ml-22 mt-1 flex justify-between text-[10px] tabular-nums text-ink-secondary"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
                    {person.sessions.size > 100 && <p className="mt-1 text-xs text-ink-secondary">{t('sessions.history.timelineLimit')}</p>}
                  </div>)}
                </section>
                <details className="mt-4 border-t border-edge pt-3">
                  <summary className="cursor-pointer text-xs font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent">{t('sessions.history.details', { count: records.length })}</summary>
                  <ul className="mt-2 divide-y divide-edge">{records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(record => <li key={record.recordId} className="py-2 text-xs">
                    <div className="flex flex-wrap gap-x-2 gap-y-1"><span className="font-medium text-ink">{record.displayName ?? t('sessions.guest')}</span><span className="text-ink-secondary">{[record.browser, record.device].filter(Boolean).join(' · ')}</span><span className="ml-auto tabular-nums text-ink">{time(record.startedAt)}–{time(record.endedAt)}</span></div>
                    <p className="mt-1 break-all text-ink-secondary">{[record.workspaceLabel, record.path].filter(Boolean).join(' · ') || t('sessions.noFile')}</p>
                    <p className="mt-1 text-ink-secondary">{record.visible ? t('sessions.history.foreground') : t('sessions.background')} · {duration(record.endedAt - record.startedAt)} · {t('sessions.runningAgents', { count: record.agents?.running ?? '—' })}</p>
                  </li>)}</ul>
                  {records.length > PAGE_SIZE && <div className="mt-2 flex items-center justify-end gap-2 text-xs text-ink-secondary"><button type="button" className={control} disabled={!page} onClick={() => setPage(value => value - 1)}>{t('sessions.history.previous')}</button><span>{page + 1} / {Math.ceil(records.length / PAGE_SIZE)}</span><button type="button" className={control} disabled={(page + 1) * PAGE_SIZE >= records.length} onClick={() => setPage(value => value + 1)}>{t('sessions.history.next')}</button></div>}
                </details>
              </>}
          </>}
    </div>
  </div>
}
