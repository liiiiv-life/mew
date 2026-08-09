// 달력 위젯 — 기한이 잡힌 할 일만 날짜 칸에 놓는다. 기한 없는 항목은 여기 오지 않는다(할 일 위젯에 있다).
//
// 날짜는 전부 `YYYY-MM-DD` 문자열로만 다룬다. Date로 바꿔 비교하면 시간대 때문에 하루씩 밀린다.
import { useMemo, useState } from 'react'
import type { TodoItem } from '../../api/client'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function DueCalendar({ items, onOpen }: { items: TodoItem[]; onOpen: (item: TodoItem) => void }) {
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
      <div className="flex items-center gap-1 px-1 pb-2">
        <button type="button" onClick={() => step(-1)} className="rounded px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-hover">
          ‹
        </button>
        <span className="text-xs text-ink-secondary">
          {cursor.year}년 {cursor.month + 1}월
        </span>
        <button type="button" onClick={() => step(1)} className="rounded px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-hover">
          ›
        </button>
        <button
          type="button"
          onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
          className="ml-auto rounded px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-hover"
        >
          오늘
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px text-[11px]">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-1 pb-1 text-center text-ink-muted">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />
          const date = iso(cursor.year, cursor.month, day)
          const dayItems = byDay.get(date) ?? []
          return (
            <div
              key={date}
              className={`min-h-[3.5rem] rounded p-1 ${date === today ? 'bg-surface-hover' : 'bg-surface-raised'}`}
            >
              <div className={date === today ? 'font-semibold text-ink' : 'text-ink-muted'}>{day}</div>
              {dayItems.slice(0, 3).map((item) => (
                <button
                  key={`${item.project}:${item.path}:${item.line}:${item.text}`}
                  type="button"
                  onClick={() => onOpen(item)}
                  title={`${item.project}/${item.path}:${item.line} — ${item.text}`}
                  className={`block w-full truncate text-left ${item.done ? 'text-ink-muted line-through' : 'text-ink-secondary hover:text-ink'}`}
                >
                  {item.text}
                </button>
              ))}
              {dayItems.length > 3 && <div className="text-ink-muted">+{dayItems.length - 3}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
