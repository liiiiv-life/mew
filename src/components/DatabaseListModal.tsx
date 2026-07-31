// 이 프로젝트의 모든 데이터베이스를 한 팝업에서 열람/편집한다 — 헤더의 원통 아이콘으로 연다.
// 왼쪽 목록에서 고르면 오른쪽에 DatabasePanel(노드뷰와 같은 표)을 편집 가능 상태로 띄운다.
import { useEffect, useState } from 'react'
import { DatabasePanel, DbGlyph, type DbSummary } from '@mew/editor'
import { useOverlayDismiss } from '@mew/ui'
import { dbApi, getProject } from '../api/client'

export function DatabaseListModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<DbSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    dbApi
      .list()
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setSelected((s) => s ?? list[0]?.id ?? null)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useOverlayDismiss(onClose)

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 왼쪽: DB 목록 */}
        <div className="flex w-56 shrink-0 flex-col border-r border-edge">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <DbGlyph className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">데이터베이스</span>
            <span className="shrink-0 text-[11px] text-ink-muted">{getProject()}</span>
          </div>
          <div className="flex-1 overflow-y-auto border-t border-edge">
            {error ? (
              <div className="px-3 py-4 text-center text-xs text-danger-strong">{error}</div>
            ) : items === null ? (
              <div className="px-3 py-4 text-center text-xs text-ink-muted">불러오는 중…</div>
            ) : items.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-muted">아직 데이터베이스가 없습니다</div>
            ) : (
              items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelected(d.id)}
                  className={`flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-left text-xs last:border-b-0 hover:bg-surface-hover ${
                    selected === d.id ? 'bg-surface-hover text-ink' : 'text-ink-secondary'
                  }`}
                >
                  <DbGlyph className="shrink-0 text-ink-muted" size={13} />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  {d.kind === 'external' && (
                    <span className="shrink-0 rounded bg-surface px-1 py-0.5 text-[9px] text-ink-muted">외부</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 오른쪽: 선택한 DB */}
        <div className="flex-1 overflow-y-auto bg-surface p-4">
          {selected ? (
            <DatabasePanel key={selected} api={dbApi} dbId={selected} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-ink-muted">
              {items && items.length === 0 ? '/db 로 데이터베이스를 만들어 보세요' : '데이터베이스를 선택하세요'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
