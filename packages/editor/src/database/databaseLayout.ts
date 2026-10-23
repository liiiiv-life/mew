import type { DbColumn, DbRow } from '../types.ts'

export const DATABASE_LAYOUTS = ['table', 'cards', 'board', 'calendar', 'gantt'] as const
export type DatabaseLayoutMode = typeof DATABASE_LAYOUTS[number]
export type DatabaseLayout = { mode: DatabaseLayoutMode; groupColumn?: string; dateColumn?: string; startDateColumn?: string; visibleFields?: string[] }
export const DEFAULT_DATABASE_LAYOUT: DatabaseLayout = { mode: 'table' }

export function normalizeDatabaseLayout(value: unknown): DatabaseLayout {
  if (!value || typeof value !== 'object') return { ...DEFAULT_DATABASE_LAYOUT }
  const input = value as Record<string, unknown>
  const result: DatabaseLayout = { mode: DATABASE_LAYOUTS.includes(input.mode as DatabaseLayoutMode) ? input.mode as DatabaseLayoutMode : 'table' }
  for (const key of ['groupColumn', 'dateColumn', 'startDateColumn'] as const) if (typeof input[key] === 'string' && input[key].length <= 100) result[key] = input[key]
  if (Array.isArray(input.visibleFields)) result.visibleFields = [...new Set(input.visibleFields.filter((item): item is string => typeof item === 'string' && item.length <= 100))].slice(0, 24)
  return result
}
export function parseDatabaseLayout(value: string | null | undefined): DatabaseLayout {
  try { return value && value.length <= 4096 ? normalizeDatabaseLayout(JSON.parse(decodeURIComponent(value))) : { ...DEFAULT_DATABASE_LAYOUT } }
  catch { return { ...DEFAULT_DATABASE_LAYOUT } }
}
export function serializeDatabaseLayout(value: DatabaseLayout): string { return encodeURIComponent(JSON.stringify(normalizeDatabaseLayout(value))) }

export function databaseRowTitle(row: DbRow, columns: DbColumn[]): string { return String(row.cells[columns[0]?.id] ?? '') }
export function searchDatabaseRows(rows: DbRow[], query: string, locale?: string): DbRow[] {
  const terms = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean)
  return terms.length ? rows.filter(row => terms.every(term => Object.values(row.cells).some(value => String(value ?? '').toLocaleLowerCase(locale).includes(term)))) : rows
}
export type DatabaseGroup = { key: string; label: string; value: string | boolean | null; rows: DbRow[] }
export function groupDatabaseRows(rows: DbRow[], column: DbColumn): DatabaseGroup[] {
  const values: (string | boolean)[] = column.type === 'checkbox' ? [false, true] : [...new Set([...(column.options ?? []), ...rows.flatMap(row => typeof row.cells[column.id] === 'string' && row.cells[column.id] ? [row.cells[column.id] as string] : [])])]
  const groups: DatabaseGroup[] = values.map(value => ({ key: JSON.stringify(value), label: String(value), value, rows: [] as DbRow[] }))
  groups.push({ key: 'null', label: '', value: null, rows: [] })
  for (const row of rows) {
    const value = row.cells[column.id]
    const group = groups.find(group => group.value === value) ?? groups[groups.length - 1]
    group.rows.push(row)
  }
  return groups
}
export function dateKey(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null
  const key = value.slice(0, 10), parsed = new Date(`${key}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null
}
export function databaseDateRange(row: DbRow, dateColumn: string, startDateColumn?: string): { start: string; end: string } | null {
  const end = dateKey(row.cells[dateColumn]), start = startDateColumn ? dateKey(row.cells[startDateColumn]) : null
  if (!start && !end) return null
  if (!start || !end) return { start: (start ?? end)!, end: (end ?? start)! }
  return start <= end ? { start, end } : { start: end, end: start }
}
export function groupCalendarRows(rows: DbRow[], days: string[], dateColumn: string, startDateColumn?: string): Map<string, DbRow[]> {
  const groups = new Map<string, DbRow[]>([['', []], ...days.map(day => [day, []] as [string, DbRow[]])])
  for (const row of rows) {
    const range = databaseDateRange(row, dateColumn, startDateColumn)
    if (!range) groups.get('')!.push(row)
    else for (const day of days) if (day >= range.start && day <= range.end) groups.get(day)!.push(row)
  }
  return groups
}
export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function calendarDates(month: string): string[] {
  const [year, number] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, number - 1, 1))
  return Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(year, number - 1, 1 - first.getUTCDay() + index)).toISOString().slice(0, 10))
}
export function shiftCalendarMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7)
}
