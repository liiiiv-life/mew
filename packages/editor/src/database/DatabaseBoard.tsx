import { useState, type DragEvent, type CSSProperties } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { optionHue } from '../../../../shared/selection-options'
import type { EditorOpenLink, DbColumn, DbRow, DbView } from '../types'
import { groupDatabaseRows } from './databaseLayout'
import { DatabaseRowCard, DATABASE_ROW_DRAG } from './DatabaseRowCard'
import { DatabaseLayoutIcon } from './DatabaseLayoutIcon'

export function DatabaseBoard({ view, rows, column, fields, editable, busy, onOpen, onOpenPage, onCreate, onMove }: {
  view: DbView; rows: DbRow[]; column: DbColumn; fields: DbColumn[]; editable: boolean; busy: boolean
  onOpen: (row: DbRow) => void; onOpenPage?: EditorOpenLink; onCreate: (cells: Record<string, unknown>) => void; onMove: (row: DbRow, column: DbColumn, value: unknown) => void
}) {
  const [over, setOver] = useState<string | null>(null)
  const groups = groupDatabaseRows(rows, column)
  const accepts = (event: DragEvent) => editable && !busy && event.dataTransfer.types.includes(DATABASE_ROW_DRAG)
  return <div className="flex max-w-full gap-3 overflow-x-auto overscroll-x-contain p-3" aria-label={uiText('보드')}>
    {groups.map(group => {
      const label = group.value === null ? uiText('미분류') : column.type === 'checkbox' ? group.value ? uiText('완료') : uiText('미완료') : group.label
      return <section key={group.key} aria-label={label} data-db-group={group.key}
        onDragOver={event => { if (accepts(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(group.key) } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null) }}
        onDrop={event => {
          if (!accepts(event)) return
          event.preventDefault(); setOver(null)
          try {
            const payload = JSON.parse(event.dataTransfer.getData(DATABASE_ROW_DRAG))
            const row = view.rows.find(row => row.id === payload.rowId)
            if (payload.databaseId === view.id && row && row.cells[column.id] !== group.value) onMove(row, column, group.value)
          } catch { /* Ignore unrelated drag payloads. */ }
        }}
        className={`flex w-[258px] shrink-0 flex-col gap-2 rounded-md p-2 transition-colors ${over === group.key ? 'bg-accent/10 outline outline-accent/50' : 'bg-surface-raised/20'}`}>
        <header className="flex items-center gap-2 px-1 pb-1 pt-0.5">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: group.value === null ? 'var(--color-ink-muted)' : `hsl(${optionHue(group.label, column.optionColors)} 60% 58%)` } as CSSProperties} />
          <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{label}</h3>
          <span className="text-[11px] tabular-nums text-ink-muted">{group.rows.length}</span>
          {editable && <button type="button" disabled={busy} onClick={() => onCreate({ [column.id]: group.value })} aria-label={uiText('{p0}에 행 추가', { p0: label })} data-tip={uiText('행 추가')} className="flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-40"><DatabaseLayoutIcon kind="plus" size={14} /></button>}
        </header>
        <div className="flex min-h-16 flex-1 flex-col gap-2">
          {group.rows.map(row => <DatabaseRowCard key={row.id} row={row} columns={view.columns} fields={fields.filter(field => field.id !== column.id)} onOpen={onOpen} onOpenPage={onOpenPage} draggable={editable && !busy} databaseId={view.id} />)}
          {!group.rows.length && <div className="px-3 py-5 text-center text-xs text-ink-muted">{uiText('항목 없음')}</div>}
        </div>
      </section>
    })}
  </div>
}
