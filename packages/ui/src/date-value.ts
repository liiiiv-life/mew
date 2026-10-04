/** Calendar dates have no time or timezone; never convert persisted values to instants. */
export function validDateValue(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const date = dateFromValue(value)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
export function dateFromValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number), date = new Date(0)
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(12, 0, 0, 0)
  return date
}
export function dateValue(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}
export function localToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function shiftDate(value: string, days: number): string {
  const date = dateFromValue(value)
  date.setUTCDate(date.getUTCDate() + days)
  return dateValue(date)
}
/** ISO, dotted/slashed dates, compact YYYYMMDD and M/D in the current local year. */
export function parseDateInput(input: string, today = localToday()): string | null | undefined {
  const text = input.trim()
  if (!text) return null
  let match: string[] | null = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text)
  if (!match) match = /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (!match) {
    const short = /^(\d{1,2})[./-](\d{1,2})$/.exec(text)
    if (short) match = [short[0], today.slice(0, 4), short[1], short[2]]
  }
  if (!match) return undefined
  const value = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return validDateValue(value) ? value : undefined
}
