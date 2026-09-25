import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// /db 참조 커맨드의 선택 모달 — 이 프로젝트의 기존 데이터베이스를 뷰 전용으로 삽입하거나,
// 외부 Postgres 테이블(schema.table)을 읽기 전용으로 참조해 붙인다. 실제 삽입은 호스트(Editor)가 한다.
import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import type { DbSummary, EditorDbApi } from '../types'

export function DbReferencePicker({
  api,
  onPickExisting,
  onAttachExternal,
  onClose,
}: {
  api: EditorDbApi
  /** 기존 데이터베이스를 뷰 전용 참조로 삽입 */
  onPickExisting: (dbId: string) => void
  /** 외부 테이블을 external(읽기 전용)로 붙여 삽입 */
  onAttachExternal: (schema: string, table: string) => void
  onClose: () => void
}) {
  useUiLocale()
  const [items, setItems] = useState<DbSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [schema, setSchema] = useState('')
  const [table, setTable] = useState('')
  const [attaching, setAttaching] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .list()
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : uiText("목록을 불러오지 못했습니다"))
      })
    return () => {
      cancelled = true
    }
  }, [api])

  useOverlayDismiss(onClose)

  function submitExternal() {
    const s = schema.trim()
    const t = table.trim()
    if (!s || !t || attaching) return
    setAttaching(true)
    onAttachExternal(s, t)
  }

  return (
    <div
      style={{ zIndex: 1100 }}
      className="fixed inset-0 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-80 max-w-full rounded-lg border border-edge-bright bg-surface-raised p-3 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">{uiText("데이터베이스 참조")}</span>
          <span className="text-xs text-ink-secondary">{uiText("읽기 전용")}</span>
        </div>

        <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-muted">{uiText("이 프로젝트의 데이터베이스")}</div>
        <div className="max-h-48 overflow-y-auto rounded border border-edge-bright">
          {error ? (
            <div className="select-text px-2 py-3 text-center text-xs text-danger-strong">{error}</div>
          ) : items === null ? (
            <div className="px-2 py-3 text-center text-xs text-ink-muted">{uiText("불러오는 중…")}</div>
          ) : items.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-ink-muted">{uiText("아직 데이터베이스가 없습니다")}</div>
          ) : (
            items.map((d) => (
              <button
                key={d.id}
                type="button"
                onMouseDown={() => onPickExisting(d.id)}
                className="flex w-full items-center justify-between gap-2 border-b border-edge-bright px-2 py-1.5 text-left text-xs text-ink last:border-b-0 hover:bg-surface-hover"
              >
                <span className="truncate">{d.title}</span>
                <span className="shrink-0 rounded bg-surface-hover px-1 py-0.5 text-[10px] text-ink-muted">
                  {d.kind === 'external' ? uiText("외부") : uiText("표")}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-ink-muted">{uiText("외부 Postgres 테이블")}</div>
        <div className="flex gap-1">
          <input
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            placeholder="schema"
            className="w-1/2 rounded border border-edge-bright bg-transparent px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          />
          <input
            value={table}
            onChange={(e) => setTable(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitExternal()
            }}
            placeholder="table"
            className="w-1/2 rounded border border-edge-bright bg-transparent px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          />
        </div>
        <button
          type="button"
          onClick={submitExternal}
          disabled={!schema.trim() || !table.trim() || attaching}
          className="mt-1.5 w-full rounded bg-accent px-2 py-1 text-xs text-ink-on-accent disabled:opacity-40"
        >
          {attaching ? uiText("붙이는 중…") : uiText("읽기 전용으로 참조")}
        </button>
      </div>
    </div>
  )
}
