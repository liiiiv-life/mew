import { useEffect, useMemo, useRef, useState } from 'react'

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

function dateNumber(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

function fromDateNumber(value: string) {
  if (!/^\d{8}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type PickerColumnProps = {
  label: string
  value: string
  options: { value: string; label: string }[]
  onPick: (value: string) => void
  onInput: (value: string) => void
  onBlur: () => void
  min?: number
  max?: number
  inputLabel: string
}

function PickerColumn({ label, value, options, onPick, onInput, onBlur, min, max, inputLabel }: PickerColumnProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' })
  }, [value])

  const move = (direction: -1 | 1) => {
    const index = options.findIndex((option) => option.value === value)
    const next = options[clamp(index < 0 ? 0 : index + direction, 0, options.length - 1)]
    if (next) onPick(next.value)
  }

  return (
    <div className="min-w-0 flex-1">
      <label className="block text-center text-[11px] text-ink-muted" htmlFor={`schedule-${label}`}>{label}</label>
      <input
        id={`schedule-${label}`}
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        aria-label={inputLabel}
        onChange={(event) => onInput(event.target.value)}
        onBlur={onBlur}
        className="mt-1 block w-full rounded border border-edge-strong bg-surface-deep px-1 py-1 text-center text-sm text-ink outline-none focus:border-accent"
      />
      <div
        className="mt-1 h-28 snap-y snap-mandatory overflow-y-auto rounded border border-edge bg-surface-deep py-10 [scrollbar-width:thin]"
        aria-label={`${label} 목록`}
        onWheel={(event) => {
          event.preventDefault()
          move(event.deltaY > 0 ? 1 : -1)
        }}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              ref={selected ? selectedRef : null}
              type="button"
              onClick={() => onPick(option.value)}
              className={`block h-7 w-full snap-center text-center text-sm tabular-nums ${selected ? 'bg-accent text-ink-on-accent' : 'text-ink-secondary hover:bg-surface-raised'}`}
              aria-pressed={selected}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 날짜·시·분을 세로 휠 또는 숫자 입력으로 고르는 로컬 시간 선택기. */
export function ScrollDateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parsed = useMemo(() => parseLocalDateTime(value) ?? parseLocalDateTime(formatLocalDateTime(new Date(), 0, 0))!, [value])
  const [dateInput, setDateInput] = useState(() => dateNumber(parsed.date))
  const [hourInput, setHourInput] = useState(() => String(parsed.hour).padStart(2, '0'))
  const [minuteInput, setMinuteInput] = useState(() => String(parsed.minute).padStart(2, '0'))

  useEffect(() => {
    setDateInput(dateNumber(parsed.date))
    setHourInput(String(parsed.hour).padStart(2, '0'))
    setMinuteInput(String(parsed.minute).padStart(2, '0'))
  }, [parsed]) // 외부 기본값/선택 변경만 입력 필드에 반영한다.

  const dates = useMemo(() => {
    const first = startOfDay(new Date())
    return Array.from({ length: 366 }, (_, index) => {
      const date = new Date(first)
      date.setDate(first.getDate() + index)
      return { value: dateNumber(date), label: `${date.getMonth() + 1}/${date.getDate()}` }
    })
  }, [])
  const hours = useMemo(() => Array.from({ length: 24 }, (_, value) => ({ value: String(value).padStart(2, '0'), label: String(value).padStart(2, '0') })), [])
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, value) => ({ value: String(value).padStart(2, '0'), label: String(value).padStart(2, '0') })), [])

  const setParts = (date = parsed.date, hour = parsed.hour, minute = parsed.minute) => onChange(formatLocalDateTime(date, hour, minute))
  const pickDate = (next: string) => {
    const date = fromDateNumber(next)
    if (date) setParts(date)
  }
  const pickHour = (next: string) => setParts(undefined, Number(next))
  const pickMinute = (next: string) => setParts(undefined, undefined, Number(next))

  return (
    <div className="mt-1.5 grid grid-cols-3 gap-2" aria-label="보낼 날짜와 시간">
      <PickerColumn
        label="날짜"
        value={dateInput}
        options={dates}
        min={Number(dates[0].value)}
        max={Number(dates[dates.length - 1].value)}
        inputLabel="날짜 (YYYYMMDD)"
        onPick={pickDate}
        onInput={setDateInput}
        onBlur={() => {
          const date = fromDateNumber(dateInput)
          if (date && !sameDay(date, parsed.date)) setParts(date)
          else setDateInput(dateNumber(parsed.date))
        }}
      />
      <PickerColumn
        label="시"
        value={hourInput}
        options={hours}
        min={0}
        max={23}
        inputLabel="시간"
        onPick={pickHour}
        onInput={setHourInput}
        onBlur={() => {
          const hour = Number(hourInput)
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
            setHourInput(String(hour).padStart(2, '0'))
            if (hour !== parsed.hour) setParts(undefined, hour)
          } else setHourInput(String(parsed.hour).padStart(2, '0'))
        }}
      />
      <PickerColumn
        label="분"
        value={minuteInput}
        options={minutes}
        min={0}
        max={59}
        inputLabel="분"
        onPick={pickMinute}
        onInput={setMinuteInput}
        onBlur={() => {
          const minute = Number(minuteInput)
          if (Number.isInteger(minute) && minute >= 0 && minute <= 59) {
            setMinuteInput(String(minute).padStart(2, '0'))
            if (minute !== parsed.minute) setParts(undefined, undefined, minute)
          } else setMinuteInput(String(parsed.minute).padStart(2, '0'))
        }}
      />
    </div>
  )
}
