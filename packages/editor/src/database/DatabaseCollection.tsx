import { useEffect, useMemo, useRef, useState } from 'react'
import { SelectField } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import type { EditorOpenLink, DbColumn, DbRow } from '../types'
import type { DatabaseController } from './useDatabaseView'
import { DATABASE_LAYOUTS, DEFAULT_DATABASE_LAYOUT, normalizeDatabaseLayout, searchDatabaseRows, type DatabaseLayout, type DatabaseLayoutMode } from './databaseLayout'
import { DatabaseTable } from './DatabaseTable'
import { DatabaseRowCard } from './DatabaseRowCard'
import { DatabaseBoard } from './DatabaseBoard'
import { DatabaseGantt } from './DatabaseGantt'
import { DatabaseCalendar } from './DatabaseCalendar'
import { DatabaseRowDialog } from './DatabaseRowDialog'
import { DatabaseLayoutIcon } from './DatabaseLayoutIcon'

const layoutLabel = (mode: DatabaseLayoutMode) => ({ table: uiText('표'), cards: uiText('카드'), board: uiText('보드'), calendar: uiText('캘린더'), gantt: uiText('간트') })[mode]
const ADD_START_DATE = '__add-start-date__'
const layoutSelectTrigger = 'flex min-h-8 w-full min-w-0 items-center gap-2 rounded border-0 bg-transparent px-2 text-left text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 pointer-coarse:min-h-10'
function readLayout(id: string | undefined): DatabaseLayout {
  try { return normalizeDatabaseLayout(JSON.parse(scopedBrowserStorage().getItem(`mew:db-layout:${id}`) ?? 'null')) }
  catch { return { ...DEFAULT_DATABASE_LAYOUT } }
}

