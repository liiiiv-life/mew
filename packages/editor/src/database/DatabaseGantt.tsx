import { useRef, useState, type PointerEvent } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import type { DbColumn, DbRow, DbView } from '../types'
import { databaseDateRange, databaseRowTitle, localToday, shiftCalendarMonth } from './databaseLayout'
import { DatabaseLayoutIcon } from './DatabaseLayoutIcon'

const DAY = 86400000
const dayNumber = (date: string) => Date.parse(`${date}T12:00:00Z`) / DAY
const dayKey = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)
type Range = { start: string; end: string }
type Gesture = { row: DbRow; mode: 'move' | 'start' | 'end' | 'draw'; x: number; range: Range; next: Range; moved: boolean }

export function DatabaseGantt({ view, rows, column, startColumn, editable, onOpen, onMove }: {
  view: DbView; rows: DbRow[]; column: DbColumn; startColumn?: DbColumn; editable: boolean
  onOpen: (row: DbRow) => void; onMove: (row: DbRow, column: DbColumn, value: unknown) => void
}) {
  const locale = useUiLocale(), today = localToday()
  const [month, setMonth] = useState(today.slice(0, 7)), [scale, setScale] = useState(24), [fit, setFit] = useState(false)
  const [preview, setPreview] = useState<{ id: string; range: Range } | null>(null)
  const gesture = useRef<Gesture | null>(null), suppressClick = useRef(false)
  const ranges = rows.flatMap(row => { const range = databaseDateRange(row, column.id, startColumn?.id); return range ? [range] : [] })
  const start = fit && ranges.length ? Math.min(...ranges.map(range => dayNumber(range.start))) : dayNumber(`${month}-01`)
  const end = fit && ranges.length ? Math.max(...ranges.map(range => dayNumber(range.end))) : dayNumber(`${shiftCalendarMonth(month, 1)}-01`) - 1
  const days = end - start + 1, ppd = fit ? Math.max(.0001, Math.min(scale, 900 / days)) : scale, width = Math.max(1, days * ppd)
  const stride = Math.max(1, Math.ceil(52 / ppd)), ticks = Array.from({ length: Math.ceil(days / stride) }, (_, index) => start + index * stride)
  const label = (day: number) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day * DAY))
  const save = (row: DbRow, range: Range) => {
    if (!editable) return
    if (startColumn) onMove(row, startColumn, range.start)
    onMove(row, column, range.end)
  }
  const begin = (event: PointerEvent<HTMLElement>, row: DbRow, mode: Gesture['mode']) => {
    if (!editable || event.button !== 0 || fit) return
    if (!startColumn && mode !== 'move' && mode !== 'draw') return
    event.preventDefault(); event.stopPropagation()
    const existing = databaseDateRange(row, column.id, startColumn?.id)
    const day = Math.max(start, Math.min(end, start + Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / ppd)))
    const range = existing ?? { start: dayKey(day), end: dayKey(day) }
    suppressClick.current = false
    gesture.current = { row, mode, x: event.clientX, range, next: range, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    const active = gesture.current
    if (!active) return
    const delta = Math.round((event.clientX - active.x) / ppd), a = dayNumber(active.range.start), b = dayNumber(active.range.end)
    active.moved ||= Math.abs(event.clientX - active.x) > 3
    let first = a, last = b
    if (active.mode === 'move') { first += delta; last += delta }
    if (active.mode === 'start') first = Math.min(b, a + delta)
    if (active.mode === 'end') last = Math.max(a, b + delta)
    if (active.mode === 'draw') { first = startColumn ? Math.min(a, a + delta) : a + delta; last = Math.max(first, a + delta) }
    first = Math.max(dayNumber('0001-01-01'), Math.min(dayNumber('9999-12-31'), first))
    last = Math.max(first, Math.min(dayNumber('9999-12-31'), last))
    active.next = { start: dayKey(first), end: dayKey(last) }
    setPreview({ id: active.row.id, range: active.next })
  }
  const cancel = () => { gesture.current = null; setPreview(null) }
  const finish = () => {
    const active = gesture.current
    if (active && (active.moved || active.mode === 'draw')) { save(active.row, active.next); suppressClick.current = true }
    cancel()
  }
  const button = 'flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'
  return <section aria-label={uiText('간트')}>
    <header className="flex flex-wrap items-center gap-1 px-2 py-1">
      <span aria-live="polite" className="min-w-0 flex-1 truncate text-xs tabular-nums text-ink-secondary">{dayKey(start)} – {dayKey(end)}</span>
      <button type="button" className={button} aria-label={uiText('이전 달')} data-tip={uiText('이전 달')} onClick={() => { setFit(false); setMonth(shiftCalendarMonth(month, -1)) }}><DatabaseLayoutIcon kind="left" size={14} /></button>
      <button type="button" className="h-8 rounded px-2 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent" onClick={() => { setFit(false); setMonth(today.slice(0, 7)) }}>{uiText('오늘')}</button>
      <button type="button" className={button} aria-label={uiText('다음 달')} data-tip={uiText('다음 달')} onClick={() => { setFit(false); setMonth(shiftCalendarMonth(month, 1)) }}><DatabaseLayoutIcon kind="right" size={14} /></button>
      <button type="button" aria-pressed={fit} className="h-8 rounded px-2 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setFit(!fit)}>{uiText('전체')}</button>
      <button type="button" className={button} disabled={scale <= 8} aria-label={uiText('축소')} data-tip={uiText('축소')} onClick={() => { setFit(false); setScale(Math.max(8, scale / 1.5)) }}><DatabaseLayoutIcon kind="minus" size={14} /></button>
      <button type="button" className={button} disabled={scale >= 64} aria-label={uiText('확대')} data-tip={uiText('확대')} onClick={() => { setFit(false); setScale(Math.min(64, scale * 1.5)) }}><DatabaseLayoutIcon kind="plus" size={14} /></button>
    </header>
    <div className="overflow-x-auto overscroll-x-contain" onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      <div style={{ minWidth: `calc(8rem + ${width}px)` }}>
        <div className="flex h-8 text-[10px] tabular-nums text-ink-muted">
          <span className="sticky left-0 z-10 w-32 shrink-0 bg-surface px-2 py-2">{view.columns[0]?.name}</span>
          <div className="relative" style={{ width }}>{ticks.map(day => <span key={day} className="absolute top-2 whitespace-nowrap" style={{ left: (day - start) * ppd + 4 }}>{label(day)}</span>)}</div>
        </div>
        {rows.map(row => {
          const range = preview?.id === row.id ? preview.range : databaseDateRange(row, column.id, startColumn?.id)
          const first = range ? Math.max(start, dayNumber(range.start)) : start, last = range ? Math.min(end, dayNumber(range.end)) : start - 1
          const title = databaseRowTitle(row, view.columns) || uiText('제목 없음')
          return <div key={row.id} data-db-gantt-row={row.id} className="flex h-9 border-t border-edge/50 text-xs">
            <button type="button" onClick={() => onOpen(row)} title={title} aria-label={uiText('항목 열기: {p0}', { p0: title })} className="sticky left-0 z-10 w-32 shrink-0 truncate bg-surface px-2 text-left text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent">{title}</button>
            <div className="relative" style={{ width, touchAction: editable && !fit && !range ? 'pan-y' : undefined }} onPointerDown={!range ? event => begin(event, row, 'draw') : undefined}>
              {ticks.map(day => <span key={day} className="pointer-events-none absolute inset-y-0 border-l border-edge/50" style={{ left: (day - start) * ppd }} />)}
              {dayNumber(today) >= start && dayNumber(today) <= end && <span className="pointer-events-none absolute inset-y-0 border-l border-accent" style={{ left: (dayNumber(today) - start) * ppd }} />}
              {range && last >= first && <button type="button" data-db-gantt-bar={row.id} aria-label={`${title} · ${range.start} – ${range.end}`} title={`${title} · ${range.start} – ${range.end}`} className="absolute top-1 flex h-7 items-center overflow-hidden rounded bg-accent/20 text-ink hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-accent" style={{ left: (first - start) * ppd, width: Math.max(4, (last - first + 1) * ppd - 1), touchAction: editable && !fit ? 'pan-y' : undefined }}
                onPointerDown={event => begin(event, row, 'move')} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return }; onOpen(row) }}
                onKeyDown={event => {
                  if (!editable || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
                  event.preventDefault()
                  const delta = event.key === 'ArrowLeft' ? -1 : 1, a = dayNumber(range.start), b = dayNumber(range.end)
                  save(row, { start: dayKey(event.shiftKey ? a : event.altKey && startColumn ? Math.min(b, a + delta) : a + delta), end: dayKey(event.altKey && startColumn ? b : event.shiftKey && startColumn ? Math.max(a, b + delta) : b + delta) })
                }}>
                {editable && startColumn && !fit && <span data-db-gantt-resize="start" className="absolute inset-y-0 left-0 w-3 cursor-ew-resize" onPointerDown={event => begin(event, row, 'start')} />}
                <span className="truncate px-3 text-[10px] tabular-nums">{last - first >= 2 ? uiText('{p0}일', { p0: dayNumber(range.end) - dayNumber(range.start) + 1 }) : ''}</span>
                {editable && startColumn && !fit && <span data-db-gantt-resize="end" className="absolute inset-y-0 right-0 w-3 cursor-ew-resize" onPointerDown={event => begin(event, row, 'end')} />}
              </button>}
              {!range && <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => onOpen(row)} className="h-full px-2 text-[10px] text-ink-muted focus-visible:outline-2 focus-visible:outline-accent">{uiText('날짜 없음')}</button>}
            </div>
          </div>
        })}
        {!rows.length && <p className="px-2 py-4 text-xs text-ink-muted">{uiText('항목 없음')}</p>}
      </div>
    </div>
  </section>
}
