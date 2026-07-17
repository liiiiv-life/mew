import { useEffect, useRef, useState } from 'react'
import { createTmuxSession, fetchTmuxSessions, killTmuxSession, renameTmuxSession, type TmuxSession } from '../api/client'
import { TmuxTerminal } from './TmuxTerminal'

const POLL_INTERVAL_MS = 4000

type Editing = { mode: 'rename'; oldName: string; value: string } | { mode: 'create'; value: string } | null

function nextDefaultName(sessions: TmuxSession[]): string {
  const existing = new Set(sessions.map((s) => s.name))
  let n = 1
  while (existing.has(`session-${n}`)) n++
  return `session-${n}`
}

// FileTree.tsx의 InlineInput과 동일한 커밋 가드: IME(한글 등) 조합 확정용 Enter를 무시하고,
// 모바일 키보드의 완료 버튼이 커밋 직후 발생시키는 blur가 onCancel까지 잇달아 부르지 않게 막는다.
function InlineTabInput({
  value,
  onChange,
  onCommit,
  onCancel,
  error,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  error?: string
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    if (error) committedRef.current = false
  }, [error])

  return (
    <div className="relative flex h-full shrink-0 items-center border-r border-edge px-2">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
            if (committedRef.current) return
            committedRef.current = true
            onCommit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => {
          // 포커스를 잃으면 취소 대신 커밋 시도 — FileTree.tsx의 InlineInput과 동일한 이유
          // (모바일에서 Enter 이벤트가 안정적으로 안 잡히는 경우가 있어 blur를 완료 신호로 취급)
          if (committedRef.current) return
          committedRef.current = true
          onCommit()
        }}
        placeholder={placeholder}
        className="w-28 rounded border border-accent bg-surface px-1.5 py-0.5 text-xs text-ink outline-none"
      />
      {error && (
        <div className="absolute top-full left-0 z-10 mt-1 rounded border border-danger bg-surface-raised px-2 py-1 text-xs whitespace-nowrap text-danger shadow-lg">
          {error}
        </div>
      )}
    </div>
  )
}

// FileTree.tsx의 ActionPopover와 동일한 패턴: 바깥을 누르면 닫히고, 그 상호작용이 아래
// 요소의 클릭(탭 전환 등)까지 이어지지 않도록 뒤따라올 click 하나를 삼킨다.
function TabContextMenu({ x, y, onRename, onClose }: { x: number; y: number; onRename: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      onClose()
      function swallowClick(ce: MouseEvent) {
        ce.preventDefault()
        ce.stopPropagation()
      }
      document.addEventListener('click', swallowClick, { capture: true, once: true })
      setTimeout(() => document.removeEventListener('click', swallowClick, true), 0)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 160)
  const top = Math.min(y, window.innerHeight - 80)

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, zIndex: 1000 }}
      className="min-w-[9rem] overflow-hidden rounded-lg border border-edge-bright bg-surface-raised text-sm shadow-xl"
    >
      <button type="button" onClick={onRename} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
        ✎ 이름 변경
      </button>
    </div>
  )
}

function TabButton({
  session,
  isActive,
  onSelect,
  onOpenMenu,
  onRename,
  onKill,
}: {
  session: TmuxSession
  isActive: boolean
  onSelect: () => void
  onOpenMenu: (x: number, y: number) => void
  onRename: () => void
  onKill: () => void
}) {
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0]
    longPressFired.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      onOpenMenu(touch.clientX, touch.clientY)
    }, 500)
  }

  function handleClick() {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    onSelect()
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    onOpenMenu(e.clientX, e.clientY)
  }

  return (
    <div
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault()
          onRename()
        }
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={clearLongPress}
      onTouchMove={clearLongPress}
      onTouchCancel={clearLongPress}
      onContextMenu={handleContextMenu}
      className={`flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-2.5 text-xs select-none [-webkit-touch-callout:none] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent ${
        isActive ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${session.attached ? 'bg-accent-strong' : 'bg-ink-muted'}`} />
      <span className="max-w-[100px] truncate">{session.name}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onKill()
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
        aria-label={`${session.name} 종료`}
      >
        ×
      </button>
    </div>
  )
}

