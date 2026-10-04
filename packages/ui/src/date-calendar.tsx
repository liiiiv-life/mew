import { useRef, useState, type KeyboardEvent } from 'react'
import { NavArrowLeft, NavArrowRight, Trash } from 'iconoir-react'
import { useUiLocale } from './i18n'
import { uiText, uiWeekdays } from './i18n-core'
import { dateFromValue, dateValue, localToday, shiftDate, validDateValue } from './date-value'
import './date-calendar.css'

export function DateCalendar({ start, end, readOnly, onChange, single = false }: {
  start?: string | null; end?: string | null; readOnly: boolean; single?: boolean
  onChange: (start: string | null, end: string | null) => void
}) {
  const locale = useUiLocale(), today = localToday(), initial = (start && validDateValue(start) ? start : null) || (end && validDateValue(end) ? end : null) || today
  const [month, setMonth] = useState(initial.slice(0, 7)), [active, setActive] = useState(initial)
  const [pending, setPending] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const choose = (day: string) => {
    if (readOnly) return
    if (single) { onChange(day, null); return }
    if (!pending || day < pending) { setPending(day); onChange(day, null) }
    else { onChange(pending, day); setPending(null) }
  }
  const navigate = (next: string, focus = false) => {
    if (!validDateValue(next)) return
    setActive(next); setMonth(next.slice(0, 7))
    if (focus) requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus())
  }
  const moveMonth = (step: number, focus = false) => {
    const date = dateFromValue(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + step)
    const next = dateValue(date).slice(0, 7)
    if (!validDateValue(`${next}-01`)) return
    const last = new Date(date); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0)
    navigate(`${next}-${String(Math.min(dateFromValue(active).getUTCDate(), last.getUTCDate())).padStart(2, '0')}`, focus)
  }
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); event.stopPropagation(); moveMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1), true); return
    }
    const weekday = dateFromValue(day).getUTCDay()
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key] ?? (event.key === 'Home' ? -weekday : event.key === 'End' ? 6 - weekday : null)
    if (step !== null) { event.preventDefault(); event.stopPropagation(); navigate(shiftDate(day, step), true) }
  }
  const first = shiftDate(`${month}-01`, -dateFromValue(`${month}-01`).getUTCDay())
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' })
  const monthDate = dateFromValue(`${month}-01`)
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(monthDate)
  const monthParts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: locale.startsWith('en') ? 'numeric' : 'long', timeZone: 'UTC' }).formatToParts(monthDate)
  return <div className="task-range-calendar">
    <header className="task-range-header">
      <div className="task-range-month" key={`${locale}-${month}`}>{monthParts.map((part, position) => {
        if (part.type !== 'year' && part.type !== 'month') return <span key={position} aria-hidden="true">{part.value}</span>
        const index = part.type === 'year' ? 0 : 1
        return <span key={position} className="task-range-heading-part"><input className={`task-range-${part.type}-input`} aria-label={uiText(index === 0 ? '연도' : '월')} inputMode="numeric" maxLength={index === 0 ? 4 : 2} defaultValue={month.split('-')[index]} onFocus={event => event.currentTarget.select()} onBlur={event => {
          const value = event.currentTarget.value.trim(), number = Number(value)
          if (/^\d+$/.test(value) && number >= 1 && number <= (index === 0 ? 9999 : 12)) {
            const parts = month.split('-'); parts[index] = String(number).padStart(index === 0 ? 4 : 2, '0'); navigate(`${parts.join('-')}-01`)
          } else event.currentTarget.value = month.split('-')[index]
        }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.value = month.split('-')[index]; event.currentTarget.blur() }
        }} />{index === 1 && /^\d+/.test(part.value) && <span aria-hidden="true">{part.value.replace(/^\d+/, '')}</span>}</span>})}</div>
      <button type="button" className="task-tool" aria-label={uiText('이전 달')} data-tip={uiText('이전 달')} disabled={month === '0001-01'} onClick={() => moveMonth(-1)}><NavArrowLeft width={16} height={16} aria-hidden="true" /></button>
      <button type="button" className="task-tool" aria-label={uiText('다음 달')} data-tip={uiText('다음 달')} disabled={month === '9999-12'} onClick={() => moveMonth(1)}><NavArrowRight width={16} height={16} aria-hidden="true" /></button>
    </header>
    {!single && <div className="task-range-summary"><span data-active={!readOnly && !pending || undefined}>{uiText('시작일')} <b>{start || '—'}</b></span><span data-active={!readOnly && !!pending || undefined}>{uiText('종료일')} <b>{end || '—'}</b></span></div>}
    <div ref={grid} role="grid" aria-label={monthLabel}>
      <div role="row" className="task-range-week">{uiWeekdays().map((day, index) => <span role="columnheader" key={index}>{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div role="row" className="task-range-week" key={week}>{Array.from({ length: 7 }, (_, index) => {
        const day = shiftDate(first, week * 7 + index), selected = day === start || day === end, inRange = !!start && !!end && day > start && day < end, period = !!start && !!end && start < end && day >= start && day <= end
        return <div key={day} role="gridcell" aria-selected={selected || inRange}><button type="button" data-date={day} data-start={day === start || undefined} data-end={day === end || undefined} data-period={period || undefined} data-selected={selected || undefined} data-range={inRange || undefined} data-outside={day.slice(0, 7) !== month || undefined} aria-label={fullDate.format(dateFromValue(day))} aria-current={day === today ? 'date' : undefined} aria-disabled={readOnly || undefined} disabled={!validDateValue(day)} tabIndex={day === active ? 0 : -1} onFocus={() => setActive(day)} onKeyDown={event => keyDown(event, day)} onClick={() => choose(day)}><span className="task-range-day-number">{dateFromValue(day).getUTCDate()}</span></button></div>
      })}</div>)}
    </div>
    <footer className="task-range-footer"><button type="button" className="task-tool" onClick={() => navigate(today)}>{uiText('오늘')}</button><button type="button" className="task-tool" aria-label={uiText(single ? '날짜 지우기' : '일정 지우기')} data-tip={uiText(single ? '날짜 지우기' : '일정 지우기')} disabled={readOnly || (!start && !end)} onClick={() => { setPending(null); onChange(null, null) }}><Trash width={16} height={16} aria-hidden="true" /></button></footer>
  </div>
}