export function DatabaseCollection({ ctrl, initialLayout, onLayoutChange, onOpenPage, onConvertToTable }: {
  ctrl: DatabaseController; initialLayout?: DatabaseLayout; onLayoutChange?: (layout: DatabaseLayout) => void; onOpenPage?: EditorOpenLink; onConvertToTable?: () => void
}) {
  const locale = useUiLocale(), view = ctrl.view
  const [layout, setLayout] = useState(() => initialLayout ? normalizeDatabaseLayout(initialLayout) : readLayout(view?.id))
  const latestLayout = useRef(layout); latestLayout.current = layout
  const [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<string | null>(null), [creating, setCreating] = useState(false)
  const [addingStartDate, setAddingStartDate] = useState(false)
  const serialized = JSON.stringify(initialLayout)
  useEffect(() => { setLayout(serialized ? normalizeDatabaseLayout(JSON.parse(serialized)) : readLayout(view?.id)) }, [serialized, view?.id])
  const rows = useMemo(() => searchDatabaseRows(view?.rows ?? [], query, locale), [view?.rows, query, locale])
  const columns = view?.columns ?? [], primary = columns[0]?.id
  const properties = columns.filter(column => column.id !== primary)
  const fields = layout.visibleFields ? properties.filter(column => layout.visibleFields!.includes(column.id)) : properties.slice(0, 4)
  const groupColumns = columns.filter(column => column.type === 'select' || column.type === 'checkbox')
  const dateColumns = columns.filter(column => column.type === 'date')
  const groupColumn = groupColumns.find(column => column.id === layout.groupColumn) ?? groupColumns[0]
  const dateColumn = dateColumns.find(column => column.id === layout.dateColumn) ?? dateColumns[0]
  const startDateColumn = dateColumns.find(column => column.id === layout.startDateColumn && column.id !== dateColumn?.id)
  const editable = ctrl.editable && !ctrl.changingColumn
  const updateLayout = (next: Partial<DatabaseLayout>) => {
    const value = normalizeDatabaseLayout({ ...latestLayout.current, ...next })
    latestLayout.current = value
    setLayout(value)
    if (onLayoutChange) onLayoutChange(value)
    else if (!initialLayout && view?.id) writeBrowserStorage(`mew:db-layout:${view.id}`, JSON.stringify(value))
  }
  const openRow = (row: DbRow) => setSelectedRow(row.id)
  const openPage: EditorOpenLink | undefined = onOpenPage ? (path, options) => { setSelectedRow(null); onOpenPage(path, options) } : undefined
  const create = async (cells: Record<string, unknown> = {}) => {
    if (!editable || creating) return
    if (!ctrl.createRow) { ctrl.addRow(); return }
    setCreating(true)
    try { const row = await ctrl.createRow(cells); if (row) setSelectedRow(row.id) }
    finally { setCreating(false) }
  }
  const move = (row: DbRow, column: DbColumn, value: unknown) => {
    if (!editable) return
    ctrl.localCell(row.id, column.id, value)
    ctrl.commitCell(row.id, column.id, value)
  }
  const chooseStartDate = async (value: string) => {
    if (value !== ADD_START_DATE) { updateLayout({ startDateColumn: value || undefined }); return }
    if (!editable || addingStartDate) return
    setAddingStartDate(true)
    try {
      const column = await ctrl.addColumn('date', uiText('시작일'))
      if (column) updateLayout({ startDateColumn: column.id })
    } finally { setAddingStartDate(false) }
  }
  const dated = layout.mode === 'calendar' || layout.mode === 'gantt'
  const configuring = layout.mode === 'board' || dated || layout.mode === 'cards'
  const toolbar = <div className="[contain:inline-size]">
    <div className="flex min-w-0 items-center gap-1 px-1.5">
      <div role="tablist" aria-label={uiText('데이터베이스 뷰')} className="flex min-w-0 flex-1 gap-0.5" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const index = DATABASE_LAYOUTS.indexOf(layout.mode)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? DATABASE_LAYOUTS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : DATABASE_LAYOUTS.length - 1)) % DATABASE_LAYOUTS.length
        updateLayout({ mode: DATABASE_LAYOUTS[next] })
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
      }}>
        {DATABASE_LAYOUTS.map(mode => <button type="button" role="tab" key={mode} aria-label={layoutLabel(mode)} aria-selected={layout.mode === mode} tabIndex={layout.mode === mode ? 0 : -1} data-tip={layoutLabel(mode)} onClick={() => updateLayout({ mode })}
          className={`relative flex min-h-9 shrink-0 items-center gap-1.5 px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-10 ${layout.mode === mode ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent' : 'text-ink-muted hover:text-ink'}`}>
          <DatabaseLayoutIcon kind={mode} size={14} /><span className="hidden @min-[480px]/db:inline">{layoutLabel(mode)}</span>
        </button>)}
      </div>
      {query && <span role="status" className="text-[10px] tabular-nums text-ink-muted">{rows.length}/{view?.rows.length ?? 0}</span>}
      <button type="button" aria-label={uiText('검색')} aria-expanded={searchOpen} data-tip={uiText('검색')} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setQuery('') }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent ${searchOpen ? 'text-accent' : 'text-ink-muted'}`}><DatabaseLayoutIcon kind="search" size={14} /></button>
    </div>
    {(searchOpen || configuring) && <div className="flex min-w-0 flex-wrap items-center gap-2 px-2 py-1.5">
      {searchOpen && <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-surface-raised/20 px-2 focus-within:outline-2 focus-within:outline-accent"><DatabaseLayoutIcon kind="search" size={13} /><input aria-label={uiText('데이터베이스 검색')} placeholder={uiText('검색')} value={query} onChange={event => setQuery(event.target.value)} className="h-8 w-20 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted" /></label>}
      {layout.mode === 'board' && !!groupColumns.length && <SelectField compact label={uiText('그룹 기준')} value={groupColumn.id} options={groupColumns.map(column => ({ value: column.id, label: column.name }))} onChange={groupColumn => updateLayout({ groupColumn })} triggerClassName={layoutSelectTrigger} className="w-36 min-w-0" />}
      {dated && !!dateColumns.length && <>
        <div className="flex min-w-0 items-center gap-1 text-xs text-ink-muted"><span>{uiText('시작일')}</span><SelectField compact label={uiText('시작일')} value={startDateColumn?.id ?? ''} disabled={addingStartDate}
          options={[{ value: '', label: uiText('날짜 없음') }, ...dateColumns.filter(column => column.id !== dateColumn.id).map(column => ({ value: column.id, label: column.name })), ...(editable ? [{ value: ADD_START_DATE, label: uiText('열 추가') }] : [])]}
          onChange={value => { void chooseStartDate(value) }} triggerClassName={layoutSelectTrigger} className="w-28 min-w-0" /></div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-ink-muted"><span>{uiText('종료일')}</span><SelectField compact label={uiText('종료일')} value={dateColumn.id} disabled={addingStartDate}
          options={dateColumns.map(column => ({ value: column.id, label: column.name }))} onChange={dateColumn => updateLayout({ dateColumn, ...(dateColumn === startDateColumn?.id ? { startDateColumn: undefined } : {}) })}
          triggerClassName={layoutSelectTrigger} className="w-28 min-w-0" /></div>
      </>}
      {layout.mode === 'cards' && !!properties.length && <SelectField compact multiple label={uiText('표시 속성')} value={fields.map(field => field.id)} options={properties.map(column => ({ value: column.id, label: column.name }))} onChange={visibleFields => updateLayout({ visibleFields })} triggerContent={<><DatabaseLayoutIcon kind="fields" size={14} /><span>{uiText('표시 속성')}</span></>} triggerClassName={layoutSelectTrigger} className="w-32 min-w-0" />}
    </div>}
  </div>
  const empty = (message: string, action?: () => void, actionLabel?: string) => <div className="flex flex-col items-center gap-3 px-4 py-9 text-center">
    <span className="text-ink-muted"><DatabaseLayoutIcon kind={layout.mode} size={24} /></span>
    <p className="max-w-xs text-xs leading-relaxed text-ink-muted">{message}</p>
    {action && <button type="button" onClick={action} className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-hover"><DatabaseLayoutIcon kind="plus" size={13} />{actionLabel}</button>}
  </div>
  let content
  if (view && layout.mode === 'cards') content = rows.length ? <div className="grid gap-3 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 264px), 1fr))' }}>{rows.map(row => <DatabaseRowCard key={row.id} row={row} columns={columns} fields={fields} onOpen={openRow} onOpenPage={openPage} databaseId={view.id} />)}</div> : empty(uiText('항목 없음'))
  if (view && layout.mode === 'board') content = groupColumn ? <DatabaseBoard view={view} rows={rows} column={groupColumn} fields={fields} editable={editable} busy={creating} onOpen={openRow} onOpenPage={openPage} onCreate={cells => { void create(cells) }} onMove={move} /> : empty(uiText('선택 또는 체크박스 열을 추가해 항목을 그룹으로 나누세요.'), editable ? () => ctrl.addColumn('select') : undefined, uiText('선택 열 추가'))
  if (view && layout.mode === 'calendar') content = dateColumn ? <DatabaseCalendar view={view} rows={rows} column={dateColumn} startColumn={startDateColumn} editable={editable} busy={creating} onOpen={openRow} onCreate={cells => { void create(cells) }} /> : empty(uiText('날짜 열을 추가하면 항목을 캘린더에 표시할 수 있습니다.'), editable ? () => ctrl.addColumn('date') : undefined, uiText('날짜 열 추가'))
  if (view && layout.mode === 'gantt') content = dateColumn ? <DatabaseGantt view={view} rows={rows} column={dateColumn} startColumn={startDateColumn} editable={editable} onOpen={openRow} onMove={move} /> : empty(uiText('날짜 열을 추가하면 항목을 간트에 표시할 수 있습니다.'), editable ? () => ctrl.addColumn('date') : undefined, uiText('날짜 열 추가'))
  const selected = selectedRow ? view?.rows.find(row => row.id === selectedRow) : undefined
  return <>
    <DatabaseTable ctrl={ctrl} onOpenPage={openPage} toolbar={toolbar} content={content} wide={layout.mode !== 'table'} visibleRows={rows} onAddRow={layout.mode === 'table' ? undefined : () => { void create() }} onConvertToTable={onConvertToTable} />
    {selected && <DatabaseRowDialog key={selected.id} ctrl={ctrl} row={selected} onClose={() => setSelectedRow(null)} onOpenPage={openPage} dateColumns={dated && dateColumn ? { start: startDateColumn, end: dateColumn } : undefined} />}
  </>
}
