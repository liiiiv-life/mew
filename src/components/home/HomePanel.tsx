// 홈 탭의 본문 — 프로젝트가 아니라 **워크스페이스 전체**를 보는 화면이다.
//
// 편집 칸(EditorPane) 자리를 대신 차지한다. 여기서 여는 것은 문서가 아니라 "워크스페이스에 걸린 일"이고,
// 화면 구성은 위젯 등록표(widgets.tsx)가 정한다 — 사용자가 넣고 빼고 순서를 바꾼 결과는 브라우저에 남는다.
import { useCallback, useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchTodos, updateTodo, type TodoItem } from '../../api/client'
import {
  loadHomeLayout,
  movedLayout,
  orderedWidgets,
  saveHomeLayout,
  toggledLayout,
  visibleWidgets,
  type HomeLayout,
} from './widgets'

export function HomePanel({ onOpenItem }: { onOpenItem: (item: TodoItem) => void }) {
  const [items, setItems] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [layout, setLayout] = useState<HomeLayout>(loadHomeLayout)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    fetchTodos()
      .then((r) => {
        setItems(r.items)
        setError(r.truncated ? '표식이 너무 많아 일부만 보여줍니다' : null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '할 일을 불러오지 못했습니다'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])

  /** 체크·기한 바꾸기 = 파일 수정이다. 성공한 응답으로만 목록을 갈아끼우고, 실패하면 통째로 다시 받는다 */
  const applyChange = useCallback(
    (item: TodoItem, change: { done?: boolean; due?: string | null }) => {
      updateTodo(item, change)
        .then(({ item: next }) => {
          setItems((prev) => prev.map((i) => (sameItem(i, item) ? next : i)))
          setError(null)
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '고치지 못했습니다')
          refresh()
        })
    },
    [refresh],
  )

  const changeLayout = (next: HomeLayout) => {
    setLayout(next)
    saveHomeLayout(next)
  }

  const shown = visibleWidgets(layout)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-edge px-2">
        <span className="text-sm font-semibold text-ink">홈</span>
        <span className="text-xs text-ink-muted">워크스페이스 전체</span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="ml-auto rounded px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-hover disabled:opacity-40"
        >
          새로고침
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="rounded px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-hover"
          >
            위젯
          </button>
          {settingsOpen && (
            <WidgetSettings layout={layout} onChange={changeLayout} onClose={() => setSettingsOpen(false)} />
          )}
        </div>
      </div>

      {error && <div className="shrink-0 bg-warning-surface px-3 py-1.5 text-xs text-warning-ink">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shown.length === 0 ? (
          <div className="py-10 text-center text-xs text-ink-muted">세운 위젯이 없습니다 — "위젯"에서 켜세요</div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {shown.map((widget) => (
              <section key={widget.id} className="rounded-lg bg-surface-raised p-3">
                <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{widget.title}</h2>
                {widget.render({
                  items,
                  loading,
                  onToggle: (item, done) => applyChange(item, { done }),
                  onSetDue: (item, due) => applyChange(item, { due }),
                  onOpen: onOpenItem,
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function sameItem(a: TodoItem, b: TodoItem): boolean {
  return a.project === b.project && a.path === b.path && a.line === b.line && a.text === b.text
}

function WidgetSettings({
  layout,
  onChange,
  onClose,
}: {
  layout: HomeLayout
  onChange: (next: HomeLayout) => void
  onClose: () => void
}) {
  useOverlayDismiss(onClose)
  const widgets = orderedWidgets(layout)

  return (
    <div className="absolute right-0 top-full z-[1000] mt-1 w-56 rounded-lg border border-edge-bright bg-surface-raised p-1 shadow-xl">
      {widgets.map((widget, i) => (
        <div key={widget.id} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-surface-hover">
          <label className="flex min-w-0 flex-1 select-none items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={!layout.hidden.includes(widget.id)}
              onChange={() => onChange(toggledLayout(layout, widget.id))}
            />
            <span className="truncate">{widget.title}</span>
          </label>
          <button
            type="button"
            disabled={i === 0}
            onClick={() => onChange(movedLayout(layout, widget.id, -1))}
            className="rounded px-1 text-xs text-ink-muted hover:bg-surface-hover disabled:opacity-30"
            aria-label="위로"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={i === widgets.length - 1}
            onClick={() => onChange(movedLayout(layout, widget.id, 1))}
            className="rounded px-1 text-xs text-ink-muted hover:bg-surface-hover disabled:opacity-30"
            aria-label="아래로"
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  )
}
