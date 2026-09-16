// /db 표의 프레젠테이션 — 서버 연동은 useDatabaseView(controller)가 넘겨주고, 여기선 렌더만 한다.
// TipTap을 모르므로 노드뷰(DatabaseView)와 독립 팝업(DatabasePanel)이 그대로 재사용한다.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import type { DbColumn, DbRow } from '../types'
import { ADD_TYPES, TYPE_GLYPH, TYPE_LABELS, type DatabaseController } from './useDatabaseView'

export function DatabaseTable({ ctrl }: { ctrl: DatabaseController }) {
  const { view, loading, error, editable } = ctrl
  const [addColOpen, setAddColOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-lg border border-edge-bright bg-surface-raised">
      {/* 헤더: 원통 아이콘 + 제목 + 배지 + 행 수 */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <DbGlyph className="shrink-0 text-ink-muted" />
        {editable ? (
          <input
            value={view?.title ?? ''}
            onChange={(e) => ctrl.setTitleDraft(e.target.value)}
            onBlur={(e) => ctrl.renameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            placeholder="제목 없음"
            className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold text-ink outline-none hover:bg-surface-hover focus:bg-surface-hover"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{view?.title ?? '데이터베이스'}</span>
        )}
        {view && !editable && (
          <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
            {view.kind === 'external' ? '외부 · 읽기 전용' : '참조 · 읽기 전용'}
          </span>
        )}
        {view && view.rows.length > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{view.rows.length}개 행</span>
        )}
      </div>

      {loading ? (
        <div className="border-t border-edge px-3 py-8 text-center text-xs text-ink-muted">불러오는 중…</div>
      ) : error ? (
        <div className="select-text border-t border-edge px-3 py-8 text-center text-xs text-danger-strong">{error}</div>
      ) : !view ? (
        <div className="border-t border-edge px-3 py-8 text-center text-xs text-ink-muted">데이터베이스를 찾을 수 없습니다</div>
      ) : (
        <div className="overflow-x-auto border-t border-edge">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge">
                {editable && <th className="w-8 border-r border-edge p-0" />}
                {view.columns.map((col) => (
                  <ColumnHeader
                    key={col.id}
                    col={col}
                    editable={editable}
                    onRename={(name) => ctrl.renameColumn(col.id, name)}
                    onDelete={() => ctrl.deleteColumn(col.id)}
                  />
                ))}
                {editable && (
                  <th className="w-10 p-0 align-middle">
                    <AddColumnButton
                      open={addColOpen}
                      onToggle={() => setAddColOpen((v) => !v)}
                      onClose={() => setAddColOpen(false)}
                      onAdd={(t) => ctrl.addColumn(t)}
                    />
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.id} className="group border-b border-edge last:border-b-0 hover:bg-surface-hover">
                  {editable && (
                    <td className="w-8 border-r border-edge text-center align-middle">
                      <button
                        type="button"
                        title="행 삭제"
                        onClick={() => ctrl.deleteRow(row.id)}
                        className="px-1 text-ink-muted opacity-0 transition-opacity hover:text-danger-strong group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </td>
                  )}
                  {view.columns.map((col) => (
                    <td key={col.id} className="border-r border-edge p-0 align-top last:border-r-0">
                      <Cell
                        col={col}
                        row={row}
                        editable={editable}
                        onLocal={(value) => ctrl.localCell(row.id, col.id, value)}
                        onCommit={(value) => ctrl.commitCell(row.id, col.id, value)}
                      />
                    </td>
                  ))}
                  {editable && <td />}
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={view.columns.length + (editable ? 2 : 0)}
                    className="px-3 py-6 text-center text-xs text-ink-muted"
                  >
                    아직 행이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view && editable && (
        <button
          type="button"
          onClick={ctrl.addRow}
          className="flex w-full items-center gap-1.5 border-t border-edge px-3 py-2 text-left text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
        >
          <PlusIcon />
          행 추가
        </button>
      )}
    </div>
  )
}

// 열 추가 버튼 + 타입 드롭다운. 드롭다운은 document.body로 포탈되어 fixed로 뜬다 — db 컨테이너의
// overflow(rounded용 overflow-hidden + 표의 overflow-x-auto)에 잘리던 것을 피하려는 것.
// 투명 백드롭이 바깥 클릭을 받아 닫고, 드롭다운은 mousedown 전파를 막아 항목 클릭이 백드롭에
// 먼저 먹히지 않게 한다 (mousedown→click 순서 레이스 방지).
function AddColumnButton({
  open,
  onToggle,
  onClose,
  onAdd,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  onAdd: (t: (typeof ADD_TYPES)[number]) => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useOverlayDismiss(open && onClose)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="열 추가"
        onClick={() => {
          if (!open) setRect(btnRef.current?.getBoundingClientRect() ?? null)
          onToggle()
        }}
        className="flex h-full w-full items-center justify-center py-2 text-ink-muted hover:bg-surface-hover hover:text-ink"
      >
        <PlusIcon />
      </button>
      {open &&
        rect &&
        createPortal(
          <div className="fixed inset-0 z-50" onMouseDown={onClose}>
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{ position: 'fixed', top: rect.bottom + 4, left: Math.max(8, rect.right - 144) }}
              className="w-36 rounded-md border border-edge-bright bg-surface-raised p-1 text-left shadow-lg"
            >
              {ADD_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    onClose()
                    onAdd(t)
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-surface-hover"
                >
                  <span className="w-3.5 shrink-0 text-center text-ink-muted">{TYPE_GLYPH[t]}</span>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function ColumnHeader({
  col,
  editable,
  onRename,
  onDelete,
}: {
  col: DbColumn
  editable: boolean
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(col.name)

  if (renaming) {
    return (
      <th className="border-r border-edge p-0 last:border-r-0">
        <input
          autoFocus
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
          className="w-full bg-surface-hover px-3 py-2 text-xs font-medium text-ink outline-none"
        />
      </th>
    )
  }

  return (
    <th className="group/col border-r border-edge px-3 py-2 text-left align-middle last:border-r-0">
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          disabled={!editable}
          onClick={() => {
            if (editable) {
              setDraft(col.name)
              setRenaming(true)
            }
          }}
          className="flex min-w-0 items-center gap-1.5 disabled:cursor-default"
          title={editable ? '이름 변경' : col.name}
        >
          <span className="shrink-0 text-[11px] leading-none text-ink-muted">{TYPE_GLYPH[col.type]}</span>
          <span className="truncate text-xs font-medium text-ink-secondary">{col.name}</span>
        </button>
        {editable && (
          <button
            type="button"
            title="열 삭제"
            onClick={onDelete}
            className="text-ink-muted opacity-0 transition-opacity hover:text-danger-strong group-hover/col:opacity-100"
          >
            ×
          </button>
        )}
      </div>
    </th>
  )
}

function Cell({
  col,
  row,
  editable,
  onLocal,
  onCommit,
}: {
  col: DbColumn
  row: DbRow
  editable: boolean
  onLocal: (value: unknown) => void
  onCommit: (value: unknown) => void
}) {
  const value = row.cells[col.id]

  if (col.type === 'checkbox') {
    return (
      <div className="flex items-center justify-center py-2">
        <input
          type="checkbox"
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
    return <div className="select-text min-h-[2.25rem] px-3 py-2 text-sm text-ink">{value == null ? '' : String(value)}</div>
  }

  const inputType = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'
  return (
    <input
      type={inputType}
      value={value == null ? '' : String(value)}
      onChange={(e) => onLocal(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-full bg-transparent px-3 py-2 text-sm text-ink outline-none focus:bg-surface-hover"
    />
  )
}

// 데이터베이스를 상징하는 원통(cylinder) 아이콘 — 헤더·팝업 목록에서 공유한다
export function DbGlyph({ className, size = 15 }: { className?: string; size?: number }) {
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
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
