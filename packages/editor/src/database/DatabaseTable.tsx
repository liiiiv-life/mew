import { ActionMenu, ActionMenuItem, ActionMenuSeparator, canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// /db 표의 프레젠테이션 — 서버 연동은 useDatabaseView(controller)가 넘겨주고, 여기선 렌더만 한다.
// TipTap을 모르므로 노드뷰(DatabaseView)와 독립 팝업(DatabasePanel)이 그대로 재사용한다.
import { useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import type { EditorOpenLink, DbColumn, DbColumnType, DbRow } from '../types'
import { FrontmatterSelect } from '../editor/FrontmatterSelect'
import { Check } from '../editor/FrontmatterFieldMenu'
import { ADD_TYPES, TYPE_LABELS, type DatabaseController } from './useDatabaseView'
import { sortDatabaseRows, type DbSort } from './databaseSort'
import { DatabaseLayoutIcon } from './DatabaseLayoutIcon'

type TypeMenu = { columnId: string; x: number; y: number; trigger: HTMLElement }

export function DatabaseTable({ ctrl, onOpenPage, toolbar, content, wide = false, visibleRows, onAddRow, onConvertToTable }: { ctrl: DatabaseController; onOpenPage?: EditorOpenLink; toolbar?: ReactNode; content?: ReactNode; wide?: boolean; visibleRows?: DbRow[]; onAddRow?: () => void; onConvertToTable?: () => void }) {
  const locale = useUiLocale()
  const { view, loading, error, editable } = ctrl
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; trigger: HTMLElement } | null>(null)
  const [typeMenu, setTypeMenu] = useState<TypeMenu | null>(null)
  const [convertMenu, setConvertMenu] = useState<{ x: number; y: number; trigger: HTMLElement } | null>(null)
  const [sort, setSort] = useState<(DbSort & { databaseId: string }) | null>(null)
  const activeSort = sort?.databaseId === view?.id ? sort : null
  const sortColumn = view?.columns.find(column => column.id === activeSort?.columnId)
  const rows = useMemo(() => sortDatabaseRows(visibleRows ?? view?.rows ?? [], sortColumn, activeSort, locale), [visibleRows, view?.rows, sortColumn, activeSort, locale])
  const typeColumn = view?.columns.find(col => col.id === typeMenu?.columnId)
  const primaryColumn = view?.kind === 'managed' ? view.columns[0]?.id : undefined
  const typeChoices: DbColumnType[] = typeColumn?.id === primaryColumn ? ['text', 'page'] : ADD_TYPES

  return (
    <div data-db-surface style={toolbar && !wide ? { minWidth: 'min(100%, 208px)' } : undefined} className={`min-w-0 max-w-full ${wide ? '@container/db w-full' : 'w-fit'}`}
      onContextMenu={event => {
        if (!onConvertToTable) return
        event.preventDefault(); event.stopPropagation(); setTypeMenu(null); setAddMenu(null)
        setConvertMenu({ x: event.clientX, y: event.clientY, trigger: event.target as HTMLElement })
      }}
      onKeyDown={event => {
        if (!onConvertToTable || !(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) return
        event.preventDefault(); event.stopPropagation()
        const trigger = event.target as HTMLElement, rect = trigger.getBoundingClientRect()
        setTypeMenu(null); setAddMenu(null); setConvertMenu({ x: rect.left, y: rect.bottom, trigger })
      }}>
      {/* 헤더: 원통 아이콘 + 제목 + 배지 + 행 수 */}
      <div className="flex items-center gap-1.5 px-2 py-1 [contain:inline-size]">
        <DbGlyph className="shrink-0 text-ink-muted" />
        {editable ? (
          <input
            value={view?.title ?? ''}
            onChange={(e) => ctrl.setTitleDraft(e.target.value)}
            onBlur={(e) => ctrl.renameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            placeholder={uiText("제목 없음")}
            className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold text-ink outline-none hover:bg-surface focus:bg-surface"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{view?.title ?? uiText("데이터베이스")}</span>
        )}
        {view && !editable && (
          <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
            {view.kind === 'external' ? uiText("외부 · 읽기 전용") : uiText("참조 · 읽기 전용")}
          </span>
        )}
        {view && view.rows.length > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{uiText("{count}개 행", { count: view.rows.length })}</span>
        )}
      </div>

      {toolbar}

      {error && view && <div role="alert" className="select-text px-2 py-1 text-xs text-danger-strong">{error}</div>}

      {loading ? (
        <div className="px-2 py-4 text-center text-xs text-ink-muted">{uiText("불러오는 중…")}</div>
      ) : error && !view ? (
        <div className="select-text px-2 py-4 text-center text-xs text-danger-strong">{error}</div>
      ) : !view ? (
        <div className="px-2 py-4 text-center text-xs text-ink-muted">{uiText("데이터베이스를 찾을 수 없습니다")}</div>
      ) : content ? content : (
        <div data-db-grid className="w-fit max-w-full overflow-x-auto rounded-md border border-edge-strong bg-surface-deep">
          <table className="mew-database-table w-max max-w-none border-collapse whitespace-nowrap text-sm">
            <thead className="bg-surface-raised/20">
              <tr className="border-b border-edge-strong">
                {view.columns.map((col) => (
                  <ColumnHeader
                    key={col.id}
                    col={col}
                    editable={editable}
                    primary={col.id === primaryColumn}
                    sortDirection={activeSort?.columnId === col.id ? activeSort.direction : undefined}
                    onSort={() => setSort(activeSort?.columnId !== col.id ? { databaseId: view.id, columnId: col.id, direction: 'ascending' }
                      : activeSort.direction === 'ascending' ? { ...activeSort, direction: 'descending' } : null)}
                    onTypeMenu={(trigger) => {
                      const rect = trigger.getBoundingClientRect()
                      setTypeMenu({ columnId: col.id, x: rect.left, y: rect.bottom + 4, trigger })
                    }}
                    onRename={(name) => ctrl.renameColumn(col.id, name)}
                    onDelete={() => ctrl.deleteColumn(col.id)}
                  />
                ))}
                {editable && (
                  <th className="w-10 p-0 align-middle">
                    <button type="button" aria-label={uiText("열 추가")} data-tip={uiText("열 추가")}
                      disabled={!!ctrl.changingColumn}
                      onClick={event => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        setAddMenu({ x: rect.left, y: rect.bottom + 4, trigger: event.currentTarget })
                      }}
                      className="flex h-full w-full items-center justify-center py-1.5 text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
                      <PlusIcon />
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-edge-strong last:border-b-0 hover:bg-surface">
                  {view.columns.map((col) => (
                    <td key={col.id} className="border-r border-edge-strong p-0 align-top last:border-r-0"
                      onContextMenu={event => {
                        if (!editable || ctrl.changingColumn) return
                        event.preventDefault(); event.stopPropagation()
                        const trigger = (event.target as Element).closest<HTMLElement>('input, button, [tabindex]') ?? event.currentTarget
                        setTypeMenu({ columnId: col.id, x: event.clientX, y: event.clientY, trigger })
                      }}
                      onKeyDown={event => {
                        if (!editable || ctrl.changingColumn || !(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) return
                        event.preventDefault(); event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setTypeMenu({ columnId: col.id, x: rect.left, y: rect.bottom, trigger: event.target as HTMLElement })
                      }}>
                      <DatabaseCell
                        col={col}
                        row={row}
                        editable={editable && !ctrl.changingColumn}
                        primary={col.id === primaryColumn}
                        onOpenPage={onOpenPage}
                        onOptions={options => ctrl.updateColumnOptions(col.id, options)}
                        onEditOption={(option, edit) => ctrl.editColumnOption(col.id, option, edit)}
                        onLocal={(value) => ctrl.localCell(row.id, col.id, value)}
                        onCommit={(value) => ctrl.commitCell(row.id, col.id, value)}
                      />
                    </td>
                  ))}
                  {editable && <td />}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={view.columns.length + (editable ? 1 : 0)}
                    className="px-2 py-3 text-center text-xs text-ink-muted"
                  >
                    {uiText("아직 행이 없습니다")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view && editable && (
        <button
          type="button"
          disabled={!!ctrl.changingColumn}
          onClick={onAddRow ?? ctrl.addRow}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-surface hover:text-ink"
        >
          <PlusIcon />
          {uiText("행 추가")}</button>
      )}
      {editable && addMenu && <ActionMenu {...addMenu} label={uiText('열 추가')} onClose={() => setAddMenu(null)}>
        {ADD_TYPES.map(type => <ActionMenuItem key={type} icon={<TypeIcon type={type} />} onClick={() => ctrl.addColumn(type)}>{TYPE_LABELS[type]}</ActionMenuItem>)}
      </ActionMenu>}
      {editable && typeMenu && typeColumn && <ActionMenu {...typeMenu} label={uiText('열 타입 변경')} onClose={() => setTypeMenu(null)}>
        {typeChoices.map(type => <ActionMenuItem key={type} checked={typeColumn.type === type} disabled={!!ctrl.changingColumn}
          icon={<TypeIcon type={type} />} hint={<Check checked={typeColumn.type === type} />}
          onClick={() => { if (type !== typeColumn.type) ctrl.changeColumnType(typeColumn.id, type) }}>{TYPE_LABELS[type]}</ActionMenuItem>)}
        {onConvertToTable && <><ActionMenuSeparator /><ActionMenuItem icon={<DatabaseLayoutIcon kind="table" />} disabled={!!ctrl.changingColumn} onClick={onConvertToTable}>{uiText('표로 전환')}</ActionMenuItem></>}
      </ActionMenu>}
      {convertMenu && onConvertToTable && <ActionMenu {...convertMenu} onClose={() => setConvertMenu(null)}>
        <ActionMenuItem icon={<DatabaseLayoutIcon kind="table" />} disabled={!!ctrl.changingColumn} onClick={onConvertToTable}>{uiText('표로 전환')}</ActionMenuItem>
      </ActionMenu>}
    </div>
  )
}

function ColumnHeader({
  col,
  editable,
  onRename,
  onDelete,
  primary,
  onTypeMenu,
  sortDirection,
  onSort,
}: {
  col: DbColumn
  editable: boolean
  onRename: (name: string) => void
  onDelete: () => void
  primary: boolean
  onTypeMenu: (trigger: HTMLElement) => void
  sortDirection?: DbSort['direction']
  onSort: () => void
}) {
  useUiLocale()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(col.name)

  const sortLabel = sortDirection === 'ascending' ? uiText('{p0} 내림차순 정렬', { p0: col.name })
    : sortDirection === 'descending' ? uiText('{p0} 정렬 해제', { p0: col.name }) : uiText('{p0} 오름차순 정렬', { p0: col.name })

  if (renaming) {
    return (
      <th aria-sort={sortDirection ?? 'none'} className="border-r border-edge-strong p-0 last:border-r-0">
        <ContentSizedInput
          autoFocus={canAutoFocusInput()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setRenaming(false)
            if (draft !== col.name) onRename(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              // 여기서 멈추지 않으면 오버레이 스택까지 올라가 사이드바·터미널이 같이 닫힌다
              e.stopPropagation()
              setDraft(col.name)
              setRenaming(false)
            }
          }}
          className="bg-surface-hover px-2 py-1.5 text-xs font-medium text-ink outline-none"
        />
      </th>
    )
  }

  return (
    <th aria-sort={sortDirection ?? 'none'} className="group/col border-r border-edge-strong px-2 py-1.5 text-left align-middle last:border-r-0">
      <div className="flex items-center justify-between gap-1">
        <button type="button" disabled={!editable} aria-label={uiText('{p0} 열 타입 변경', { p0: col.name })}
          data-tip={TYPE_LABELS[col.type]} onClick={event => onTypeMenu(event.currentTarget)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default pointer-coarse:h-8 pointer-coarse:w-8">
          <TypeIcon type={col.type} />
        </button>
        <button
          type="button"
          disabled={!editable}
          onClick={() => {
            if (editable) {
              setDraft(col.name)
              setRenaming(true)
            }
          }}
          className="flex min-w-0 flex-1 items-center disabled:cursor-default"
          title={editable ? uiText("이름 변경") : col.name}
        >
          <span className="truncate text-xs font-medium text-ink-secondary">{col.name}</span>
        </button>
        {editable && !primary && (
          <button
            type="button"
            title={uiText("열 삭제")}
            onClick={onDelete}
            className="text-ink-muted opacity-0 transition-opacity hover:text-danger-strong group-hover/col:opacity-100"
          >
            ×
          </button>
        )}
        <button type="button" aria-label={sortLabel} data-tip={sortLabel} onClick={onSort}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:h-8 pointer-coarse:w-8 ${sortDirection ? 'text-accent' : 'text-ink-muted'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={sortDirection === 'ascending' ? 'M12 20V4m-5 5 5-5 5 5' : sortDirection === 'descending' ? 'M12 4v16m-5-5 5 5 5-5' : 'M8 20V4m-4 4 4-4 4 4M16 4v16m-4-4 4 4 4-4'} />
          </svg>
        </button>
      </div>
    </th>
  )
}

export function DatabaseCell({
  col,
  row,
  editable,
  onLocal,
  onCommit,
  primary,
  onOpenPage,
  onOptions,
  onEditOption,
}: {
  col: DbColumn
  row: DbRow
  editable: boolean
  onLocal: (value: unknown) => void
  onCommit: (value: unknown) => void
  primary: boolean
  onOpenPage?: EditorOpenLink
  onOptions: (options: string[]) => Promise<boolean>
  onEditOption: (option: string, edit: { name?: string; hue?: number; remove?: boolean }) => Promise<boolean>
}) {
  useUiLocale()
  const value = row.cells[col.id]
  const [savingOption, setSavingOption] = useState(false)

  if (col.type === 'select' || col.type === 'multi_select') {
    const selected = col.type === 'multi_select' ? Array.isArray(value) ? value.filter(v => typeof v === 'string') : value == null ? [] : [String(value)] : value == null ? '' : String(value)
    return <div className="w-max min-w-full px-1 py-0.5">
      <FrontmatterSelect field={{ key: col.name, type: col.type === 'multi_select' ? 'multi-select' : 'select',
        options: col.options, optionColors: col.optionColors, value: Array.isArray(selected) ? JSON.stringify(selected) : selected }}
        onEditOption={onEditOption}
        readOnly={!editable} busy={savingOption}
        onChange={next => {
          const saved = col.type === 'multi_select' ? JSON.parse(next) : next || null
          onLocal(saved); onCommit(saved)
        }}
        onCreate={async field => {
          setSavingOption(true)
          try {
            if (!await onOptions(field.options ?? [])) return false
            const next = col.type === 'multi_select' ? JSON.parse(field.value) : field.value
            onLocal(next); onCommit(next)
            return true
          } finally { setSavingOption(false) }
        }} />
    </div>
  }

  if (col.type === 'page') {
    return <div className="flex w-max min-w-full items-center">
      <button type="button" disabled={!row.pagePath || !onOpenPage}
        aria-label={uiText('{p0} 페이지 열기', { p0: value == null ? '' : String(value) })}
        data-tip={uiText('페이지 열기')} onClick={event => { if (row.pagePath) onOpenPage?.(row.pagePath, { newTab: event.ctrlKey || event.metaKey }) }}
        className={`flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-link hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:text-ink-muted ${editable ? 'shrink-0' : 'flex-1'}`}>
        <TypeIcon type="page" />{!editable && <span className="truncate">{value == null ? '' : String(value)}</span>}
      </button>
      {editable && <ContentSizedInput fill={false} aria-label={col.name} required value={value == null ? '' : String(value)}
        onChange={event => onLocal(event.target.value)} onBlur={event => onCommit(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }}
        className="bg-transparent py-1.5 pr-2 text-sm text-ink outline-none focus:bg-surface" />}
    </div>
  }

  if (col.type === 'checkbox') {
    return (
      <div className="flex items-center justify-center py-1.5">
        <input
          type="checkbox"
          aria-label={col.name}
          className="accent-accent"
          checked={value === true}
          disabled={!editable}
          onChange={(e) => {
            onLocal(e.target.checked) // 낙관적 갱신 — 실시간 에코가 서버 값으로 확정한다
            onCommit(e.target.checked)
          }}
        />
      </div>
    )
  }

  if (!editable) {
    return <div className="select-text min-h-8 px-2 py-1.5 text-sm text-ink">{value == null ? '' : String(value)}</div>
  }

  const inputType = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'
  return (
    <ContentSizedInput
      type={inputType}
      aria-label={col.name}
      required={primary}
      value={value == null ? '' : String(value)}
      onChange={(e) => onLocal(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur()
      }}
      className="bg-transparent px-2 py-1.5 text-sm text-ink outline-none focus:bg-surface"
    />
  )
}

function ContentSizedInput({ value, type = 'text', className, fill = true, ...props }: InputHTMLAttributes<HTMLInputElement> & { fill?: boolean }) {
  const nativeControl = type === 'number' || type === 'date'
  return <span className={`relative block w-max ${fill ? 'min-w-full' : 'shrink-0'}`}>
    <span aria-hidden="true" className={`invisible block whitespace-pre ${className ?? ''}`}>
      <span className={nativeControl ? 'pr-5' : undefined}>{String(value ?? '') || (type === 'date' ? '0000-00-00' : '\u00a0')}</span>
    </span>
    <input {...props} type={type} value={value} className={`absolute inset-0 h-full w-full min-w-0 ${className ?? ''}`} />
  </span>
}

export function TypeIcon({ type }: { type: DbColumnType }) {
  const paths: Record<DbColumnType, string> = {
    text: 'M4 5h16M12 5v14M8 19h8',
    number: 'M9 3 7 21M17 3l-2 18M4 9h16M3 15h16',
    checkbox: 'm8 12 3 3 5-6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
    date: 'M8 3v4M16 3v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
    select: 'M5 9h14l-7 7-7-7Z',
    multi_select: 'm3 6 2 2 3-4M11 6h10M3 12h4M11 12h10M3 18h4M11 18h10',
    page: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6M8 13h8M8 17h5',
  }
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d={paths[type]} /></svg>
}

// 데이터베이스를 상징하는 원통(cylinder) 아이콘 — 헤더·팝업 목록에서 공유한다
export function DbGlyph({ className, size = 15 }: { className?: string; size?: number }) {
  useUiLocale()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M20 5v6c0 1.66-3.58 3-8 3s-8-1.34-8-3V5" />
      <path d="M20 11v6c0 1.66-3.58 3-8 3s-8-1.34-8-3v-6" />
    </svg>
  )
}

function PlusIcon() {
  useUiLocale()
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
