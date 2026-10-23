import { useId } from 'react'
import { DateCalendar, DialogFrame, useDialog } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import type { EditorOpenLink, DbColumn, DbRow } from '../types'
import type { DatabaseController } from './useDatabaseView'
import { databaseRowTitle, dateKey } from './databaseLayout'
import { DatabaseCell, TypeIcon } from './DatabaseTable'
import { DatabaseLayoutIcon } from './DatabaseLayoutIcon'

export function DatabaseRowDialog({ ctrl, row, onClose, onOpenPage, dateColumns }: { ctrl: DatabaseController; row: DbRow; onClose: () => void; onOpenPage?: EditorOpenLink; dateColumns?: { start?: DbColumn; end: DbColumn } }) {
  const id = useId(), dialogs = useDialog(), view = ctrl.view!
  const title = databaseRowTitle(row, view.columns) || uiText('제목 없음')
  const editable = ctrl.editable && !ctrl.changingColumn
  const changeDates = (start: string | null, end: string | null) => {
    if (!editable || !dateColumns) return
    const changes: [DbColumn, string | null][] = dateColumns.start ? [[dateColumns.start, start], [dateColumns.end, end]] : [[dateColumns.end, start]]
    for (const [column, value] of changes) if ((row.cells[column.id] ?? null) !== value) {
      ctrl.localCell(row.id, column.id, value)
      ctrl.commitCell(row.id, column.id, value)
    }
  }
  return <>
    <DialogFrame labelledBy={id} onClose={onClose} className="max-w-xl max-h-[85dvh] overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <DatabaseLayoutIcon kind="page" />
        <h2 id={id} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{title}</h2>
        {row.pagePath && onOpenPage && <button type="button" onClick={event => onOpenPage(row.pagePath!, { newTab: event.ctrlKey || event.metaKey })} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover"><DatabaseLayoutIcon kind="page" size={14} />{uiText('페이지 열기')}</button>}
        <button type="button" aria-label={uiText('닫기')} data-tip={uiText('닫기')} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><DatabaseLayoutIcon kind="close" /></button>
      </header>
      {ctrl.error && <p role="alert" className="border-b border-edge px-4 py-2 text-xs text-danger-strong">{ctrl.error}</p>}
      <div className="px-4 py-2">{view.columns.map((column, index) => column.id === dateColumns?.start?.id || column.id === dateColumns?.end.id ? null : <div key={column.id} className="grid grid-cols-[minmax(80px,120px)_minmax(0,1fr)] items-start gap-3 border-b border-edge/50 py-2 last:border-b-0">
        <div className="flex min-w-0 items-center gap-2 py-1.5 text-xs text-ink-muted"><TypeIcon type={column.type} /><span className="break-words">{column.name}</span></div>
        <div className="min-w-0 overflow-x-auto rounded border border-edge bg-surface-deep"><DatabaseCell col={column} row={row} editable={ctrl.editable && !ctrl.changingColumn} primary={index === 0} onOpenPage={onOpenPage}
          onLocal={value => ctrl.localCell(row.id, column.id, value)} onCommit={value => ctrl.commitCell(row.id, column.id, value)}
          onOptions={options => ctrl.updateColumnOptions(column.id, options)} onEditOption={(option, edit) => ctrl.editColumnOption(column.id, option, edit)} /></div>
      </div>)}</div>
      {dateColumns && <div className="mx-auto w-full max-w-xs px-4 pb-3"><DateCalendar
        start={dateKey(row.cells[dateColumns.start?.id ?? dateColumns.end.id])}
        end={dateColumns.start ? dateKey(row.cells[dateColumns.end.id]) : null}
        single={!dateColumns.start} readOnly={!editable} onChange={changeDates} />
      </div>}
      {ctrl.editable && <footer className="flex justify-end border-t border-edge px-4 py-2"><button type="button" className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-ink-muted hover:bg-danger-strong/10 hover:text-danger-strong focus-visible:outline-2 focus-visible:outline-accent" onClick={async () => {
        if (await dialogs.confirm({ message: uiText('항목을 삭제할까요?'), detail: title, danger: true, confirmLabel: uiText('삭제') })) ctrl.deleteRow(row.id)
      }}><DatabaseLayoutIcon kind="trash" size={14} />{uiText('행 삭제')}</button></footer>}
    </DialogFrame>
    {dialogs.dialog}
  </>
}
