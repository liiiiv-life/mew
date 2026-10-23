const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const days: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
function parts(field: string, min: number, max: number, names: Record<string, number> = {}): { start: number; end: number; step: number }[] | null {
  const number = (text: string) => names[text.toLowerCase()] ?? (/^\d+$/.test(text) ? Number(text) : NaN)
  const result = []
  for (const part of field.split(',')) {
    const [range, stepText, extra] = part.split('/'), step = stepText === undefined ? 1 : Number(stepText)
    if (extra !== undefined || stepText !== undefined && !/^\d+$/.test(stepText) || !Number.isInteger(step) || step <= 0) return null
    const [startText, endText, extraRange] = range.split('-')
    if (extraRange !== undefined) return null
    const start = range === '*' ? min : number(startText), end = range === '*' ? max : endText === undefined ? stepText === undefined ? start : max : number(endText)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null
    result.push({ start, end, step })
  }
  return result
}
const matches = (values: { start: number; end: number; step: number }[], value: number) => values.some(({ start, end, step }) => value >= start && value <= end && (value - start) % step === 0)
function parse(expression: string) {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dom, month, dow] = fields
  const values = [parts(minute, 0, 59), parts(hour, 0, 23), parts(dom, 1, 31), parts(month, 1, 12, months), parts(dow, 0, 7, days)]
  return values.some(value => value === null) ? null : { fields, values: values as NonNullable<ReturnType<typeof parts>>[] }
}
export const validCron = (expression: string): boolean => parse(expression) !== null
export function cronMatches(expression: string, date = new Date()): boolean {
  const cron = parse(expression)
  if (!cron) return false
  const [minute, hour, dom, month, dow] = cron.values
  const day = matches(dom, date.getDate()), week = matches(dow, date.getDay()) || date.getDay() === 0 && matches(dow, 7)
  const daysMatch = cron.fields[2].startsWith('*') || cron.fields[4].startsWith('*') ? day && week : day || week
  return matches(minute, date.getMinutes()) && matches(hour, date.getHours()) && matches(month, date.getMonth() + 1) && daysMatch
}
