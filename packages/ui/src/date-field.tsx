import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, NavArrowLeft, NavArrowRight, Xmark, Trash } from 'iconoir-react'
import { useUiLocale } from './i18n'
import { uiText, uiWeekdays } from './i18n-core'
import { useOverlayDismiss } from './useOverlayDismiss'
import { dateFromValue, dateValue, localToday, shiftDate, validDateValue } from './date-value'
import './date-field.css'

const segmentRanges = [[0, 4], [5, 7], [8, 10]] as const
type DateParts = [string, string, string]
const dateParts = (value?: string | null): DateParts => value ? value.split('-') as DateParts : ['', '', '']
const maskedDate = (parts: DateParts) => parts.map((part, index) => part.padStart(index === 0 ? 4 : 2, '0')).join('-')

/** One masked input with independently selectable year/month/day segments. */
export function DateField({ value, label, readOnly = false, compact = false, onChange }: {
  value?: string | null; label: string; readOnly?: boolean; compact?: boolean; onChange: (value: string | null) => void
}) {
  useUiLocale()
  const id = useId(), field = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null)
  const [parts, setParts] = useState<DateParts>(() => dateParts(value))
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false), [open, setOpen] = useState(false)
  const clickedSegment = useRef<number | null>(null)
  const focused = useRef(false), activeSegment = useRef(0), typed = useRef(''), pendingSelection = useRef<number | null>(null)
  const currentParts = useRef(parts); currentParts.current = parts
  const replaceParts = (next: DateParts) => { currentParts.current = next; setParts(next); setInvalid(false) }
  useEffect(() => { if (!focused.current) { setParts(dateParts(value)); setInvalid(false) } }, [value])
  useEffect(() => { if (readOnly) { setOpen(false); setParts(dateParts(value)); setInvalid(false) } }, [readOnly, value])
  const select = (index: number) => {
    input.current?.focus({ preventScroll: true })
    activeSegment.current = index; typed.current = ''; pendingSelection.current = index
    input.current?.setSelectionRange(segmentRanges[index][0], segmentRanges[index][1])
  }
  useLayoutEffect(() => {
    if (pendingSelection.current !== null && focused.current) input.current?.setSelectionRange(segmentRanges[pendingSelection.current][0], segmentRanges[pendingSelection.current][1])
    pendingSelection.current = null
  })
  const commit = (next = currentParts.current) => {
    const date = next.every(part => !part) ? null : maskedDate(next)
    if (date !== null && (next.some(part => !part) || !validDateValue(date))) { setInvalid(true); return false }
    setInvalid(false)
    if (date !== (value ?? null)) onChange(date)
    return true
  }
  const forward = () => {
    if (activeSegment.current < 2) select(activeSegment.current + 1)
    else if (commit()) trigger.current?.focus({ preventScroll: true })
  }
  const writeDigits = (digits: string) => {
    if (!/^\d+$/.test(digits)) return
    const whole = input.current?.selectionStart === 0 && input.current.selectionEnd === 10
    const next = (whole ? ['', '', ''] : [...currentParts.current]) as DateParts
    let segment = whole ? 0 : activeSegment.current, buffer = whole ? '' : typed.current
    for (const digit of digits) {
      buffer += digit; next[segment] = buffer
      if (buffer.length === (segment === 0 ? 4 : 2)) {
        if (segment === 2) { buffer = ''; break }
        segment++; buffer = ''
      }
    }
    replaceParts(next)
    activeSegment.current = segment; typed.current = buffer; pendingSelection.current = segment
    input.current?.setSelectionRange(segmentRanges[segment][0], segmentRanges[segment][1])
    if (segment === 2 && next[2].length === 2 && !buffer) commit(next)
  }
  const erase = (backward: boolean) => {
    if (input.current?.selectionStart === 0 && input.current.selectionEnd === 10) {
      replaceParts(['', '', '']); select(0); return
    }
    const next = [...currentParts.current] as DateParts
    let segment = activeSegment.current
    if (!next[segment] && backward && segment > 0) segment--
    next[segment] = ''; replaceParts(next); select(segment)
  }
  const beforeInput = useRef<(event: InputEvent) => void>(() => {})
  beforeInput.current = event => {
    if (readOnly || event.isComposing) return
    if (event.inputType === 'insertText' && event.data) {
      event.preventDefault()
      if (/^\d+$/.test(event.data)) writeDigits(event.data)
      else fullInput(event.data)
    }
    else if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') { event.preventDefault(); erase(event.inputType === 'deleteContentBackward') }
  }
  useLayoutEffect(() => {
    const element = input.current
    const handle = (event: InputEvent) => beforeInput.current(event)
    element?.addEventListener('beforeinput', handle)
    return () => element?.removeEventListener('beforeinput', handle)
  }, [])
  const fullInput = (text: string) => {
    if (!text.trim()) { replaceParts(['', '', '']); select(0); return }
    const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text.trim()) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text.trim())
    if (match) { replaceParts([match[1], match[2], match[3]]); select(2) }
    else { setParts([...currentParts.current]); pendingSelection.current = activeSegment.current }
  }
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }) }
  const choose = (date: string | null) => { replaceParts(dateParts(date)); onChange(date); close() }
  return <div ref={field} className="mew-date-field" data-has-date={!!value || undefined} data-invalid={invalid || undefined} data-compact={compact && !editing && !invalid || undefined}>
    <input ref={input} type="text" inputMode="numeric" aria-label={label} value={compact && !editing && !invalid ? maskedDate(parts).slice(2) : maskedDate(parts)} readOnly={readOnly}
      autoComplete="off" spellCheck={false} maxLength={10} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
      onFocus={event => { focused.current = true; if (!readOnly) { setEditing(true); event.currentTarget.value = maskedDate(currentParts.current); activeSegment.current = 0; typed.current = ''; pendingSelection.current = 0; input.current?.setSelectionRange(...segmentRanges[0]) } }}
      onPointerDown={event => {
        if (readOnly) return
        const element = event.currentTarget, style = getComputedStyle(element)
        const canvas = element.ownerDocument.createElement('canvas'), context = canvas.getContext('2d')
        if (!context) return
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const x = event.clientX - element.getBoundingClientRect().left - parseFloat(style.paddingLeft) + element.scrollLeft
        const short = compact && !focused.current && !invalid
        const text = short ? maskedDate(currentParts.current).slice(2) : maskedDate(currentParts.current)
        clickedSegment.current = x < context.measureText(text.slice(0, short ? 3 : 5)).width ? 0 : x < context.measureText(text.slice(0, short ? 6 : 8)).width ? 1 : 2
      }}
      onClick={event => {
        if (readOnly) return
        const offset = event.currentTarget.selectionStart ?? 0
        select(clickedSegment.current ?? (offset < 5 ? 0 : offset < 8 ? 1 : 2))
        clickedSegment.current = null
      }}
      onChange={event => {
        if ((event.nativeEvent as InputEvent).isComposing) return
        const data = (event.nativeEvent as InputEvent).data
        if (data && /^\d{1,2}$/.test(data)) writeDigits(data)
        else fullInput(event.target.value)
      }}
      onPaste={event => {
        if (readOnly) return
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain').trim()
        if (/^\d{1,4}$/.test(text)) writeDigits(text)
        else fullInput(text)
      }}
      onBlur={() => { setEditing(false); focused.current = false; typed.current = ''; if (!readOnly) commit() }} onKeyDown={event => {
        if (readOnly || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setOpen(true); return }
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (/^\d$/.test(event.key)) { event.preventDefault(); writeDigits(event.key); return }
        if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); erase(event.key === 'Backspace'); return }
        if (event.key === 'Enter' || event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); forward(); return }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); select(Math.max(0, activeSegment.current - 1)); return }
        if (event.key === 'Tab') {
          const next = activeSegment.current + (event.shiftKey ? -1 : 1)
          if (next >= 0 && next <= 2) { event.preventDefault(); select(next) }
          else if (next > 2 && !commit()) event.preventDefault()
          return
        }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(event.key === 'Home' ? 0 : 2); return }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); replaceParts(dateParts(value)); select(0); return }
        if (event.key.length === 1) event.preventDefault()
      }} />
    {!readOnly && <button ref={trigger} type="button" aria-label={uiText('달력 열기')} data-tip={uiText('달력 열기')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} className="mew-date-icon"
      onClick={() => setOpen(!open)}><Calendar width={15} height={15} aria-hidden="true" /></button>}
    {invalid && <span id={`${id}-error`} role="alert" className="mew-date-error">{uiText('올바른 날짜를 입력하세요 (YYYY-MM-DD)')}</span>}
    {open && !readOnly && <DateCalendar id={id} value={value ?? null} anchor={field} onChoose={choose} onClose={close} />}
  </div>
}

