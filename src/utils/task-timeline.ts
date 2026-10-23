// Adapted from liiiiv/gantt-maker/src/lib/date.ts (same workspace).
/**
 * 날짜는 전부 'YYYY-MM-DD' 문자열, 내부 계산은 "에포크로부터의 일수"(day number)로 한다.
 * UTC 자정 기준이라 서머타임·타임존 때문에 하루가 밀리지 않는다.
 */
const MS_PER_DAY = 86_400_000

export type Scale = 'day' | 'week' | 'month' | 'quarter' | 'year'

const pad2 = (n: number) => String(n).padStart(2, '0')

export function dayOf(y: number, m: number, d: number): number {
  const date = new Date(0)
  date.setUTCFullYear(y, m - 1, d); date.setUTCHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / MS_PER_DAY)
}

export function toDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return dayOf(y, m, d)
}

export function fromDay(day: number): string {
  const { y, m, d } = ymd(day)
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`
}

export function ymd(day: number) {
  const t = new Date(day * MS_PER_DAY)
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    /** 0=일요일 */
    w: t.getUTCDay(),
  }
}

export function addDays(iso: string, n: number): string {
  return fromDay(toDay(iso) + n)
}

/** 끝날 포함 길이. '1-1'~'1-1'은 1일. */
export function spanDays(start: string, end: string): number {
  return toDay(end) - toDay(start) + 1
}

export function diffDays(a: string, b: string): number {
  return toDay(b) - toDay(a)
}

/** 로컬 달력 기준 오늘 (UTC로 바꾸면 자정 근처에 날짜가 어긋난다). */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 툴팁·메뉴에 쓰는 사람용 표기. 예: '8월 9일 (토)' */
export function formatDay(day: number): string {
  const { m, d, w } = ymd(day)
  return `${m}월 ${d}일 (${WEEKDAYS[w]})`
}

export function isWeekend(day: number): boolean {
  const w = ymd(day).w
  return w === 0 || w === 6
}

/** 하루당 픽셀 폭에 맞춰 눈금 단위를 고른다. */
export function scaleFor(pxPerDay: number): { minor: Scale; major: Scale } {
  if (pxPerDay >= 16) return { minor: 'day', major: 'month' }
  if (pxPerDay >= 4.5) return { minor: 'week', major: 'month' }
  if (pxPerDay >= 1.1) return { minor: 'month', major: 'year' }
  return { minor: 'quarter', major: 'year' }
}

/** day가 속한 눈금 칸의 시작일. */
export function floorTo(day: number, scale: Scale): number {
  if (scale === 'day') return day
  if (scale === 'week') return day - ((ymd(day).w + 6) % 7) // 월요일 시작
  const { y, m } = ymd(day)
  if (scale === 'month') return dayOf(y, m, 1)
  if (scale === 'quarter') return dayOf(y, Math.floor((m - 1) / 3) * 3 + 1, 1)
  return dayOf(y, 1, 1)
}

/** [startDay, endDay] 안의 눈금 시작일들. 왼쪽 잘린 칸도 포함한다. */
export function tickDays(startDay: number, endDay: number, scale: Scale): number[] {
  const out: number[] = []
  if (endDay < startDay) return out

  if (scale === 'day') {
    for (let d = startDay; d <= endDay; d++) out.push(d)
    return out
  }
  if (scale === 'week') {
    for (let d = floorTo(startDay, 'week'); d <= endDay; d += 7) out.push(d)
    return out
  }

  const step = scale === 'quarter' ? 3 : scale === 'year' ? 12 : 1
  const first = ymd(floorTo(startDay, scale))
  let { y } = first
  let m = first.m
  for (;;) {
    const day = dayOf(y, m, 1)
    if (day > endDay) break
    out.push(day)
    m += step
    while (m > 12) {
      m -= 12
      y += 1
    }
  }
  return out
}

export function tickLabel(day: number, scale: Scale, locale = 'ko'): string {
  const { y, m, d } = ymd(day)
  switch (scale) {
    case 'day':
      return String(d)
    case 'week':
      return `${m}/${d}`
    case 'month':
      return new Intl.DateTimeFormat(locale, { month: 'short', ...(m === 1 ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(day * MS_PER_DAY))
    case 'quarter':
      return `${m === 1 ? `${y} ` : ''}Q${Math.floor((m - 1) / 3) + 1}`
    case 'year':
      return new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' }).format(new Date(day * MS_PER_DAY))
  }
}
