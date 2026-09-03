import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'

type DateTimeParts = { date: Date; hour: number; minute: number }

function parseLocalDateTime(value: string): DateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || hour > 23 || minute > 59) return null
  return { date, hour, minute }
}

function formatLocalDateTime(date: Date, hour: number, minute: number) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }
function pad(value: number, length = 2) { return String(value).padStart(length, '0') }
function daysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate() }
function shiftedDate(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

type PickerFieldProps = {
  label: string
  value: string
  previous: string
  next: string
  onInput: (value: string) => void
  onBlur: () => void
  inputLabel: string
  onAdjust: (amount: number) => void
}

/** 가운데 숫자는 직접 고치고, 같은 자리에서 휠·세로 드래그로 바로 돌린다. */
function PickerField({ label, value, previous, next, onInput, onBlur, inputLabel, onAdjust }: PickerFieldProps) {
  const drag = useRef<{ pointerId: number; startY: number; amount: number } | null>(null)
  const frame = useRef<number | null>(null)
  const [reelOffset, setReelOffset] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const adjust = (amount: number) => {
    if (!amount) return
    // 다음 값의 위·아래 칸을 먼저 가운데에 놓고 제자리로 미끄러뜨린다.
    // 드래그 중에도 실제 릴을 돌리는 듯 이전 숫자가 자연스럽게 지나간다.
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    // 시작 위치는 즉시 옮기고, 다음 프레임에서만 transition을 켠다.
    // 그렇지 않으면 숫자가 먼저 반대쪽으로 튀었다가 돌아온다.
    setSpinning(false)
    setReelOffset(amount > 0 ? 18 : -18)
    onAdjust(amount)
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setSpinning(true)
      setReelOffset(0)
    })
  }
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return
    event.preventDefault()
    adjust(event.deltaY > 0 ? 1 : -1)
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    drag.current = { pointerId: event.pointerId, startY: event.clientY, amount: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const amount = Math.trunc((active.startY - event.clientY) / 22)
    const delta = amount - active.amount
    if (delta === 0) return
    event.preventDefault()
    active.amount = amount
    adjust(delta)
  }
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="min-w-0 flex-1">
      <label className="block text-center text-[10px] text-ink-muted" htmlFor={`schedule-${label}`}>{label}</label>
      <div
        className="mt-0.5 h-[3.75rem] touch-none select-none overflow-hidden text-center tabular-nums"
        onWheel={wheel}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
      >
        <div
          className="will-change-transform"
          style={{ transform: `translateY(${reelOffset}px)`, transition: spinning ? 'transform 150ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined }}
          onTransitionEnd={() => setSpinning(false)}
        >
          <div className="h-[1.125rem] text-[11px] leading-[1.125rem] text-ink-muted/60">{previous}</div>
          <input
            id={`schedule-${label}`}
            type="text"
            inputMode="numeric"
            value={value}
            aria-label={inputLabel}
            onChange={(event) => onInput(event.target.value)}
            onBlur={onBlur}
            className="block h-6 w-full bg-transparent px-1 text-center text-sm font-medium leading-6 text-ink outline-none"
          />
          <div className="h-[1.125rem] text-[11px] leading-[1.125rem] text-ink-muted/60">{next}</div>
        </div>
      </div>
    </div>
  )
}

