// 할 일 위젯 — 로그인 사용자가 직접 등록한 항목을 보여주고 고친다.
import { useState, type FormEvent } from 'react'
import type { TodoItem } from '../../api/client'
import type { HomeWidgetContext } from './widgets'

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function TodoTracker({ items, loading, onCreate, onUpdate, onDelete }: HomeWidgetContext) {
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [showDone, setShowDone] = useState(false)
  const today = todayISO()
  const openCount = items.filter((i) => !i.done).length
  const shown = items.filter((item) => showDone || !item.done)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    onCreate({ text: value, due: due || null })
    setText('')
    setDue('')
  }

  return (
    <div className="flex min-h-0 flex-col">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 px-1 pb-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={240}
          placeholder="할 일"
          className="min-w-48 flex-1 rounded border border-edge bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-muted"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="shrink-0 rounded border border-edge bg-surface px-2 py-1 text-sm text-ink-secondary"
          aria-label="기한"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="rounded bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40"
        >
          추가
        </button>
      </form>

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
        <div className="px-1 py-6 text-center text-xs text-ink-muted">불러오는 중...</div>
      ) : shown.length === 0 ? (
        <div className="px-1 py-6 text-center text-xs text-ink-muted">등록된 할 일이 없습니다</div>
      ) : (
        <div className="flex flex-col">
          {shown.map((item) => (
            <TodoRow
              key={item.id}
              item={item}
              overdue={!item.done && item.due != null && item.due < today}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TodoRow({
  item,
  overdue,
  onUpdate,
  onDelete,
}: {
  item: TodoItem
  overdue: boolean
  onUpdate: (item: TodoItem, change: { text?: string; done?: boolean; due?: string | null }) => void
  onDelete: (item: TodoItem) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)

  const saveText = () => {
    const text = draft.trim()
    if (!text) {
      setDraft(item.text)
      setEditing(false)
      return
    }
    if (text !== item.text) onUpdate(item, { text })
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={item.done}
        onChange={(e) => onUpdate(item, { done: e.target.checked })}
        aria-label={item.done ? '되돌리기' : '완료'}
        className="shrink-0"
      />
      {editing ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveText()
            if (e.key === 'Escape') {
              setDraft(item.text)
              setEditing(false)
            }
          }}
          maxLength={240}
          autoFocus
          className="min-w-0 flex-1 rounded border border-edge bg-surface px-2 py-1 text-sm text-ink"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(item.text)
            setEditing(true)
          }}
          className={`min-w-0 flex-1 truncate text-left text-sm ${item.done ? 'text-ink-muted line-through' : 'text-ink'}`}
          title={item.text}
        >
          {item.text}
        </button>
      )}
      <input
        type="date"
        value={item.due ?? ''}
        onChange={(e) => onUpdate(item, { due: e.target.value || null })}
        className={`shrink-0 rounded bg-surface px-1 py-0.5 text-[11px] ${
          overdue ? 'text-danger-strong' : item.due ? 'text-ink-secondary' : 'text-ink-muted'
        }`}
        aria-label="기한"
      />
      <button
        type="button"
        onClick={() => onDelete(item)}
        className="shrink-0 rounded px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-danger-strong"
        aria-label="삭제"
      >
        삭제
      </button>
    </div>
  )
}