function DateCalendar({ id, value, anchor, onChoose, onClose }: {
  id: string; value: string | null; anchor: RefObject<HTMLDivElement | null>
  onChoose: (value: string | null) => void; onClose: (restore?: boolean) => void
}) {
  const locale = useUiLocale(), today = localToday()
  const initial = value && validDateValue(value) ? value : today
  const [active, setActive] = useState(initial), [month, setMonth] = useState(initial.slice(0, 7)), [direction, setDirection] = useState(1)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const popup = useRef<HTMLDivElement>(null), focusDay = useRef(true)
  useOverlayDismiss(() => onClose())
  useLayoutEffect(() => {
    const place = () => {
      const target = anchor.current, menu = popup.current
      if (!target?.isConnected || !target.checkVisibility()) { onClose(false); return }
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const rect = target.getBoundingClientRect(), menuWidth = Math.min(304, width - 16)
      const menuHeight = Math.min(menu?.scrollHeight ?? 358, height - 16)
      const below = rect.bottom + 6
      const y = below + menuHeight <= top + height - 8 ? below : rect.top - menuHeight - 6
      setPosition({ left: Math.max(left + 8, Math.min(rect.right - menuWidth, left + width - menuWidth - 8)), top: Math.max(top + 8, Math.min(y, top + height - menuHeight - 8)), width: menuWidth, maxHeight: height - 16 })
    }
    const outside = (event: PointerEvent) => {
      const node = event.target as Node
      if (!anchor.current?.contains(node) && !popup.current?.contains(node)) onClose(false)
    }
    place()
    const observer = new ResizeObserver(place)
    if (anchor.current) observer.observe(anchor.current)
    if (popup.current) observer.observe(popup.current)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect(); document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [anchor, onClose])
  const positioned = position !== null
  useLayoutEffect(() => {
    if (positioned && focusDay.current) { popup.current?.querySelector<HTMLButtonElement>(`[data-date="${active}"]`)?.focus({ preventScroll: true }); focusDay.current = false }
  }, [active, month, positioned])
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateFromValue(`${month}-01`))
  const fullDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' })
  const start = `${month}-01`, first = shiftDate(start, -dateFromValue(start).getUTCDay())
  const days = Array.from({ length: 42 }, (_, index) => shiftDate(first, index))
  const moveMonth = (step: number, keyboard = false) => {
    const date = dateFromValue(`${month}-01`)
    date.setUTCMonth(date.getUTCMonth() + step)
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return
    const next = dateValue(date).slice(0, 7), day = dateFromValue(active).getUTCDate()
    const end = new Date(date); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0)
    const nextActive = `${next}-${String(Math.min(day, end.getUTCDate())).padStart(2, '0')}`
    focusDay.current = keyboard; setDirection(step >= 0 ? 1 : -1); setMonth(next); setActive(nextActive)
  }
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
    const weekday = dateFromValue(active).getUTCDay()
    const step = delta ?? (event.key === 'Home' ? -weekday : event.key === 'End' ? 6 - weekday : null)
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); event.stopPropagation(); moveMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1), true); return
    }
    if (step === null) return
    event.preventDefault(); event.stopPropagation()
    const next = shiftDate(active, step)
    if (!validDateValue(next)) return
    focusDay.current = true; setDirection(step >= 0 ? 1 : -1); setActive(next); setMonth(next.slice(0, 7))
  }
  return createPortal(<div ref={popup} id={id} role="dialog" aria-label={uiText('날짜 선택')} className="mew-calendar" style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
    onBlur={event => {
      const next = event.relatedTarget as Node | null
      if (next && !event.currentTarget.contains(next) && !anchor.current?.contains(next)) onClose(false)
    }}>
    <header className="mew-calendar-header">
      <span aria-live="polite" className="mew-calendar-month">{monthLabel}</span>
      <div className="mew-calendar-nav">
        <button type="button" className="mew-date-icon" aria-label={uiText('이전 달')} data-tip={uiText('이전 달')} disabled={month === '0001-01'} onClick={() => moveMonth(-1)}><NavArrowLeft width={16} height={16} aria-hidden="true" /></button>
        <button type="button" className="mew-date-icon" aria-label={uiText('다음 달')} data-tip={uiText('다음 달')} disabled={month === '9999-12'} onClick={() => moveMonth(1)}><NavArrowRight width={16} height={16} aria-hidden="true" /></button>
        <button type="button" className="mew-date-icon" aria-label={uiText('닫기')} data-tip={uiText('닫기')} onClick={() => onClose()}><Xmark width={16} height={16} aria-hidden="true" /></button>
      </div>
    </header>
    <div role="grid" aria-label={monthLabel} className="mew-calendar-grid" key={month} data-direction={direction}>
      <div role="row" className="mew-calendar-weekdays">{uiWeekdays().map((day, index) => <span role="columnheader" key={index}>{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div role="row" className="mew-calendar-week" key={week}>
        {days.slice(week * 7, week * 7 + 7).map(day => <div role="gridcell" aria-selected={day === value} key={day}>
          <button type="button" data-date={day} data-outside={day.slice(0, 7) !== month || undefined} data-selected={day === value || undefined}
            aria-label={fullDate.format(dateFromValue(day))} aria-current={day === today ? 'date' : undefined}
            className="mew-calendar-day" tabIndex={day === active ? 0 : -1} disabled={!validDateValue(day)}
            onFocus={() => setActive(day)} onKeyDown={keyDown} onClick={() => onChoose(day)}>{dateFromValue(day).getUTCDate()}</button>
        </div>)}
      </div>)}
    </div>
    <footer className="mew-calendar-footer">
      <div className="mew-calendar-shortcuts">
        <button type="button" onClick={() => onChoose(today)}>{uiText('오늘')}</button>
        <button type="button" onClick={() => onChoose(shiftDate(today, 1))}>{uiText('내일')}</button>
      </div>
      <button type="button" className="mew-date-icon" aria-label={uiText('날짜 지우기')} data-tip={uiText('날짜 지우기')} disabled={!value} onClick={() => onChoose(null)}><Trash width={15} height={15} aria-hidden="true" /></button>
    </footer>
  </div>, document.body)
}
