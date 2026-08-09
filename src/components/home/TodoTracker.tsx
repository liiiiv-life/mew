// 할 일 위젯 — 워크스페이스 전체의 `[TODO:…]` 표식을 프로젝트별로 모아 보여준다.
//
// 체크는 곧 **파일 수정**이다(서버가 그 줄의 TODO를 DONE으로 바꿔 되쓴다). 그래서 낙관적으로
// 먼저 칠하지 않고 응답이 온 뒤에 목록을 갈아끼운다 — 표식이 사라졌거나 라벨이 바뀌었으면 실패한다.
import { useMemo, useState } from 'react'
import type { TodoItem } from '../../api/client'
import type { HomeWidgetContext } from './widgets'

// 빈 목록 안내에 쓰는 예시. 리터럴로 적으면 **이 파일 자신이** 스캔 결과에 잡히므로 조립한다
const SAMPLE_MARKER = `[${'TODO'}:할 일]`

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function TodoTracker({ items, loading, onToggle, onSetDue, onOpen }: HomeWidgetContext) {
  const [showDone, setShowDone] = useState(false)
  const today = todayISO()

  const groups = useMemo(() => {
    const byProject = new Map<string, TodoItem[]>()
    for (const item of items) {
      if (item.done && !showDone) continue
      const list = byProject.get(item.project) ?? []
      list.push(item)
      byProject.set(item.project, list)
    }
    return [...byProject.entries()]
  }, [items, showDone])

  const openCount = items.filter((i) => !i.done).length

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-1 pb-2 text-xs text-ink-muted">
        <span>
          남은 일 {openCount}개 · 전체 {items.length}개
        </span>
        <label className="ml-auto flex select-none items-center gap-1">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          완료도 보기
        </label>
      </div>

      {loading && items.length === 0 ? (
        <div className="px-1 py-6 text-center text-xs text-ink-muted">훑는 중…</div>
      ) : groups.length === 0 ? (
        <div className="px-1 py-6 text-center text-xs text-ink-muted">
          할 일이 없습니다 — 코드나 문서 어디에든 <code className="text-ink-secondary">{SAMPLE_MARKER}</code> 이라고
          적으면 여기 모입니다
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([project, list]) => (
            <div key={project}>
              <div className="px-1 pb-1 text-xs font-semibold text-ink-secondary">{project}</div>
              <div className="flex flex-col">
                {list.map((item) => (
                  <TodoRow
                    key={`${item.project}:${item.path}:${item.line}:${item.text}`}
                    item={item}
                    overdue={!item.done && item.due != null && item.due < today}
                    onToggle={onToggle}
                    onSetDue={onSetDue}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TodoRow({
  item,
  overdue,
  onToggle,
  onSetDue,
  onOpen,
}: {
  item: TodoItem
  overdue: boolean
  onToggle: (item: TodoItem, done: boolean) => void
  onSetDue: (item: TodoItem, due: string | null) => void
  onOpen: (item: TodoItem) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => onToggle(item, e.target.checked)}
        aria-label={item.done ? '되돌리기' : '완료'}
        className="shrink-0"
      />
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="min-w-0 flex-1 truncate text-left text-sm text-ink"
        title={`${item.path}:${item.line}`}
      >
        <span className={item.done ? 'text-ink-muted line-through' : ''}>{item.text}</span>
        <span className="ml-2 font-mono text-[11px] text-ink-muted">
          {item.path}:{item.line}
        </span>
      </button>
      {/* 기한은 브라우저 기본 날짜 입력 — 비워서 지운다 */}
      <input
        type="date"
        value={item.due ?? ''}
        onChange={(e) => onSetDue(item, e.target.value || null)}
        className={`shrink-0 rounded bg-surface px-1 py-0.5 text-[11px] ${
          overdue ? 'text-danger-strong' : item.due ? 'text-ink-secondary' : 'text-ink-muted'
        }`}
        aria-label="기한"
      />
    </div>
  )
}
