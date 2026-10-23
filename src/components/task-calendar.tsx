import { taskRollups, taskWithRollup } from '../../shared/task-rollup'
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { NavArrowLeft, NavArrowRight } from 'iconoir-react'
import { useUiLocale } from '@mew/ui/i18n'
import { uiText, uiWeekdays } from '@mew/ui/i18n-core'
import { dateFromValue, dateValue, localToday, shiftDate, validDateValue } from '@mew/ui/date-value'
import { tasksOnDate, taskStatus } from '../utils/task-schedule'
import type { TaskItem } from '../../shared/task-list'

export function TaskCalendar({ tasks, selected, month, onSelect, onMonth, children }: {
  tasks: TaskItem[]; selected: string; month: string
  onSelect: (day: string) => void; onMonth: (month: string) => void; children: ReactNode
}) {
  const locale = useUiLocale(), today = localToday(), buttons = useRef(new Map<string, HTMLButtonElement>())
  const rollups = taskRollups(tasks)
  const first = dateFromValue(`${month}-01`), start = shiftDate(dateValue(first), -first.getUTCDay())
  const days = Array.from({ length: 42 }, (_, index) => shiftDate(start, index))
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' })
  const shiftMonth = (offset: number) => {
    const next = dateFromValue(`${month}-01`); next.setUTCMonth(next.getUTCMonth() + offset)
    const value = dateValue(next)
    if (validDateValue(value)) onMonth(value.slice(0, 7))
  }
  const choose = (day: string) => { onSelect(day); onMonth(day.slice(0, 7)) }
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    let next: string | undefined
    const weekday = dateFromValue(day).getUTCDay()
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday }[event.key]
    if (delta !== undefined) next = shiftDate(day, delta)
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const date = dateFromValue(day), originalDay = date.getUTCDate()
      date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + (event.key === 'PageUp' ? -1 : 1))
      const nextMonth = date.getUTCMonth(); date.setUTCDate(originalDay)
      if (date.getUTCMonth() !== nextMonth) date.setUTCDate(0)
      next = dateValue(date)
    }
    if (!next || !validDateValue(next)) return
    event.preventDefault(); choose(next)
    requestAnimationFrame(() => buttons.current.get(next)?.focus())
  }
  return <div className="task-calendar">
    <div className="task-calendar-nav">
      <strong aria-live="polite">{new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(first)}</strong>
      <button type="button" className="task-tool task-today" onClick={() => choose(today)}>{uiText('오늘')}</button>
      <button type="button" className="task-tool" aria-label={uiText('이전 달')} data-tip={uiText('이전 달')} disabled={month === '0001-01'} onClick={() => shiftMonth(-1)}><NavArrowLeft width={16} height={16} aria-hidden="true" /></button>
      <button type="button" className="task-tool" aria-label={uiText('다음 달')} data-tip={uiText('다음 달')} disabled={month === '9999-12'} onClick={() => shiftMonth(1)}><NavArrowRight width={16} height={16} aria-hidden="true" /></button>
    </div>
    <div role="grid" aria-label={uiText('태스크 달력')} className="task-calendar-grid">
      <div role="row" className="task-calendar-week">{uiWeekdays().map(day => <span key={day} role="columnheader">{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div role="row" className="task-calendar-week" key={week}>
        {days.slice(week * 7, week * 7 + 7).map(day => {
          const events = tasksOnDate(tasks, day), statuses = [...new Set(events.map(task => taskStatus(taskWithRollup(task, rollups), today)))], valid = validDateValue(day)
          return <div role="gridcell" aria-selected={day === selected} key={day}>
            <button ref={element => { if (element) buttons.current.set(day, element); else buttons.current.delete(day) }}
              type="button" className="task-calendar-day" data-date={day} data-outside={day.slice(0, 7) !== month || undefined}
              data-selected={day === selected || undefined} aria-current={day === today ? 'date' : undefined}
              aria-label={valid ? `${fullDate.format(dateFromValue(day))} · ${uiText('{p0}개 일정', { p0: events.length })}` : undefined}
              tabIndex={day === selected || (!selected.startsWith(month) && day === `${month}-01`) ? 0 : -1}
              disabled={!valid} onClick={() => choose(day)} onKeyDown={event => keyDown(event, day)}>
              <span className="task-calendar-number">{dateFromValue(day).getUTCDate()}</span>
              <span className="task-calendar-dots" aria-hidden="true">{statuses.map(status => <i key={status} data-status={status} />)}{events.length > 0 && <small>{events.length}</small>}</span>
            </button>
          </div>
        })}
      </div>)}
    </div>
    <div className="task-calendar-agenda">
      <div className="task-agenda-heading"><strong>{fullDate.format(dateFromValue(selected))}</strong><span>{uiText('{p0}개 일정', { p0: tasksOnDate(tasks, selected).length })}</span></div>
      {children}
    </div>
  </div>
}
