import type { DbColumn, DbRow } from '../types'

export type DbSort = { columnId: string; direction: 'ascending' | 'descending' }

export function sortDatabaseRows(rows: DbRow[], column: DbColumn | undefined, sort: DbSort | null, locale?: string): DbRow[] {
  if (!column || !sort) return rows
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  const text = (value: unknown) => Array.isArray(value) ? value.join(', ') : String(value)
  const empty = (value: unknown) => value == null || value === '' || Array.isArray(value) && !value.length
  return [...rows].sort((a, b) => {
    const left = a.cells[column.id], right = b.cells[column.id]
    if (empty(left) || empty(right)) return Number(empty(left)) - Number(empty(right))
    let comparison: number
    if (column.type === 'number' && Number.isFinite(Number(left)) && Number.isFinite(Number(right))) comparison = Number(left) - Number(right)
    else if (column.type === 'checkbox') comparison = Number(left === true || left === 'true') - Number(right === true || right === 'true')
    else if (column.type === 'date' && Number.isFinite(Date.parse(String(left))) && Number.isFinite(Date.parse(String(right)))) comparison = Date.parse(String(left)) - Date.parse(String(right))
    else comparison = collator.compare(text(left), text(right))
    return sort.direction === 'ascending' ? comparison : -comparison
  })
}
