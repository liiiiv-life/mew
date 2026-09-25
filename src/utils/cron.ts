import { uiText, uiWeekdays } from '@mew/ui/i18n-core'
// 크론 5필드 ↔ GUI가 다루는 몇 가지 반복 형태의 변환. 표현할 수 없는 식은 custom으로 흘려보내
// 사용자가 직접 쓰게 둔다 — 크론 문법 전체를 GUI로 재현하지 않는다.
export type Schedule =
  | { kind: 'daily'; time: string } // time = HH:MM
  | { kind: 'weekly'; time: string; days: number[] } // 0=일 … 6=토
  | { kind: 'hourly'; minute: number }
  | { kind: 'interval'; minutes: number }
  | { kind: 'custom'; expr: string }

const pad = (n: number) => String(n).padStart(2, '0')
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null)

export function toCron(s: Schedule): string {
  switch (s.kind) {
    case 'daily': {
      const [h, m] = s.time.split(':')
      return `${num(m) ?? 0} ${num(h) ?? 0} * * *`
    }
    case 'weekly': {
      const [h, m] = s.time.split(':')
      const days = s.days.length > 0 ? [...s.days].sort().join(',') : '0'
      return `${num(m) ?? 0} ${num(h) ?? 0} * * ${days}`
    }
    case 'hourly':
      return `${s.minute} * * * *`
    case 'interval':
      return `*/${s.minutes} * * * *`
    case 'custom':
      return s.expr
  }
}

export function fromCron(expr: string): Schedule {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return { kind: 'custom', expr }
  const [minute, hour, dom, mon, dow] = f
  const rest = dom === '*' && mon === '*'
  const min = num(minute)
  const hr = num(hour)

  const step = minute.match(/^\*\/(\d+)$/)
  if (step && hour === '*' && rest && dow === '*') return { kind: 'interval', minutes: Number(step[1]) }
  if (min !== null && hour === '*' && rest && dow === '*') return { kind: 'hourly', minute: min }
  if (min !== null && hr !== null && rest) {
    const time = `${pad(hr)}:${pad(min)}`
    if (dow === '*') return { kind: 'daily', time }
    const days = dow.split(',').map(num)
    if (days.every((d) => d !== null && d >= 0 && d <= 7)) {
      return { kind: 'weekly', time, days: (days as number[]).map((d) => d % 7) }
    }
  }
  return { kind: 'custom', expr }
}

export const dayNames = uiWeekdays

/** 사람이 읽는 한 줄 — 목록 헤더에 그대로 쓴다. */
export function describeSchedule(expr: string): string {
  const s = fromCron(expr)
  switch (s.kind) {
    case 'daily':
      return uiText("매일 {p0}", { p0: s.time })
    case 'weekly':
      return uiText("매주 {p0} {p1}", { p0: s.days.map((d) => dayNames()[d]).join('·'), p1: s.time })
    case 'hourly':
      return uiText("매시 {p0}분", { p0: s.minute })
    case 'interval':
      return uiText("{p0}분마다", { p0: s.minutes })
    case 'custom':
      return uiText("크론 {p0}", { p0: s.expr })
  }
}
