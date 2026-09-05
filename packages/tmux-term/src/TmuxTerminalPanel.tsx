import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, keepFocusOnPress, useDragReorder, type DragItemProps } from '@mew/ui'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import type { TmuxPanelApi, TmuxSession } from './types'
import { TmuxTerminal } from './TmuxTerminal'
import { clearInputDraft, renameInputDraft } from './inputDrafts'

const POLL_INTERVAL_MS = 4000
const ACTIVE_SESSION_KEY = 'mew:tmux-active-session'
// 탭 순서는 tmux가 아니라 브라우저에만 저장한다 — 서버의 세션 목록엔 순서 개념이 없다
const TAB_ORDER_KEY = 'mew:tmux-tab-order'

function readTabOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

// 저장된 순서 우선, 처음 보는 세션은 서버가 준 순서대로 뒤에 붙인다
function sortByTabOrder(sessions: TmuxSession[], order: string[]): TmuxSession[] {
  const rank = new Map(order.map((name, i) => [name, i]))
  return sessions
    .map((s, i) => [s, rank.get(s.name) ?? order.length + i] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s)
}

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
  isDragging,
  dragProps,
  onSelect,
  onConsumeClick,
  onOpenMenu,
  onRename,
  onKill,
}: {
  session: TmuxSession
  isActive: boolean
  isDragging: boolean
  /** useDragReorder의 getItemProps — 터치 길게누르기(메뉴·드래그)와 마우스 드래그를 담당 */
  dragProps: DragItemProps
  onSelect: () => void
  /** 드래그·길게누르기 직후 따라온 click이면 true — 탭 전환을 건너뛴다 */
  onConsumeClick: () => boolean
  onOpenMenu: (x: number, y: number) => void
  onRename: () => void
  onKill: () => void
}) {
  function handleClick() {
    if (onConsumeClick()) return
    onSelect()
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    // 터치 길게누르기는 useDragReorder의 onLongPress가 이미 메뉴를 열었다 — 여기는 우클릭 전용
    if (isDragging) return
    onOpenMenu(e.clientX, e.clientY)
  }

  return (
    <div
      {...dragProps}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={onRename}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault()
          onRename()
        }
      }}
      onContextMenu={handleContextMenu}
      className={`flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-2.5 text-xs select-none [-webkit-touch-callout:none] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent ${
        isActive ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised'
      } ${isDragging ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`}
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

