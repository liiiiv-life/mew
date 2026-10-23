import { useMemo, useState } from 'react'
import { uiText, uiWeekdays } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import type { DbColumn, DbRow, DbView } from '../types'
import { calendarDates, databaseDateRange, databaseRowTitle, groupCalendarRows, localToday, shiftCalendarMonth } from './databaseLayout'
import { DatabaseLayoutIcon } from './DatabaseLayoutIcon'

export function DatabaseCalendar({ view, rows, column, startColumn, editable, busy, onOpen, onCreate }: {
  view: DbView; rows: DbRow[]; column: DbColumn; startColumn?: DbColumn; editable: boolean; busy: boolean; onOpen: (row: DbRow) => void; onCreate: (cells: Record<string, unknown>) => void
}) {
  const locale = useUiLocale(), today = localToday()
  const [month, setMonth] = useState(today.slice(0, 7)), [selectedDay, setSelectedDay] = useState<string | null>(today)
  const days = useMemo(() => calendarDates(month), [month])
  const grouped = useMemo(() => groupCalendarRows(rows, days, column.id, startColumn?.id), [rows, days, column.id, startColumn?.id])
  const createOnDay = (day: string) => onCreate({ [column.id]: day, ...(startColumn ? { [startColumn.id]: day } : {}) })
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))
  const dayLabel = (key: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`))
  const changeMonth = (next: string) => { setMonth(next); setSelectedDay(next === today.slice(0, 7) ? today : `${next}-01`) }
  const event = (row: DbRow, fullTitle = false) => {
    const range = databaseDateRange(row, column.id, startColumn?.id)
    return <button type="button" key={row.id} onClick={() => onOpen(row)} title={databaseRowTitle(row, view.columns)} aria-label={uiText('항목 열기: {p0}', { p0: databaseRowTitle(row, view.columns) })}
      className={`block w-full rounded bg-accent/10 px-1.5 py-1 text-left text-[11px] leading-snug text-ink transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent sm:text-xs ${fullTitle ? 'whitespace-normal break-words' : 'truncate'}`}>
      {databaseRowTitle(row, view.columns) || uiText('제목 없음')}
      {fullTitle && range && range.start !== range.end && <span className="mt-0.5 block text-[10px] tabular-nums text-ink-secondary">{range.start} – {range.end}</span>}
    </button>
  }
  const iconButton = 'flex h-8 w-8 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent'
  return <section aria-label={uiText('캘린더')}>
    <header className="flex items-center gap-1 px-3 py-2">
      <h3 aria-live="polite" className="min-w-0 flex-1 text-sm font-semibold text-ink">{monthLabel}</h3>
      <button type="button" className="rounded px-2 py-1.5 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent" onClick={() => changeMonth(today.slice(0, 7))}>{uiText('오늘')}</button>
      <button type="button" aria-label={uiText('이전 달')} data-tip={uiText('이전 달')} className={iconButton} onClick={() => changeMonth(shiftCalendarMonth(month, -1))}><DatabaseLayoutIcon kind="left" size={14} /></button>
      <button type="button" aria-label={uiText('다음 달')} data-tip={uiText('다음 달')} className={iconButton} onClick={() => changeMonth(shiftCalendarMonth(month, 1))}><DatabaseLayoutIcon kind="right" size={14} /></button>
    </header>
    <div className="grid grid-cols-7 bg-surface-raised/20">{uiWeekdays().map((name, index) => <span key={index} className="px-1 py-2 text-center text-[10px] font-medium text-ink-muted sm:text-xs">{name}</span>)}</div>
    <div className="grid grid-cols-7">{days.map(key => {
      const events = grouped.get(key) ?? [], isToday = key === today
      return <section key={key} data-db-day={key} aria-label={dayLabel(key)} className={`group/day min-h-[80px] min-w-0 rounded p-1 sm:min-h-[112px] sm:p-1.5 ${key.slice(0, 7) !== month ? 'bg-surface-raised/10 text-ink-muted' : 'text-ink-secondary'} ${selectedDay === key ? 'bg-accent/5' : ''}`}>
        <div className="mb-1 flex items-center justify-between gap-0.5">
          <button type="button" aria-label={dayLabel(key)} aria-pressed={selectedDay === key} onClick={() => setSelectedDay(selectedDay === key ? null : key)} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums focus-visible:outline-2 focus-visible:outline-accent ${isToday ? 'bg-accent text-ink-on-accent font-semibold' : 'hover:bg-surface-hover'}`}>{Number(key.slice(-2))}</button>
          {editable && <button type="button" disabled={busy} aria-label={uiText('{p0}에 행 추가', { p0: key })} data-tip={uiText('행 추가')} onClick={() => createOnDay(key)} className="hidden h-6 w-6 items-center justify-center rounded text-ink-muted opacity-0 hover:bg-surface-hover hover:text-ink focus-visible:opacity-100 group-hover/day:opacity-100 sm:flex pointer-coarse:opacity-100"><DatabaseLayoutIcon kind="plus" size={12} /></button>}
        </div>
        <div className="flex min-w-0 flex-col gap-1">{events.slice(0, 3).map(row => event(row))}{events.length > 3 && <button type="button" className="rounded px-1 py-1 text-left text-[10px] text-ink-muted hover:bg-surface-hover" onClick={() => setSelectedDay(key)}>{uiText('{count}개 더 보기', { count: events.length - 3 })}</button>}</div>
      </section>
    })}</div>
    {selectedDay && <section data-db-agenda className="px-3 py-3" aria-label={dayLabel(selectedDay)}>
      <header className="mb-2 flex items-center justify-between gap-2"><h4 className="text-xs font-medium text-ink">{dayLabel(selectedDay)}</h4>{editable && <button type="button" disabled={busy} onClick={() => createOnDay(selectedDay)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover"><DatabaseLayoutIcon kind="plus" size={13} />{uiText('행 추가')}</button>}</header>
      <div className="flex flex-col gap-1.5">{(grouped.get(selectedDay) ?? []).map(row => event(row, true))}{!grouped.get(selectedDay)?.length && <p className="text-xs text-ink-muted">{uiText('일정 없음')}</p>}</div>
    </section>}
    {!!grouped.get('')?.length && <section className="px-3 py-3" aria-label={uiText('날짜 없음')}>
      <h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-ink-muted">{uiText('날짜 없음')}<span className="tabular-nums">{grouped.get('')!.length}</span></h4>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{grouped.get('')!.map(row => event(row, true))}</div>
    </section>}
  </section>
}
