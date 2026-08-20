// 홈 탭의 본문 — 프로젝트가 아니라 **워크스페이스 전체**를 보는 화면이다.
//
// 편집 칸(EditorPane) 자리를 대신 차지한다. 여기서 여는 것은 문서가 아니라 "사용자가 등록한 일"이고,
// 화면 구성은 위젯 등록표(widgets.tsx)가 정한다 — 사용자가 넣고 빼고 순서를 바꾼 결과는 브라우저에 남는다.
import { useCallback, useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { MoreHoriz, NavArrowDown, NavArrowUp, Refresh } from 'iconoir-react'
import { createTodo, deleteTodo, fetchTodos, updateTodo, type ProjectInfo, type TodoItem, type TodoStatus, type TodoType } from '../../api/client'
import { useGridDrag } from '../../hooks/useGridDrag'
import {
  loadHomeLayout,
  movedLayout,
  orderedWidgets,
  saveHomeLayout,
  toggledLayout,
  visibleWidgets,
  type HomeLayout,
} from './widgets'

export function HomePanel({ projects }: { projects: ProjectInfo[] }) {
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
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '할 일을 불러오지 못했습니다'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])

  const sortItems = useCallback((next: TodoItem[]) => [...next].sort(compareTodos), [])

  const addItem = useCallback(
    (input: { text: string; type: TodoType; due: string | null; projects: string[] }) => {
      createTodo(input)
        .then(({ item }) => {
          setItems((prev) => sortItems([item, ...prev]))
          setError(null)
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '추가하지 못했습니다')
          refresh()
        })
    },
    [refresh, sortItems],
  )

  const applyChange = useCallback(
    (
      item: TodoItem,
      change: {
        text?: string
        type?: TodoType
        status?: TodoStatus
        done?: boolean
        due?: string | null
        projects?: string[]
      },
    ) => {
      updateTodo(item.id, change)
        .then(({ item: next }) => {
          setItems((prev) => sortItems(prev.map((i) => (i.id === item.id ? next : i))))
          setError(null)
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '고치지 못했습니다')
          refresh()
        })
    },
    [refresh, sortItems],
  )

  const removeItem = useCallback(
    (item: TodoItem) => {
      deleteTodo(item.id)
        .then(() => {
          setItems((prev) => prev.filter((i) => i.id !== item.id))
          setError(null)
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '삭제하지 못했습니다')
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
  const widgetDrag = useGridDrag({
    enabled: shown.length > 1,
    mouseHoldMs: 500,
    onMove: (from, to) => changeLayout(reorderVisibleLayout(layout, from, to)),
  })

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface-deep">
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1">
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded border border-edge-strong bg-surface-raised text-ink-secondary shadow-sm hover:border-edge-bright hover:bg-surface-hover hover:text-ink disabled:opacity-40"
          title="새로고침"
          aria-label="새로고침"
        >
          <Refresh width={16} height={16} aria-hidden="true" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded border border-edge-strong bg-surface-raised text-ink-secondary shadow-sm hover:border-edge-bright hover:bg-surface-hover hover:text-ink"
            title="위젯"
            aria-label="위젯"
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
          >
            <MoreHoriz width={16} height={16} aria-hidden="true" />
          </button>
          {settingsOpen && (
            <WidgetSettings layout={layout} onChange={changeLayout} onClose={() => setSettingsOpen(false)} />
          )}
        </div>
      </div>

      {error && <div className="shrink-0 bg-warning-surface px-3 py-1.5 text-xs text-warning-ink">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pt-14 sm:px-5 lg:px-7">
        {shown.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-lg border border-dashed border-edge-strong bg-surface px-5 py-10 text-center text-xs text-ink-muted">
            세운 위젯이 없습니다. 위젯 메뉴에서 켜세요
          </div>
        ) : (
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {shown.map((widget, index) => (
              <section
                key={widget.id}
                ref={widgetDrag.registerCell(index)}
                className={`overflow-hidden rounded-lg border border-edge bg-surface shadow-sm transition-[border-color,box-shadow] ${
                  widgetDrag.drag?.slot === index ? 'relative z-30 border-edge-bright shadow-2xl transition-none' : 'hover:border-edge-strong'
                }`}
                style={
                  widgetDrag.drag?.slot === index
                    ? { transform: `translate(${widgetDrag.drag.dx}px, ${widgetDrag.drag.dy}px)` }
                    : undefined
                }
              >
                <div
                  {...widgetDrag.getTileProps(index)}
                  className="flex cursor-grab select-none items-center justify-between border-b border-edge bg-surface-raised px-3 py-2 active:cursor-grabbing"
                >
                  <h2 className="text-sm font-semibold text-ink-bright">{widget.title}</h2>
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                </div>
                <div className="p-3 sm:p-4">
                  {widget.render({
                    items,
                    projects,
                    loading,
                    onCreate: addItem,
                    onUpdate: applyChange,
                    onDelete: removeItem,
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function compareTodos(a: TodoItem, b: TodoItem): number {
  const typeRank: Record<TodoType, number> = { today: 0, dated: 1, recurring: 2 }
  const statusRank: Record<TodoStatus, number> = { open: 0, missed: 1, canceled: 2, done: 3 }
  return (
    typeRank[a.type] - typeRank[b.type] ||
    statusRank[a.status] - statusRank[b.status] ||
    Number(a.due == null) - Number(b.due == null) ||
    (a.due ?? '').localeCompare(b.due ?? '') ||
    b.createdAt.localeCompare(a.createdAt)
  )
}

function reorderVisibleLayout(layout: HomeLayout, from: number, to: number): HomeLayout {
  const visible = visibleWidgets(layout).map((w) => w.id)
  if (from < 0 || to < 0 || from >= visible.length || to >= visible.length) return layout
  visible.splice(to, 0, ...visible.splice(from, 1))
  const hidden = orderedWidgets(layout)
    .map((w) => w.id)
    .filter((id) => !visible.includes(id))
  return { ...layout, order: [...visible, ...hidden] }
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
    <div className="absolute right-0 top-full z-[1000] mt-1 w-60 rounded-lg border border-edge-bright bg-surface-raised p-1.5 shadow-xl">
      {widgets.map((widget, i) => (
        <div key={widget.id} className="flex items-center gap-1 rounded px-1.5 py-1.5 hover:bg-surface-hover">
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
            className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-surface disabled:opacity-30"
            aria-label="위로"
          >
            <NavArrowUp width={14} height={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={i === widgets.length - 1}
            onClick={() => onChange(movedLayout(layout, widget.id, 1))}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-surface disabled:opacity-30"
            aria-label="아래로"
          >
            <NavArrowDown width={14} height={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