export function TmuxTerminalPanel({
  api,
  onClose,
  activeFilePath,
  getSelectedText,
  renderCommandButtons,
  wsPath,
  nextTabSignal = 0,
  previousTabSignal = 0,
}: {
  /** 호스트 앱의 서버 연동 — 렌더 간 identity가 안정적인 객체를 넘길 것 */
  api: TmuxPanelApi
  onClose?: () => void
  activeFilePath?: string | null
  getSelectedText?: () => string | null
  /** 버튼 줄에 끼워 넣을 명령어 버튼 UI — run(command)로 지금 열린 세션에 명령을 보낸다 */
  renderCommandButtons?: (run: (command: string) => void) => ReactNode
  wsPath?: string
  /** 값이 바뀌면 현재 세션의 오른쪽 탭으로 한 칸 이동한다. */
  nextTabSignal?: number
  previousTabSignal?: number
}) {
  const shortcutScopeRef = useRef<HTMLDivElement>(null)
  const [sessions, setSessions] = useState<TmuxSession[] | null>(null)
  const [activeSession, setActiveSession] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [editError, setEditError] = useState<string | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<{ session: TmuxSession; x: number; y: number } | null>(null)
  const [tabOrder, setTabOrder] = useState<string[]>(readTabOrder)
  const [killTarget, setKillTarget] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const autoSelected = useRef(false)

  const orderedSessions = sessions ? sortByTabOrder(sessions, tabOrder) : null

  // 화면 위 반쪽 좌우 스와이프로 탭(세션) 전환 — 우→좌면 오른쪽 탭(끝이면 처음으로), 좌→우면 왼쪽 탭(처음이면 끝으로)
  // (아래 반쪽 스와이프는 부모 컨테이너로 버블링되어 터미널 창을 닫는다)
  const switchSession = (dir: 'left' | 'right') => {
    const list = orderedSessions
    if (!list || list.length < 2 || !activeSession) return
    const idx = list.findIndex((s) => s.name === activeSession)
    if (idx < 0) return
    const nextIdx = dir === 'left' ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length
    setActiveSession(list[nextIdx].name)
  }
  const seenNextTabSignal = useRef(nextTabSignal)
  useEffect(() => {
    if (seenNextTabSignal.current === nextTabSignal) return
    seenNextTabSignal.current = nextTabSignal
    switchSession('left')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTabSignal])
  const seenPreviousTabSignal = useRef(previousTabSignal)
  useEffect(() => {
    if (seenPreviousTabSignal.current === previousTabSignal) return
    seenPreviousTabSignal.current = previousTabSignal
    switchSession('right')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousTabSignal])
  function saveTabOrder(names: string[]) {
    setTabOrder(names)
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(names))
  }

  function reorderTabs(from: number, to: number) {
    const list = orderedSessions ?? []
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return
    const names = list.map((s) => s.name)
    const [moved] = names.splice(from, 1)
    names.splice(to, 0, moved)
    saveTabOrder(names)
  }

  const drag = useDragReorder({
    onReorder: reorderTabs,
    onLongPress: (i, x, y) => {
      const s = orderedSessions?.[i]
      if (s) setContextMenu({ session: s, x, y })
    },
    // 길게누르기로 연 메뉴는 드래그가 시작되면 닫는다
    onDragStart: () => setContextMenu(null),
  })

  function refresh() {
    api
      .fetchSessions()
      .then((list) => {
        setSessions(list)
        // StrictMode는 개발 모드에서 setState 업데이터 함수를 순수성 검증차 두 번 호출한다 —
        // ref mutation을 업데이터 "안"에 두면 두 번째 호출이 그 mutation을 이미 반영된 걸로 보고
        // 다른 분기를 타 버린다. 그래서 autoSelected 판단·mutation은 업데이터 밖에서 미리 끝낸다.
        const shouldAutoSelect = !autoSelected.current && list.length > 0
        if (shouldAutoSelect) autoSelected.current = true
        setActiveSession((cur) => {
          if (cur && list.some((s) => s.name === cur)) return cur
          if (!shouldAutoSelect) return null
          // 새로고침/재접속 시 이전에 보던 세션으로 복원 — 그 세션이 아직 있으면 우선
          const remembered = localStorage.getItem(ACTIVE_SESSION_KEY)
          if (remembered && list.some((s) => s.name === remembered)) return remembered
          return list[0].name
        })
      })
      .catch(console.error)
  }

  useEffect(() => {
    if (activeSession) localStorage.setItem(ACTIVE_SESSION_KEY, activeSession)
  }, [activeSession])

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
        await api.createSession(value)
        setEditing(null)
        setActiveSession(value)
      } else {
        if (value === editing.oldName) {
          setEditing(null)
          return
        }
        await api.renameSession(editing.oldName, value)
        setEditing(null)
        setActiveSession((cur) => (cur === editing.oldName ? value : cur))
        // 저장된 탭 순서·입력 초안도 새 이름을 따라간다
        if (tabOrder.includes(editing.oldName)) saveTabOrder(tabOrder.map((n) => (n === editing.oldName ? value : n)))
        renameInputDraft(editing.oldName, value)
      }
      refresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err))
    }
  }

  async function killConfirmed() {
    const name = killTarget
    setKillTarget(null)
    if (!name) return
    try {
      await api.killSession(name)
      clearInputDraft(name)
      if (activeSession === name) setActiveSession(null)
      refresh()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  // 탭 닫기는 tmux 세션 종료이므로 기존 × 버튼과 같은 확인 흐름을 쓴다.
  useFocusedShortcutScope(shortcutScopeRef, { closeTab: () => {
    if (!activeSession) return false
    setKillTarget(activeSession)
    return true
  } })

  return (
    // onMouseDown: 세션 탭·도구 버튼을 눌러도 포커스(=모바일 키보드)를 뺏지 않는다. 뺏기면 키보드가
    // 내려가며 레이아웃이 커지고, 버튼이 손가락 밑에서 밀려나 첫 탭의 click이 사라진다
    <div ref={shortcutScopeRef} className="flex h-full w-full flex-col bg-surface-deep" onMouseDown={keepFocusOnPress}>
      <div className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
        <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto">
          {(orderedSessions ?? []).map((s, i) => {
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
                isDragging={drag.dragIndex === i}
                dragProps={drag.getItemProps(i)}
                onSelect={() => setActiveSession(s.name)}
                onConsumeClick={drag.consumeClick}
                onOpenMenu={(x, y) => setContextMenu({ session: s, x, y })}
                onRename={() => startRename(s)}
                onKill={() => setKillTarget(s.name)}
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
              title="새 탭"
              aria-label="새 탭"
              className="flex h-full w-9 shrink-0 items-center justify-center border-r border-edge text-ink-secondary hover:bg-surface-raised hover:text-ink"
            >
              <PlusGlyph />
            </button>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="터미널 닫기"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {activeSession ? (
          <TmuxTerminal
            key={activeSession}
            sessionName={activeSession}
            activeFilePath={activeFilePath}
            getSelectedText={getSelectedText}
            renderCommandButtons={renderCommandButtons}
            wsPath={wsPath}
          />
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

      {killTarget !== null && (
        <ConfirmDialog
          message={`세션 "${killTarget}"을(를) 종료할까요?`}
          detail="실행 중인 프로세스가 함께 종료됩니다."
          confirmLabel="종료"
          danger
          onConfirm={killConfirmed}
          onCancel={() => setKillTarget(null)}
        />
      )}
      {errorMsg !== null && <ConfirmDialog message={errorMsg} onConfirm={() => setErrorMsg(null)} />}
    </div>
  )
}

/** 에이전트 창의 새 탭 버튼과 같은 아이콘·획 규격. */
function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