/** 연·월·일·시·분 숫자를 직접 입력하거나, 그 숫자 위에서 휠·드래그로 바꾸는 로컬 시간 선택기. */
export function ScrollDateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parsed = useMemo(() => parseLocalDateTime(value) ?? parseLocalDateTime(formatLocalDateTime(new Date(), 0, 0))!, [value])
  const [yearInput, setYearInput] = useState(() => pad(parsed.date.getFullYear(), 4))
  const [monthInput, setMonthInput] = useState(() => pad(parsed.date.getMonth() + 1))
  const [dayInput, setDayInput] = useState(() => pad(parsed.date.getDate()))
  const [hourInput, setHourInput] = useState(() => pad(parsed.hour))
  const [minuteInput, setMinuteInput] = useState(() => pad(parsed.minute))

  useEffect(() => {
    setYearInput(pad(parsed.date.getFullYear(), 4))
    setMonthInput(pad(parsed.date.getMonth() + 1))
    setDayInput(pad(parsed.date.getDate()))
    setHourInput(pad(parsed.hour))
    setMinuteInput(pad(parsed.minute))
  }, [parsed])

  const setParts = (date = parsed.date, hour = parsed.hour, minute = parsed.minute) => onChange(formatLocalDateTime(date, hour, minute))
  const setCalendar = (year: number, month: number, day: number) => {
    const normalized = new Date(year, month, 1)
    const date = new Date(normalized.getFullYear(), normalized.getMonth(), clamp(day, 1, daysInMonth(normalized.getFullYear(), normalized.getMonth())))
    setParts(date)
  }
  const moveDate = (amount: number) => setParts(shiftedDate(parsed.date, amount))
  const moveMonth = (amount: number) => setCalendar(parsed.date.getFullYear(), parsed.date.getMonth() + amount, parsed.date.getDate())
  const moveHour = (amount: number) => setParts(undefined, (parsed.hour + amount + 240) % 24)
  const moveMinute = (amount: number) => setParts(undefined, undefined, (parsed.minute + amount + 600) % 60)
  const previousDay = shiftedDate(parsed.date, -1)
  const nextDay = shiftedDate(parsed.date, 1)
  const previousMonth = new Date(parsed.date.getFullYear(), parsed.date.getMonth() - 1, 1)
  const nextMonth = new Date(parsed.date.getFullYear(), parsed.date.getMonth() + 1, 1)

  return (
    <div className="mt-1.5 grid grid-cols-5 gap-1" aria-label="보낼 날짜와 시간">
      <PickerField label="년" value={yearInput} previous={pad(parsed.date.getFullYear() - 1, 4)} next={pad(parsed.date.getFullYear() + 1, 4)} inputLabel="년"
        onInput={setYearInput} onAdjust={(amount) => setCalendar(parsed.date.getFullYear() + amount, parsed.date.getMonth(), parsed.date.getDate())}
        onBlur={() => {
          const year = Number(yearInput)
          if (/^\d{4}$/.test(yearInput) && year >= 1 && year <= 9999) setCalendar(year, parsed.date.getMonth(), parsed.date.getDate())
          else setYearInput(pad(parsed.date.getFullYear(), 4))
        }}
      />
      <PickerField label="월" value={monthInput} previous={pad(previousMonth.getMonth() + 1)} next={pad(nextMonth.getMonth() + 1)} inputLabel="월"
        onInput={setMonthInput} onAdjust={moveMonth}
        onBlur={() => {
          const month = Number(monthInput)
          if (Number.isInteger(month) && month >= 1 && month <= 12) setCalendar(parsed.date.getFullYear(), month - 1, parsed.date.getDate())
          else setMonthInput(pad(parsed.date.getMonth() + 1))
        }}
      />
      <PickerField label="일" value={dayInput} previous={pad(previousDay.getDate())} next={pad(nextDay.getDate())} inputLabel="일"
        onInput={setDayInput} onAdjust={moveDate}
        onBlur={() => {
          const day = Number(dayInput)
          if (Number.isInteger(day) && day >= 1 && day <= daysInMonth(parsed.date.getFullYear(), parsed.date.getMonth())) setCalendar(parsed.date.getFullYear(), parsed.date.getMonth(), day)
          else setDayInput(pad(parsed.date.getDate()))
        }}
      />
      <PickerField label="시" value={hourInput} previous={pad((parsed.hour + 23) % 24)} next={pad((parsed.hour + 1) % 24)} inputLabel="시간"
        onInput={setHourInput} onAdjust={moveHour}
        onBlur={() => {
          const hour = Number(hourInput)
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) setParts(undefined, hour)
          else setHourInput(pad(parsed.hour))
        }}
      />
      <PickerField label="분" value={minuteInput} previous={pad((parsed.minute + 59) % 60)} next={pad((parsed.minute + 1) % 60)} inputLabel="분"
        onInput={setMinuteInput} onAdjust={moveMinute}
        onBlur={() => {
          const minute = Number(minuteInput)
          if (Number.isInteger(minute) && minute >= 0 && minute <= 59) setParts(undefined, undefined, minute)
          else setMinuteInput(pad(parsed.minute))
        }}
      />
    </div>
  )
}