export function TmuxTerminalPanel({ onClose, activeFilePath }: { onClose?: () => void; activeFilePath?: string | null }) {
  const [sessions, setSessions] = useState<TmuxSession[] | null>(null)
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [editError, setEditError] = useState<string | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<{ session: TmuxSession; x: number; y: number } | null>(null)
  const autoSelected = useRef(false)

  function refresh() {
    fetchTmuxSessions()
      .then((list) => {
        setSessions(list)
        setActiveSession((cur) => {
          if (cur && list.some((s) => s.name === cur)) return cur
          if (!autoSelected.current && list.length > 0) {
            autoSelected.current = true
            return list[0].name
          }
          return null
        })
      })
      .catch(console.error)
  }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startRename(session: TmuxSession) {
    setEditError(undefined)
    setEditing({ mode: 'rename', oldName: session.name, value: session.name })
  }

  function startCreate() {
    setEditError(undefined)
    setEditing({ mode: 'create', value: nextDefaultName(sessions ?? []) })
  }

  async function commitEdit() {
    if (!editing) return
    const value = editing.value.trim()
    if (!value) {
      setEditing(null)
      return
    }
    try {
      if (editing.mode === 'create') {
        await createTmuxSession(value)
        setEditing(null)
        setActiveSession(value)
      } else {
        if (value === editing.oldName) {
          setEditing(null)
          return
        }
        await renameTmuxSession(editing.oldName, value)
        setEditing(null)
        setActiveSession((cur) => (cur === editing.oldName ? value : cur))
      }
      refresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    }
  }

  async function requestKill(name: string) {
    if (!window.confirm(`세션 "${name}"을(를) 종료할까요? 실행 중인 프로세스가 함께 종료됩니다.`)) return
    try {
      await killTmuxSession(name)
      if (activeSession === name) setActiveSession(null)
      refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-deep">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="text-sm font-semibold text-ink-soft">터미널</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="터미널 닫기"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex h-9 items-center overflow-x-auto border-b border-edge bg-surface">
        {(sessions ?? []).map((s) => {
          if (editing?.mode === 'rename' && editing.oldName === s.name) {
            return (
              <InlineTabInput
                key={s.name}
                value={editing.value}
                onChange={(v) => setEditing((e) => (e ? { ...e, value: v } : e))}
                onCommit={commitEdit}
                onCancel={() => setEditing(null)}
                error={editError}
              />
            )
          }
          return (
            <TabButton
              key={s.name}
              session={s}
              isActive={s.name === activeSession}
              onSelect={() => setActiveSession(s.name)}
              onOpenMenu={(x, y) => setContextMenu({ session: s, x, y })}
              onRename={() => startRename(s)}
              onKill={() => requestKill(s.name)}
            />
          )
        })}
        {editing?.mode === 'create' ? (
          <InlineTabInput
            value={editing.value}
            onChange={(v) => setEditing((e) => (e ? { ...e, value: v } : e))}
            onCommit={commitEdit}
            onCancel={() => setEditing(null)}
            error={editError}
            placeholder="세션 이름"
          />
        ) : (
          <button
            type="button"
            onClick={startCreate}
            title="새 tmux 세션"
            className="flex shrink-0 items-center px-2.5 text-sm text-ink-secondary hover:bg-surface-raised"
          >
            +
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {activeSession ? (
          <TmuxTerminal key={activeSession} sessionName={activeSession} activeFilePath={activeFilePath} />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-ink-muted">
            {sessions === null ? '세션 불러오는 중…' : '탭에서 세션을 선택하거나 +로 새 세션을 만드세요'}
          </div>
        )}
      </div>

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={() => {
            startRename(contextMenu.session)
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
