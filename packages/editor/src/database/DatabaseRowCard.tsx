import type { DragEvent } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { optionHue } from '../../../../shared/selection-options'
import { FrontmatterTag } from '../editor/FrontmatterTag'
import type { EditorOpenLink, DbColumn, DbRow } from '../types'
import { databaseRowTitle, dateKey } from './databaseLayout'
import { DatabaseLayoutIcon } from './DatabaseLayoutIcon'

export const DATABASE_ROW_DRAG = 'application/x-mew-database-row'
export function DatabasePropertyValue({ column, value }: { column: DbColumn; value: unknown }) {
  const locale = useUiLocale()
  if (value == null || value === '' || Array.isArray(value) && !value.length) return <span className="text-ink-muted">—</span>
  if (column.type === 'select' || column.type === 'multi_select') return <span className="flex min-w-0 flex-wrap gap-1">{(Array.isArray(value) ? value : [value]).map(item => <FrontmatterTag key={String(item)} hue={optionHue(String(item), column.optionColors)}>{String(item)}</FrontmatterTag>)}</span>
  if (column.type === 'checkbox') return <span className="text-ink-secondary">{value === true || value === 'true' ? uiText('완료') : uiText('미완료')}</span>
  if (column.type === 'number' && Number.isFinite(Number(value))) return <span className="tabular-nums">{new Intl.NumberFormat(locale).format(Number(value))}</span>
  if (column.type === 'date' && dateKey(value)) return <span className="tabular-nums">{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateKey(value)}T12:00:00Z`))}</span>
  return <span className="line-clamp-2 break-words">{Array.isArray(value) ? value.join(', ') : String(value)}</span>
}

export function DatabaseRowCard({ row, columns, fields, onOpen, onOpenPage, draggable = false, databaseId }: {
  row: DbRow; columns: DbColumn[]; fields: DbColumn[]; onOpen: (row: DbRow) => void; onOpenPage?: EditorOpenLink; draggable?: boolean; databaseId: string
}) {
  const title = databaseRowTitle(row, columns) || uiText('제목 없음')
  const preview = fields.find(column => column.type === 'text' && row.cells[column.id])
  const details = fields.filter(column => column !== preview)
  const drag = (event: DragEvent) => {
    event.dataTransfer.setData(DATABASE_ROW_DRAG, JSON.stringify({ databaseId, rowId: row.id }))
    event.dataTransfer.effectAllowed = 'move'
  }
  return <article data-db-card={row.id} className="group/card relative min-w-0 rounded-md bg-surface-raised/20 transition-colors hover:bg-surface-raised/40" draggable={draggable} onDragStart={drag}>
    <button type="button" onClick={() => onOpen(row)} aria-label={uiText('항목 열기: {p0}', { p0: title })}
      className="flex h-full w-full min-w-0 flex-col gap-3 rounded-md p-3 text-left focus-visible:outline-2 focus-visible:outline-accent">
      <span className={`block w-full break-words text-sm font-semibold leading-snug text-ink ${row.pagePath && onOpenPage ? 'pr-6' : ''}`}>{title}</span>
      {preview && <span className="line-clamp-3 break-words text-xs leading-relaxed text-ink-secondary">{String(row.cells[preview.id])}</span>}
      {!!details.length && <span className="mt-auto flex w-full min-w-0 flex-col gap-2">{details.map(column => <span key={column.id} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-start gap-2 text-xs text-ink-secondary"><span className="truncate text-ink-muted">{column.name}</span><DatabasePropertyValue column={column} value={row.cells[column.id]} /></span>)}</span>}
    </button>
    {row.pagePath && onOpenPage && <button type="button" aria-label={uiText('페이지 열기')} data-tip={uiText('페이지 열기')} onClick={event => onOpenPage(row.pagePath!, { newTab: event.ctrlKey || event.metaKey })} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><DatabaseLayoutIcon kind="page" size={14} /></button>}
  </article>
}
