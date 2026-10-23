export type DatabaseTableData = { columns: string[]; rows: string[][] }
export class DatabaseTableError extends Error {}

/** Validate the entire snapshot before creating a database; retain every original cell. */
export function prepareDatabaseTable(value: unknown): DatabaseTableData {
  const input = value as Partial<DatabaseTableData> | null
  if (!input || !Array.isArray(input.columns) || !input.columns.length || input.columns.length > 200
    || input.columns.some(name => typeof name !== 'string' || name.includes('\0'))
    || !Array.isArray(input.rows) || input.rows.length > 10_000
    || input.rows.some(row => !Array.isArray(row) || row.length !== input.columns!.length || row.some(cell => typeof cell !== 'string' || cell.includes('\0')))) {
    throw new DatabaseTableError('표 데이터가 올바르지 않습니다 (최대 200열·10,000행)')
  }
  const rows = input.rows.map(row => [...row])
  const primaryValues = rows.map(row => row[0])
  const extraPrimary = primaryValues.some(value => !value.trim()) || new Set(primaryValues).size !== primaryValues.length
  const names = extraPrimary ? ['제목', ...input.columns] : input.columns
  const used = new Set<string>(), reserved = new Set(['title', '_mew_database', '_mew_row', '상위파일'])
  const columns = names.map((name, index) => {
    const base = name.trim() || `열 ${index + 1}`
    let next = base, suffix = 2
    while (used.has(next) || index > 0 && reserved.has(next)) next = `${base} (${suffix++})`
    used.add(next)
    return next
  })
  return { columns, rows: extraPrimary ? rows.map((row, index) => [`항목 ${index + 1}`, ...row]) : rows }
}
