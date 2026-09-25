import { uiText, uiWeekdays, getUiLocale } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// 달력 위젯 — 기한이 잡힌 할 일만 날짜 칸에 놓는다. 기한 없는 항목은 여기 오지 않는다(할 일 위젯에 있다).
//
// 날짜는 전부 `YYYY-MM-DD` 문자열로만 다룬다. Date로 바꿔 비교하면 시간대 때문에 하루씩 밀린다.
import { useMemo, useState } from 'react'
import { NavArrowLeft, NavArrowRight } from 'iconoir-react'
import type { TodoItem, TodoStatus, TodoType } from '../../api/client'


function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function DueCalendar({
  items,
  onUpdate,
}: {
  items: TodoItem[]
  onUpdate: (
    item: TodoItem,
    change: { text?: string; type?: TodoType; status?: TodoStatus; done?: boolean; due?: string | null; time?: string | null; projects?: string[] },
  ) => void
}) {
  useUiLocale()
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const today = iso(now.getFullYear(), now.getMonth(), now.getDate())

  const byDay = useMemo(() => {
    const map = new Map<string, TodoItem[]>()
    for (const item of items) {
      if (!item.due) continue
      const list = map.get(item.due) ?? []
      list.push(item)
      map.set(item.due, list)
    }
    return map
  }, [items])

  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay()
  const dayCount = new Date(cursor.year, cursor.month + 1, 0).getDate()
  // 앞쪽 빈 칸 + 날짜 칸
  const cells: (number | null)[] = [...Array<null>(firstWeekday).fill(null), ...Array.from({ length: dayCount }, (_, i) => i + 1)]

  const step = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  return (
    <div>
      <div className="flex items-center gap-2 pb-3">
        <button
          type="button"
          onClick={() => step(-1)}
          className="flex h-8 w-8 items-center justify-center rounded border border-edge bg-surface-raised text-ink-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-ink"
          aria-label={uiText("이전 달")}
          title={uiText("이전 달")}
        >
          <NavArrowLeft width={15} height={15} aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1 text-center text-sm font-semibold text-ink-bright">
          {new Intl.DateTimeFormat(getUiLocale(), { year: 'numeric', month: 'long' }).format(new Date(cursor.year, cursor.month, 1))}</span>
        <button
          type="button"
          onClick={() => step(1)}
          className="flex h-8 w-8 items-center justify-center rounded border border-edge bg-surface-raised text-ink-secondary hover:border-edge-strong hover:bg-surface-hover hover:text-ink"
          aria-label={uiText("다음 달")}
          title={uiText("다음 달")}
        >
          <NavArrowRight width={15} height={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
          className="rounded border border-edge bg-surface-raised px-2.5 py-1 text-xs text-ink-muted hover:border-edge-strong hover:bg-surface-hover hover:text-ink"
        >
          {uiText("오늘")}</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[11px]">
        {uiWeekdays().map((w) => (
          <div key={w} className="px-1 pb-1 text-center font-medium text-ink-muted">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />
          const date = iso(cursor.year, cursor.month, day)
          const dayItems = byDay.get(date) ?? []
          const hasOpen = dayItems.some((item) => !item.done)
          const isFuture = date > today
          return (
            <div
              key={date}
              className={`min-h-[4.25rem] rounded-lg border p-1.5 ${
                date === today
                  ? 'border-accent/70 bg-accent/10'
                  : hasOpen
                    ? `border-edge-strong ${isFuture ? 'bg-surface-hover/60' : 'bg-surface-raised'}`
                    : isFuture
                      ? 'border-edge bg-surface-raised'
                      : 'border-edge bg-surface'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={date === today ? 'font-semibold text-ink-bright' : 'text-ink-muted'}>{day}</span>
                {hasOpen && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
              </div>
              {dayItems.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onUpdate(item, { status: item.status === 'done' ? 'open' : 'done' })}
                  title={item.text}
                  className={`mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left ${
                    item.status === 'done'
                      ? 'text-ink-muted line-through'
                      : 'bg-surface-hover/70 text-ink-secondary hover:text-ink'
                  }`}
                >
                  {item.text}
                </button>
              ))}
              {dayItems.length > 3 && <div className="px-1 text-ink-muted">+{dayItems.length - 3}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
