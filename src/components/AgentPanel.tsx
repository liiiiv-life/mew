// 에이전트 창 — ACP 세션과 대화하는 채팅 패널(터미널이 아니다). 서버 쪽은 server/agentAcp.ts.
// **탭 하나가 세션 하나**다: 탭마다 자기 WS·자기 대화·서버 쪽 자식 프로세스를 하나씩 가진다.
// 대화 화면은 전부 서버가 보내 준 이벤트에서 파생한다(접는 규칙은 utils/agentFold.ts) — 재접속하면
// 지나간 이벤트를 그대로 되받으므로 클라이언트가 따로 대화를 저장하지 않아도 복원된다.
// 정보줄(세션·토큰·턴 수)은 이벤트가 아니라 서버가 보내는 meta 스냅샷을 그대로 그린다.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { copyText, keepFocusOnPress, useDragReorder, useOverlayDismiss } from '@mew/ui'
import { renderMarkdown } from '../utils/agentMarkdown'
import { RUNTIMES } from './agentRuntimes'
import { useSwipeGesture } from '@mew/mobile-keys'
import { useGridDrag } from '../hooks/useGridDrag'
import { withAutoLabel, withRename, type AgentTab } from '../utils/agentTabs'
import {
  foldEvents,
  type AgentEvent,
  type Item,
  type ModelState,
  type ModeState,
  type SessionInfo,
  type SessionMeta,
} from '../utils/agentFold'

/** ACP가 주는 이름은 영어다 — 아는 모드만 우리 말로 바꾸고 나머지는 그대로 쓴다 */
const MODE_LABEL: Record<string, string> = {
  default: '승인 필요',
  acceptEdits: '편집 자동 승인',
  plan: '계획만',
  dontAsk: '묻지 않음(거절)',
  bypassPermissions: '권한 무시',
}

const RUNTIME_KEY = 'mew:agent-runtime'
const TABS_KEY = 'mew:agent-tabs'
/** 마지막으로 보던 탭 — 창을 다시 열거나 브라우저를 껐다 켜도 그 대화로 돌아온다 */
const ACTIVE_TAB_KEY = 'mew:agent-active-tab'

/** 아직 아무 말도 오가지 않은 탭의 이름 — 이 상태의 탭은 화면에 지난 세션 목록을 대신 그린다 */
const NEW_TAB_LABEL = '새 대화'

/** 탭 줄이 그리는 살아 있는 값 — 대화가 아니라 상태라 localStorage에 남기지 않는다 */
type TabInfo = { busy: boolean; sessionId: string }

const newTab = (): AgentTab => ({ id: Math.random().toString(36).slice(2, 10), label: NEW_TAB_LABEL })

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

/** 소프트 키보드를 띄우는 요소 — 여기 포커스가 남아 있으면 엉뚱한 탭에도 키보드가 딸려 온다 */
const KEYBOARD_OWNER = 'textarea, input, [contenteditable="true"]'

/**
 * 이 창에서 모바일 키보드를 띄우는 건 채팅 입력칸 하나뿐이다.
 *
 * 크로미움은 편집 가능한 요소에 포커스가 남아 있으면 버튼 탭까지 "키보드를 다시 띄워 달라"로 받아,
 * 뒤로가기로 내려둔 키보드를 도로 올린다. keepFocusOnPress가 버튼 탭에서 포커스를 지켜 주기 때문에
 * (그래야 click이 안 사라진다 — 그 주석 참고) 창 뒤에 깔린 에디터나 이 창의 입력칸이 포커스를 쥔 채로
 * 남고, 접기·펼치기 같은 버튼만 눌러도 키보드가 올라온다. 그래서 눌린 뒤에 포커스를 떼어 낸다.
 *
 * 떼는 시점이 둘로 갈리는 이유: 입력칸을 mousedown에서 떼면 키보드가 내려가며 레이아웃이 커지고
 * 버튼이 손가락 밑에서 밀려나 click이 통째로 사라진다. 그래서 **창 안 입력칸은 click이 끝난 뒤**,
 * 창 밖(에디터·터미널)은 곧바로 뗀다. 데스크톱은 손대지 않는다 — 키보드도 없고, 옆에서 버튼 하나
 * 눌렀다고 쓰던 문서의 커서가 날아가면 안 된다.
 */
function dropOutsideFocus(e: MouseEvent<HTMLDivElement>) {
  keepFocusOnPress(e)
  if (isDesktop()) return
  const active = document.activeElement
  if (active instanceof HTMLElement && !e.currentTarget.contains(active)) active.blur()
}

/** 창 안 버튼을 누른 뒤 입력칸의 포커스를 뗀다 — data-keep-keyboard(입력줄)는 예외로 그대로 둔다 */
function dropInputFocusAfterPress(e: MouseEvent<HTMLDivElement>) {
  if (isDesktop()) return
  const target = e.target
  if (!(target instanceof Element) || !target.closest('button') || target.closest('[data-keep-keyboard]')) return
  const active = document.activeElement
  // 버튼 자신은 놔둔다 — 키보드로 Tab·Enter 하는 사람의 포커스까지 날려 버리면 안 된다
  if (active instanceof HTMLElement && active.matches(KEYBOARD_OWNER)) active.blur()
}

/**
 * 말풍선 본문은 접기 버튼 안에 있다 — 글자를 끌어 고른 뒤 손을 떼면 그 click이 버블을 접어 버린다.
 * 골라 둔 글자가 있으면 그 클릭은 "고르기의 끝"이지 "접기"가 아니다.
 */
function hasSelection(): boolean {
  return (window.getSelection()?.toString().length ?? 0) > 0
}

function loadTabs(): AgentTab[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]')
    if (Array.isArray(saved)) {
      const tabs = saved.filter((entry): entry is AgentTab => {
        const tab = entry as AgentTab | null
        return typeof tab?.id === 'string' && typeof tab?.label === 'string'
      })
      if (tabs.length > 0) return tabs
    }
  } catch {
    /* 깨진 값이면 새 탭으로 시작한다 */
  }
  return [newTab()]
}

/** 탭 이름 — 그 대화의 첫 질문 한 줄. 아직 없으면 '새 대화'(= 지난 세션을 고를 수 있는 상태) */
function labelOf(items: Item[]): string {
  const first = items.find((item) => item.kind === 'user')
  if (!first || first.kind !== 'user') return NEW_TAB_LABEL
  const line = first.text.trim().split('\n')[0]
  if (!line) return NEW_TAB_LABEL
  return line.length > 24 ? `${line.slice(0, 24)}…` : line
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  in_progress: '실행 중',
  completed: '완료',
  failed: '실패',
}

/** 버블 상태 — 색은 한 곳에서만 정한다(턴 버블·작업 묶음·작업 한 줄이 같은 뜻이면 같은 색이어야 한다) */
type BubbleState = 'running' | 'failed' | 'cancelled' | 'done'
const BUBBLE_DOT: Record<BubbleState, string> = {
  running: 'bg-accent',
  failed: 'bg-danger',
  cancelled: 'bg-ink-muted',
  done: 'bg-success',
}
const BUBBLE_LABEL: Record<BubbleState, string> = {
  running: '작업 중',
  failed: '에러',
  cancelled: '중단됨',
  done: '완료',
}

function turnState(item: Extract<Item, { kind: 'turn' }>): BubbleState {
  if (!item.done) return 'running'
  if (item.stopReason === 'error' || item.children.some((c) => c.kind === 'error')) return 'failed'
  if (item.stopReason === 'cancelled') return 'cancelled'
  return 'done'
}

function toolState(status: string): BubbleState {
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'done'
  return 'running'
}

const nf = new Intl.NumberFormat('ko-KR')
/** 토큰 수는 자릿수가 길어 줄을 밀어낸다 — 1.2K·3.4M으로 줄인다(ko-KR은 '천·만'이 되므로 en-US) */
const tf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 몇 센트짜리 세션도 0으로 보이면 안 된다 — 1달러 밑은 세 자리까지 */
function formatUsd(cost: number): string {
  return cost < 1 ? `$${cost.toFixed(3)}` : `$${cost.toFixed(2)}`
}

function formatElapsed(iso: string | null, now: number): string {
  if (!iso) return ''
  const start = new Date(iso).getTime()
  if (Number.isNaN(start)) return ''
  const minutes = Math.max(0, Math.floor((now - start) / 60_000))
  if (minutes < 60) return `${minutes}분째`
  const hours = Math.floor(minutes / 60)
  return `${hours}시간 ${minutes % 60}분째`
}

function InfoRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="truncate text-right text-ink-secondary" title={title ?? value}>{value}</span>
    </div>
  )
}

/**
 * 헤더의 모델·권한 모드 선택 — OS 기본 <select> 대신 쓰는 자체 드롭다운.
 * 패널 헤더 바로 아래로 펼쳐지므로 포털 없이 absolute로 충분하다(잘리는 스크롤 컨테이너가 없다).
 */
function HeaderSelect({
  value,
  options,
  onPick,
  title,
  trigger,
  searchable,
}: {
  value: string
  options: { id: string; label: string }[]
  onPick: (id: string) => void
  title: string
  /** 버튼에 이름 대신 그릴 것(런타임 아이콘) */
  trigger?: ReactNode
  /** 목록이 길 때(모델) — 열리면 검색 입력이 먼저 뜬다 */
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Esc·모바일 뒤로가기가 패널 대신 이 드롭다운을 닫게 한다
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const current = options.find((o) => o.id === value)
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)) : options
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setQuery('')
          setOpen((v) => !v)
        }}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex min-w-0 max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-surface-raised hover:text-ink ${
          open ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary'
        }`}
      >
        {trigger ?? <span className="truncate">{current?.label ?? value}</span>}
        <CaretGlyph dir="down" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={title}
          className="absolute left-0 top-full z-40 mt-1 min-w-full whitespace-nowrap rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
        >
          {searchable && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter는 첫 번째 결과 선택 — 몇 글자 치고 바로 고르는 흐름
                if (e.key === 'Enter' && shown.length > 0) {
                  onPick(shown[0].id)
                  setOpen(false)
                }
              }}
              placeholder="검색"
              className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-muted"
            />
          )}
          {/* 목록이 길면(모델) 화면 아래로 삐져나가는 대신 여기서만 스크롤된다 */}
          <div className="max-h-56 overflow-y-auto">
            {shown.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onClick={() => {
                  onPick(option.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover ${
                  option.id === value ? 'text-ink' : 'text-ink-secondary'
                }`}
              >
                <span className="flex w-3.5 shrink-0 items-center justify-center">{option.id === value && <CheckGlyph />}</span>
                <span className="truncate">{option.label}</span>
              </button>
            ))}
            {shown.length === 0 && <div className="px-2.5 py-1.5 text-xs text-ink-muted">결과 없음</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 빈 탭의 화면 — [히스토리] 하나뿐이다. **누를 때 비로소** 목록을 물어본다(onOpen): 붙을 때마다 미리
 * 훑으면 세션 파일 훑기가 탭 수만큼 곱해져 창이 굳는다. 고르면 이 탭이 그 대화를 이어받고(CLI의 `/resume`),
 * 그냥 아래에 입력하면 이미 잡혀 있는 새 세션으로 간다. 새 탭 = 새 대화이므로 따로 '새 세션' 버튼은 없다.
 */
function SessionPicker({
  sessions,
  takenIds,
  loadingSession,
  onOpen,
  onPick,
}: {
  sessions: SessionInfo[] | null
  /** 다른 탭이 이미 열어 둔 세션 — 같은 세션을 두 프로세스가 붙들면 전사가 엉킨다 */
  takenIds: string[]
  loadingSession: string | null
  /** 드롭다운을 열었다 — 여기서 목록을 받아 온다 */
  onOpen: () => void
  onPick: (session: SessionInfo) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Esc·모바일 뒤로가기가 패널 대신 이 드롭다운을 닫게 한다
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  return (
    <div ref={ref} className="relative px-2 text-xs">
      <button
        type="button"
        onClick={() => {
          if (!open) onOpen()
          setOpen((v) => !v)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-raised hover:text-ink ${
          open ? 'bg-surface-raised text-ink' : 'text-ink-secondary'
        }`}
      >
        <span>히스토리</span>
        <CaretGlyph dir="down" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="지난 세션"
          className="absolute left-2 top-full z-40 mt-1 w-4/5 rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
        >
          {/* 한 번에 다섯 줄쯤만 보이고 나머지는 여기서만 스크롤된다 */}
          <div className="max-h-56 overflow-y-auto">
            {sessions === null && <div className="px-2.5 py-1.5 text-ink-muted">불러오는 중…</div>}
            {sessions?.length === 0 && (
              <div className="px-2.5 py-1.5 text-ink-muted">이 워크스페이스에 지난 세션이 없습니다.</div>
            )}
            {sessions?.map((session) => {
              const taken = takenIds.includes(session.sessionId)
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onPick(session)
                    setOpen(false)
                  }}
                  disabled={taken || loadingSession !== null}
                  className="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left hover:bg-surface-hover disabled:opacity-40"
                >
                  <span className="w-full truncate text-ink">{session.title || session.sessionId.slice(0, 8)}</span>
                  <span className="text-ink-muted">
                    {session.sessionId === loadingSession
                      ? '불러오는 중…'
                      : taken
                        ? '다른 탭에서 열림'
                        : formatTime(session.updatedAt ?? null)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** 탭 줄 — 탭 하나가 세션 하나다. `+`는 빈 탭(= 지난 세션 고르기 화면)을 연다 */
function AgentTabBar({
  tabs,
  activeId,
  infos,
  onActivate,
  onAdd,
  onRename,
  onReorder,
  onCloseTab,
  onClosePanel,
}: {
  tabs: AgentTab[]
  activeId: string
  infos: Record<string, TabInfo>
  onActivate: (id: string) => void
  onAdd: () => void
  onRename: (id: string, label: string) => void
  onReorder: (from: number, to: number) => void
  onCloseTab: (id: string) => void
  onClosePanel: () => void
}) {
  // 두 번 눌러 이름 고치기 — 고치는 동안만 여기 남는다(이름 자체는 위에서 localStorage로 간다)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  // 문서 탭·터미널 탭과 같은 훅 — 꾹 눌러 끌면 순서 바꾸기, 그냥 끌면 탭 줄 굴리기
  const drag = useDragReorder({ onReorder })
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      <button
        type="button"
        onClick={onClosePanel}
        className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
        aria-label="에이전트 창 닫기"
      >
        <XGlyph />
      </button>
      <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              {...drag.getItemProps(i)}
              onClick={() => {
                if (drag.consumeClick()) return
                onActivate(tab.id)
              }}
              onContextMenu={(e) => {
                // 터치 길게누르기가 드래그로 예약된 동안 Android 네이티브 메뉴가 끼어들지 않게
                if (drag.dragIndex !== null) e.preventDefault()
              }}
              className={`group flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-3 text-xs select-none [-webkit-touch-callout:none] ${
                isActive ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
              } ${drag.dragIndex === i ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`}
            >
              {/* 안 보고 있는 탭이 돌고 있는지 — 탭 줄에서 바로 보이는 유일한 신호다 */}
              {infos[tab.id]?.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent-strong" />}
              {editing?.id === tab.id ? (
                <input
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ id: tab.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') return setEditing(null)
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      onRename(tab.id, editing.text)
                      setEditing(null)
                    }
                  }}
                  onBlur={() => {
                    onRename(tab.id, editing.text)
                    setEditing(null)
                  }}
                  className="w-[9rem] rounded bg-surface px-1 text-xs text-ink outline-none select-text"
                  aria-label="탭 이름"
                />
              ) : (
                <span
                  onDoubleClick={() => setEditing({ id: tab.id, text: tab.label })}
                  title="두 번 눌러 이름 고치기"
                  className="max-w-[9rem] truncate"
                >
                  {tab.label}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                aria-label="탭 닫기"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
        aria-label="새 탭"
        title="새 탭 (지난 세션 고르기)"
      >
        <PlusGlyph />
      </button>
    </div>
  )
}

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const [tabs, setTabs] = useState<AgentTab[]>(loadTabs)
  // 브라우저를 껐다 켜도 보던 탭에서 이어 하도록 마지막으로 본 탭을 기억한다.
  // 그 탭이 목록에서 사라졌으면(다른 창에서 닫았거나 저장분이 깨졌으면) 첫 탭으로 돌아간다
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY)
    return saved && tabs.some((tab) => tab.id === saved) ? saved : tabs[0].id
  })
  // 한 번이라도 연 탭만 붙인다 — 탭 하나가 에이전트 프로세스 하나라, 복원된 탭까지 다 띄우면 우르르 뜬다
  const [opened, setOpened] = useState<Set<string>>(() => new Set([activeId]))
  const [infos, setInfos] = useState<Record<string, TabInfo>>({})
  // 탭을 닫을 때 그 탭의 WS로 close_session을 보내야 한다 — 창을 닫는 것과 달리 세션을 끝내는 뜻이다
  const sendersRef = useRef(new Map<string, (payload: Record<string, unknown>) => void>())

  useOverlayDismiss(onClose)

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
  }, [tabs])

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, activeId)
  }, [activeId])

  const activate = (id: string) => {
    setActiveId(id)
    setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  const addTab = () => {
    const tab = newTab()
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
    setOpened((prev) => new Set(prev).add(tab.id))
  }

  const closeTab = (id: string) => {
    sendersRef.current.get(id)?.({ type: 'close_session' })
    const index = tabs.findIndex((tab) => tab.id === id)
    const rest = tabs.filter((tab) => tab.id !== id)
    // 마지막 탭을 닫아도 창은 빈 채로 두지 않는다 — 언제나 고를 수 있는 빈 탭 하나가 있다
    const next = rest.length > 0 ? rest : [newTab()]
    setTabs(next)
    setOpened((prev) => {
      const set = new Set(prev)
      set.delete(id)
      return set.add(next[Math.min(index, next.length - 1)].id)
    })
    setInfos((prev) => {
      const { [id]: _closed, ...keep } = prev
      return keep
    })
    if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)].id)
  }

  // 화면 위 40% 좌우 스와이프로 탭 전환 — 터미널·에디터와 같은 손짓 (우→좌면 오른쪽 탭, 좌→우면 왼쪽 탭)
  const switchTab = (dir: 'left' | 'right') => {
    if (tabs.length < 2) return
    const idx = tabs.findIndex((tab) => tab.id === activeId)
    if (idx < 0) return
    const next = dir === 'left' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length
    activate(tabs[next].id)
  }
  const swipe = useSwipeGesture({
    onTopLeft: () => switchTab('left'),
    onTopRight: () => switchTab('right'),
    // 화면 아래 20%에서 좌→우로 밀면 창이 닫힌다 — 오른쪽에 붙은 창을 밀어내는 손짓, 터미널과 같다
    onBottomRight: onClose,
  })

  const register = useCallback((id: string, send: ((payload: Record<string, unknown>) => void) | null) => {
    if (send) sendersRef.current.set(id, send)
    else sendersRef.current.delete(id)
  }, [])

  // 대화에서 뽑은 이름 — 사람이 직접 붙인 이름은 건드리지 않는다(불러온 세션 제목도 여기로 온다)
  const setTabLabel = useCallback((id: string, label: string) => {
    setTabs((prev) => withAutoLabel(prev, id, label))
  }, [])

  const renameTab = useCallback((id: string, label: string) => {
    setTabs((prev) => withRename(prev, id, label))
  }, [])

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      const next = [...prev]
      next.splice(to, 0, ...next.splice(from, 1))
      return next
    })
  }, [])

  const setTabInfo = useCallback((id: string, info: TabInfo) => {
    setInfos((prev) =>
      prev[id]?.busy === info.busy && prev[id]?.sessionId === info.sessionId ? prev : { ...prev, [id]: info },
    )
  }, [])

  return (
    <div
      className="flex h-full w-full flex-col bg-surface-deep"
      onMouseDown={dropOutsideFocus}
      onClick={dropInputFocusAfterPress}
      {...swipe}
    >
      <AgentTabBar
        tabs={tabs}
        activeId={activeId}
        infos={infos}
        onActivate={activate}
        onAdd={addTab}
        onRename={renameTab}
        onReorder={reorderTabs}
        onCloseTab={closeTab}
        onClosePanel={onClose}
      />
      {/* 안 보이는 탭도 붙어 있는 채로 둔다 — 돌고 있는 대화가 탭을 바꿨다고 멎으면 안 된다 */}
      {tabs
        .filter((tab) => opened.has(tab.id))
        .map((tab) => (
          <div key={tab.id} className={tab.id === activeId ? 'min-h-0 flex-1' : 'hidden'}>
            <AgentSessionView
              tabId={tab.id}
              active={tab.id === activeId}
              infos={infos}
              onLabel={setTabLabel}
              onInfo={setTabInfo}
              onRegister={register}
            />
          </div>
        ))}
    </div>
  )
}

/** 탭 하나 — WS 하나, 세션 하나. 대화 상태는 전부 여기 안에 있다 */
function AgentSessionView({
  tabId,
  active,
  infos,
  onLabel,
  onInfo,
  onRegister,
}: {
  tabId: string
  /** 지금 보이는 탭인지 — 안 보이는 탭은 높이가 0이라 스크롤을 못 잡는다(아래 effect) */
  active: boolean
  infos: Record<string, TabInfo>
  onLabel: (tabId: string, label: string) => void
  onInfo: (tabId: string, info: TabInfo) => void
  onRegister: (tabId: string, send: ((payload: Record<string, unknown>) => void) | null) => void
}) {
  // 어느 프로젝트를 보고 있든 같은 창이다 — 스코프는 워크스페이스, 대화가 나뉘는 축은 탭과 런타임이다
  const [runtime, setRuntime] = useState(() => {
    const saved = localStorage.getItem(RUNTIME_KEY)
    return RUNTIMES.some((r) => r.id === saved) ? saved! : RUNTIMES[0].id
  })
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<ModelState | null>(null)
  const [modes, setModes] = useState<ModeState | null>(null)
  const [meta, setMeta] = useState<SessionMeta | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const wsRef = useRef<WebSocket | null>(null)

  // 에디터에서 누른 Ctrl+L의 `경로:줄` 참조를 입력창에 이어 붙인다. 창(App)이 마지막으로 연 보조창을
  // 골라 target을 실어 보내므로 에이전트 창 차례일 때만 받고, 탭이 여럿이면 **보이는 탭**만 받아 적는다
  useEffect(() => {
    const onInsertRef = (e: Event) => {
      const detail = (e as CustomEvent<{ target?: string; text: string }>).detail
      if (!active || detail.target !== 'agent') return
      setDraft((d) => d + detail.text)
    }
    window.addEventListener('mew:insert-ref', onInsertRef)
    return () => window.removeEventListener('mew:insert-ref', onInsertRef)
  }, [active])
  const scrollRef = useRef<HTMLDivElement>(null)
  // 지금 대화 바닥에 붙어 있는지 — 붙어 있을 때만 새 내용을 따라 내려간다
  const stickRef = useRef(true)
  const [unread, setUnread] = useState(false)

  // 들어오는 이벤트는 **한 프레임에 모아** 한 번만 그린다. 이벤트마다 setState하면 스트리밍 청크
  // 하나하나가 foldEvents 한 번 + 목록 전체 다시 그리기 한 번이 되어(청크는 초당 수십 개다) 창이 굳는다.
  const pendingRef = useRef<AgentEvent[]>([])
  const frameRef = useRef<number | null>(null)
  // 붙자마자 오는 첫 덩어리는 되감기다 — 지금 그린 대화에 **덧붙이지 말고 갈아끼운다**.
  // 새 서버는 replay 한 프레임으로 주고, 아직 재시작하지 않은 옛 서버는 이벤트를 하나씩 흘린다.
  // 이 스위치가 없으면 옛 서버에 다시 붙었을 때 대화가 두 벌로 이어 붙는다
  const swapRef = useRef(false)
  const queueEvent = useCallback((event: AgentEvent) => {
    pendingRef.current.push(event)
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const batch = pendingRef.current
      if (batch.length === 0) return
      pendingRef.current = []
      // 갈아끼우기 여부는 여기서 소비한다 — setEvents 콜백 안에서 ref를 건드리면 순수하지 않다
      const swap = swapRef.current
      swapRef.current = false
      // reset도 순서대로 처리한다 — 히스토리를 불러올 때 "비우기"와 "새 대화"가 같은 프레임에 들어와
      // 중간의 빈 화면이 뜨지 않는다
      setEvents((prev) => {
        const next = swap ? [] : [...prev]
        for (const item of batch) {
          if (item.type === 'reset') next.length = 0
          else next.push(item)
        }
        return next
      })
    })
  }, [])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    let ws: WebSocket
    // 런타임을 갈아탄 뒤 옛 대화가 새 세션의 되돌림 이벤트 앞에 남지 않게 비운다
    setEvents([])
    pendingRef.current = []
    setModels(null)
    setModes(null)
    setMeta(null)

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const query = `runtime=${encodeURIComponent(runtime)}&tab=${encodeURIComponent(tabId)}`
      ws = new WebSocket(`${proto}//${location.host}/api/agent/ws?${query}`)
      wsRef.current = ws
      ws.onopen = () => {
        // 다시 붙었다 — 다음에 오는 대화는 이어 붙이는 것이 아니라 지금 화면을 대신할 것이다
        swapRef.current = true
        setConnected(true)
      }
      ws.onmessage = (raw) => {
        const event = JSON.parse(String(raw.data)) as AgentEvent
        if (event.type === 'ready') return
        if (event.type === 'models') return setModels(event.models)
        if (event.type === 'modes') return setModes(event.modes)
        if (event.type === 'meta') return setMeta(event.meta)
        if (event.type === 'sessions') return setSessions(event.sessions)
        // 재접속 되감기 — 지나간 대화가 한 덩어리로 온다. 그린 것을 통째로 갈아끼우므로 중간에 비지 않는다
        if (event.type === 'replay') {
          pendingRef.current = []
          swapRef.current = false
          return setEvents(event.events)
        }
        // 히스토리 불러오기 — 지금까지 그린 대화를 버린다. 새 대화는 바닥에서 시작한다.
        // 비우는 것 자체는 아래 줄 세우기가 순서대로 처리한다(뒤따라 오는 히스토리와 같은 프레임에 그려진다)
        if (event.type === 'reset') {
          setLoadingSession(null)
          stickRef.current = true
        }
        queueEvent(event)
      }
      ws.onclose = () => {
        if (closed) return
        setConnected(false)
        // 대화는 지우지 않는다 — 잠깐 끊긴 사이 화면이 빈 탭(히스토리 드롭다운)으로 보이던 원인이다.
        // 다시 붙으면 서버가 보내는 replay가 통째로 갈아끼운다
        setMeta(null)
        retry = window.setTimeout(connect, 1000)
      }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws.close()
      wsRef.current = null
    }
    // 런타임을 바꾸면 저쪽 세션으로 갈아탄다 — 이쪽 세션은 서버에 그대로 남아 돌아오면 이어진다
    // (queueEvent는 값이 바뀌지 않는 useCallback이라 여기 있어도 재접속을 부르지 않는다)
  }, [runtime, tabId, queueEvent])

  // 경과 시간만 흐르게 한다 — 나머지 값은 서버 meta가 밀어 준다
  useEffect(() => {
    if (!showInfo) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [showInfo])

  const items = useMemo(() => foldEvents(events), [events])

  // 대화가 자라도 **바닥에 붙어 있을 때만** 따라 내려간다 — 위로 올려 읽는 중(펼친 작업 버블을 읽는
  // 중이 대부분이다)이면 자리를 그대로 두고 "새 메시지"만 띄운다. 누르면 바닥으로 가고, 스스로
  // 바닥까지 내려가도 사라진다
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setUnread(false)
  }, [])

  useEffect(() => {
    if (stickRef.current) scrollToBottom()
    else setUnread(true)
  }, [items, scrollToBottom])

  // 안 보이는 탭은 display:none이라 scrollHeight가 0이다 — 그동안 온 말은 못 따라 내려간 것이므로
  // 이 탭이 보이게 될 때 한 번 더 바닥으로 붙인다(위로 올려 두고 나간 탭은 그 자리를 지킨다)
  useEffect(() => {
    if (active && stickRef.current) scrollToBottom()
  }, [active, scrollToBottom])

  // 스트리밍으로 한두 줄씩 늘어나는 동안 붙었다 떨어졌다 하지 않게 바닥 판정에 여유를 둔다
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48
    if (stickRef.current) setUnread(false)
  }, [])

  const send = useCallback((payload: Record<string, unknown>) => wsRef.current?.send(JSON.stringify(payload)), [])

  // 탭을 닫을 때 창이 이 탭의 WS로 close_session을 보낼 수 있게 보내는 손잡이를 올려 준다
  useEffect(() => {
    onRegister(tabId, send)
    return () => onRegister(tabId, null)
  }, [onRegister, send, tabId])

  // 탭 줄이 그리는 값(이름·진행 중)은 여기서 밀어 올린다 — 안 보고 있는 탭도 살아 있어야 한다
  useEffect(() => {
    onLabel(tabId, labelOf(items))
  }, [items, onLabel, tabId])

  useEffect(() => {
    onInfo(tabId, { busy: meta?.busy ?? false, sessionId: meta?.sessionId ?? '' })
  }, [meta?.busy, meta?.sessionId, onInfo, tabId])

  /** 다른 탭이 붙들고 있는 세션 — 이 탭에서 또 열지 못하게 막는다 */
  const takenIds = useMemo(
    () =>
      Object.entries(infos)
        .filter(([id]) => id !== tabId)
        .map(([, info]) => info.sessionId),
    [infos, tabId],
  )

  const busy = meta?.busy ?? false
  const queued = meta?.queued ?? []
  const usage = meta?.usage ?? null

  // 대기 큐 재정렬 — 꾹(마우스 0.5초·터치 길게) 눌러 집은 항목을 다른 항목 위에 놓으면 서버 큐에서 자리를 옮긴다
  const queueDrag = useGridDrag({
    enabled: queued.length > 1,
    mouseHoldMs: 500,
    onMove: (from, to) => send({ type: 'move_queued', from, to }),
  })

  // 한 줄로 잘린 대기 메시지를 한 번 누르면 전문을 펴고, 두 번 누르면 그 자리에서 고친다
  const [openQueued, setOpenQueued] = useState<number | null>(null)
  // original = 고치기 시작할 때 보고 있던 원본. 그 사이 앞 턴이 끝나 큐가 당겨졌으면 서버가 이걸 보고 거른다
  const [editingQueued, setEditingQueued] = useState<{ index: number; text: string; original: string } | null>(null)
  const commitQueuedEdit = (edit: { index: number; text: string; original: string }) => {
    const text = edit.text.trim()
    if (text && text !== edit.original)
      send({ type: 'edit_queued', index: edit.index, text, expect: edit.original })
    setEditingQueued(null)
  }

  const submit = () => {
    const text = draft.trim()
    if (!text || !connected) return
    // 진행 중이어도 막지 않는다 — 서버가 줄을 세웠다가 턴이 끝나면 이어서 돈다
    send({ type: 'prompt', text })
    setDraft('')
    // 내가 말을 걸었으면 답을 보겠다는 뜻이다 — 다시 바닥에 붙인다
    stickRef.current = true
  }

  const pending = items.some((item) => item.kind === 'turn' && item.children.some((c) => c.kind === 'permission' && !c.answered))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])

  const currentRuntime = RUNTIMES.find((r) => r.id === runtime) ?? RUNTIMES[0]
  const currentModel = models?.availableModels.find((m) => m.modelId === models.currentModelId)?.name
  // meta가 오기 전 = 에이전트 프로세스가 아직 뜨는 중이다(질문은 그동안에도 받아 둔다 — 서버가 줄을 세운다)
  const status = !connected
    ? '연결 중'
    : !meta
      ? '에이전트 준비 중'
      : loadingSession
        ? '세션 불러오는 중'
        : pending
          ? '승인 대기'
          : busy
            ? '진행 중'
            : '대기 중'
  const totalTokens = usage ? usage.input + usage.output + usage.cacheWrite + usage.cacheRead : 0

  return (
    <div className="flex h-full w-full flex-col bg-surface-deep">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* 창 이름 대신 지금 붙어 있는 런타임 아이콘 — 누르면 다른 런타임으로 갈아탄다 */}
          <HeaderSelect
            value={runtime}
            options={RUNTIMES.map((r) => ({ id: r.id, label: r.label }))}
            onPick={(id) => {
              localStorage.setItem(RUNTIME_KEY, id)
              setRuntime(id)
            }}
            title={`에이전트: ${currentRuntime.label}`}
            trigger={<currentRuntime.Glyph />}
          />
          {models && models.availableModels.length > 1 ? (
            <HeaderSelect
              value={models.currentModelId}
              options={models.availableModels.map((m) => ({ id: m.modelId, label: m.name }))}
              onPick={(modelId) => send({ type: 'set_model', modelId })}
              title="모델"
              searchable
            />
          ) : (
            <span className="truncate text-xs font-normal text-ink-muted">{currentModel ?? currentRuntime.label}</span>
          )}
          {modes && modes.availableModes.length > 1 && (
            <HeaderSelect
              value={modes.currentModeId}
              options={modes.availableModes.map((mode) => ({ id: mode.id, label: MODE_LABEL[mode.id] ?? mode.name }))}
              onPick={(modeId) => send({ type: 'set_mode', modeId })}
              title="권한 모드"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`text-xs ${busy ? 'text-ink-secondary' : 'text-ink-muted'}`}>{status}</span>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className={`flex h-6 w-6 items-center justify-center rounded hover:bg-surface-raised hover:text-ink ${showInfo ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`}
            aria-label="세션 정보"
            title="세션 정보"
          >
            <InfoGlyph />
          </button>
        </div>
      </div>

      {showInfo && (
        <div className="space-y-1 border-b border-edge bg-surface px-3 py-2 text-xs">
          <InfoRow label="세션 ID" value={meta ? meta.sessionId.slice(0, 8) : '—'} title={meta?.sessionId} />
          <InfoRow
            label="시작"
            value={meta ? `${formatTime(meta.startedAt)} · ${formatElapsed(meta.startedAt, now)}` : '—'}
          />
          <InfoRow label="상태" value={status} />
          <InfoRow label="모델" value={currentModel ?? models?.currentModelId ?? '—'} />
          <InfoRow
            label="권한 모드"
            value={modes ? (MODE_LABEL[modes.currentModeId] ?? modes.currentModeId) : '—'}
          />
          <InfoRow label="대화 턴" value={meta ? `${nf.format(meta.turns)}턴` : '—'} />
          {usage ? (
            <>
              {/* 줄인 값이 화면에 나가고, 정확한 자릿수는 title로 남긴다 */}
              <InfoRow label="컨텍스트" value={`${tf.format(usage.context)} 토큰`} title={`${nf.format(usage.context)} 토큰`} />
              <InfoRow
                label="입력 / 출력"
                value={`${tf.format(usage.input)} / ${tf.format(usage.output)}`}
                title={`${nf.format(usage.input)} / ${nf.format(usage.output)}`}
              />
              <InfoRow
                label="캐시 (쓰기/읽기)"
                value={`${tf.format(usage.cacheWrite)} / ${tf.format(usage.cacheRead)}`}
                title={`${nf.format(usage.cacheWrite)} / ${nf.format(usage.cacheRead)}`}
              />
              <InfoRow label="전체 토큰" value={`${tf.format(totalTokens)} 토큰`} title={`${nf.format(totalTokens)} 토큰`} />
              {/* 구독제(Claude Code)로 돌면 실제로 나가는 돈이 아니다 — 같은 토큰의 API 정가 환산값이다 */}
              <InfoRow
                label="API 환산 비용"
                // 서버가 아직 안 올라왔으면 cost 자체가 없다 — 없는 값에 toFixed를 걸어 패널이 죽지 않게 한다
                value={typeof usage.cost === 'number' ? formatUsd(usage.cost) : '값 없는 모델'}
                title="같은 토큰을 API로 샀을 때의 정가. 구독제 세션이면 실제 청구액이 아니다"
              />
            </>
          ) : (
            <InfoRow label="토큰" value="기록 없음" />
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {/* 아직 아무 말도 오가지 않은 탭 = 새 대화 자리 — 대신 [히스토리] 드롭다운만 그린다.
            목록 자체는 그 드롭다운을 열 때 받아 온다(붙자마자 미리 받지 않는다).
            되받을 대화가 있는 탭은 이벤트가 replay되면서 이 자리가 대화로 바뀐다 */}
        {connected && items.length === 0 && (
          <SessionPicker
            sessions={sessions}
            takenIds={takenIds}
            loadingSession={loadingSession}
            onOpen={() => {
              // 열 때마다 새로 물어본다 — 그 사이 다른 탭에서 돈 대화가 목록에 있어야 한다
              setSessions(null)
              send({ type: 'list_sessions' })
            }}
            onPick={(session) => {
              setLoadingSession(session.sessionId)
              onLabel(tabId, session.title || session.sessionId.slice(0, 8))
              send({ type: 'load_session', sessionId: session.sessionId })
            }}
          />
        )}
        {items.map((item) => {
          if (item.kind === 'user') {
            // 내가 쓴 말이라 이미 아는 내용이다 — 턴 버블과 같게 접어 두고, 눌러야 다 보인다
            const open = expanded.has(item.key)
            return (
              <div key={item.key} className="ml-6 flex items-start rounded-lg bg-surface-raised">
                <button
                  type="button"
                  onClick={() => {
                    if (hasSelection()) return
                    toggle(item.key)
                  }}
                  className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-ink"
                >
                  <span className="shrink-0 pt-1 text-ink-secondary"><CaretGlyph dir={open ? 'down' : 'right'} /></span>
                  <span className={`min-w-0 flex-1 select-text ${open ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>{item.text}</span>
                </button>
                <CopyButton text={item.text} label="이 질문 복사" />
              </div>
            )
          }
          if (item.kind === 'turn') {
            const open = expanded.has(item.key)
            // 턴 요약: 마지막 agent 텍스트의 첫 줄
            const lastAgent = [...item.children].reverse().find((c) => c.kind === 'agent')
            const summary = lastAgent && lastAgent.kind === 'agent'
              ? (lastAgent.text.length > 80 ? lastAgent.text.slice(0, 80) + '…' : lastAgent.text)
              : '작업 중…'
            const state = turnState(item)
            return (
              <div key={item.key} className="rounded-lg border border-edge bg-surface">
                <div className="flex items-start">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasSelection()) return
                      toggle(item.key)
                    }}
                    className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-xs text-ink-secondary hover:text-ink"
                  >
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${BUBBLE_DOT[state]}`}
                      title={BUBBLE_LABEL[state]}
                      aria-label={BUBBLE_LABEL[state]}
                    />
                    <span className="shrink-0 pt-0.5"><CaretGlyph dir={open ? 'down' : 'right'} /></span>
                    <span className={open ? 'sr-only' : 'line-clamp-2 select-text text-ink'}>{summary}</span>
                  </button>
                  {/* 답변만 모아 복사한다 — 생각·도구 기록은 빼고 사람이 읽으라고 쓴 글만 */}
                  <CopyButton
                    text={item.children
                      .filter((c) => c.kind === 'agent')
                      .map((c) => (c.kind === 'agent' ? c.text : ''))
                      .join('\n\n')}
                    label="이 답변 복사"
                  />
                  {/* 돌고 있는 턴만 중단할 수 있다 — 지난 턴에는 버튼이 없다 */}
                  {busy && !item.done && (
                    <button
                      type="button"
                      onClick={() => send({ type: 'cancel' })}
                      className="m-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
                      aria-label="중단"
                      title="중단"
                    >
                      <span className="h-2.5 w-2.5 rounded-[1px] bg-current" />
                    </button>
                  )}
                </div>
                {open && (
                  <div className="space-y-2 border-t border-edge px-3 py-2">
                    {item.children.map((child) => {
                      if (child.kind === 'agent')
                        // 답변은 마크다운이다 — 목록·굵기·코드블럭을 글자 그대로 두지 않고 그린다
                        // (prose = @tailwindcss/typography, 다크는 index.css의 .dark 변형을 그대로 탄다)
                        return (
                          <div
                            key={child.key}
                            className="prose prose-sm max-w-none text-ink dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-surface-deep prose-code:text-ink-secondary"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(child.text) }}
                          />
                        )
                      if (child.kind === 'thought')
                        return <div key={child.key} className="whitespace-pre-wrap text-xs text-ink-muted italic">{child.text}</div>
                      if (child.kind === 'tool_group') {
                        const tOpen = expanded.has(child.key)
                        const failed = child.tools.filter((t) => t.status === 'failed').length
                        const running = child.tools.some((t) => t.status === 'in_progress' || t.status === 'pending')
                        const tSummary = `${running ? '작업 중' : failed ? `${failed}개 실패` : '완료'} · ${child.tools.length}개 작업`
                        const gState: BubbleState = failed ? 'failed' : running ? 'running' : 'done'
                        return (
                          <div key={child.key} className="rounded border border-edge bg-surface-deep px-2 py-1">
                            <button type="button" onClick={() => toggle(child.key)} className="flex w-full items-center gap-2 text-xs text-ink-secondary hover:text-ink">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BUBBLE_DOT[gState]}`} />
                              <CaretGlyph dir={tOpen ? 'down' : 'right'} />
                              <span>{tSummary}</span>
                            </button>
                            {tOpen && (
                              <div className="mt-1 space-y-0.5 border-t border-edge pt-1">
                                {child.tools.map((t) => (
                                  <div key={t.id} className="flex items-center gap-2 text-xs text-ink-secondary">
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BUBBLE_DOT[toolState(t.status)]}`} />
                                    <span className="truncate">{t.title}</span>
                                    <span className="shrink-0 text-ink-muted">{STATUS_LABEL[t.status] ?? t.status}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      }
                      if (child.kind === 'permission')
                        return (
                          <div key={child.key} className="rounded border border-edge-bright bg-surface-deep px-2 py-1.5">
                            <div className="mb-1.5 text-xs text-ink-secondary">{child.title}</div>
                            {child.answered ? (
                              <div className="text-xs text-ink-muted">응답함</div>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {child.options.map((option) => (
                                  <button
                                    key={option.optionId}
                                    type="button"
                                    onClick={() => send({ type: 'permission', id: child.id, optionId: option.optionId })}
                                    className={`rounded px-2 py-1 text-xs ${option.kind.startsWith('allow') ? 'bg-accent text-ink' : 'bg-surface-raised text-ink-secondary'} hover:bg-surface-hover`}
                                  >
                                    {option.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      return <div key={child.key} className="text-xs text-danger">{child.text}</div>
                    })}
                    {/* 긴 버블은 끝까지 읽고 나면 위로 돌아갈 필요 없이 여기서 접는다 */}
                    <div className="flex justify-end pt-0.5">
                      <button
                        type="button"
                        onClick={() => toggle(item.key)}
                        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink"
                      >
                        <CaretGlyph dir="up" /> 접기
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          }
          return (
            <div key={item.key} className="rounded-lg bg-surface px-3 py-2 text-xs text-danger">
              {item.text}
            </div>
          )
        })}
        {/* 올려 읽는 동안 밑에서 대화가 자랐다는 표시 — 누르면 바닥으로 간다(바닥에 닿으면 스스로 사라진다).
            찾기 바(에디터)와 같은 수법: 스크롤 컨테이너에 sticky로 붙는 높이 0짜리 앵커라 본문을 밀지 않는다.
            marginTop은 인라인으로 지운다 — 부모의 space-y-3가 이 앵커에도 간격을 넣기 때문 */}
        {unread && (
          <div className="sticky bottom-0 z-10 h-0" style={{ marginTop: 0 }}>
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface-inverse px-3 py-1 text-xs text-ink-inverse shadow-lg"
            >
              새 메시지 <CaretGlyph dir="down" />
            </button>
          </div>
        )}
      </div>

      {queued.length > 0 && (
        <div className="space-y-1 border-t border-edge bg-surface px-3 py-1.5 text-xs">
          <div className="text-ink-muted">대기 {queued.length}건 — 지금 턴이 끝나면 순서대로 보냅니다</div>
          {queued.map((text, index) => {
            const drag = queueDrag.drag
            const lifted = drag !== null && drag.slot === index
            const editing = editingQueued?.index === index ? editingQueued : null
            return (
              <div
                key={`${index}-${text}`}
                ref={queueDrag.registerCell(index)}
                // 고치는 중에는 드래그를 떼어 둔다 — 글자를 끌어 고르는 동안 타일이 들려 버린다
                {...(editing ? {} : queueDrag.getTileProps(index))}
                style={lifted ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
                className={`flex items-center gap-2 ${editing ? '' : 'select-none'} ${
                  lifted
                    ? 'relative z-10 rounded bg-surface-raised opacity-80'
                    : drag !== null && drag.target === index
                      ? 'rounded bg-surface-raised'
                      : ''
                }`}
              >
                {editing ? (
                  <textarea
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditingQueued({ ...editing, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') return setEditingQueued(null)
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        commitQueuedEdit(editing)
                      }
                    }}
                    onBlur={() => commitQueuedEdit(editing)}
                    rows={3}
                    className="min-w-0 flex-1 resize-none rounded bg-surface-raised px-2 py-1 text-xs text-ink outline-none"
                  />
                ) : (
                  <span
                    onClick={() => {
                      if (queueDrag.consumeClick()) return
                      setOpenQueued(openQueued === index ? null : index)
                    }}
                    onDoubleClick={() => setEditingQueued({ index, text, original: text })}
                    title="한 번 눌러 전문 보기 · 두 번 눌러 고치기"
                    className={`min-w-0 flex-1 cursor-pointer text-ink-secondary ${
                      openQueued === index ? 'whitespace-pre-wrap break-words' : 'truncate'
                    }`}
                  >
                    {text}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (queueDrag.consumeClick()) return
                    send({ type: 'unqueue', index })
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink"
                  aria-label="대기 메시지 취소"
                >
                  <XGlyph small />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 키보드를 쥐어도 되는 유일한 자리 — 전송 버튼을 눌러도 이어 쓰도록 포커스를 뺏지 않는다 */}
      <div className="flex items-end gap-2 border-t border-edge p-2" data-keep-keyboard>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={pending ? '승인을 기다리는 중입니다' : busy ? '보내면 대기열에 쌓입니다 (Ctrl+Enter)' : '메시지 (Ctrl+Enter 전송)'}
          className="min-w-0 flex-1 resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!connected || !draft.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent text-ink disabled:opacity-40"
          aria-label="전송"
          title="전송 (Ctrl+Enter)"
        >
          <SendGlyph />
        </button>
      </div>
    </div>
  )
}

/** 접기·펼치기와 드롭다운 화살표를 하나로 — dir만 바꿔 돌려 쓴다 */
function CaretGlyph({ dir }: { dir: 'right' | 'down' | 'up' }) {
  const rotate = dir === 'down' ? 'rotate-90' : dir === 'up' ? '-rotate-90' : ''
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${rotate}`}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

/** 버블 텍스트를 통째로 클립보드에 넣는다 — 끌어 고르지 않고 한 번에 가져가는 길 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(timer)
  }, [done])
  if (!text.trim()) return null
  return (
    <button
      type="button"
      onClick={() => void copyText(text).then((ok) => ok && setDone(true))}
      className="m-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
      aria-label={label}
      title={label}
    >
      {done ? <CheckGlyph /> : <CopyGlyph />}
    </button>
  )
}

function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="13" height="13" x="9" y="9" rx="2" />
      <path d="M5 15c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 12 5 5L20 6" />
    </svg>
  )
}

function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function InfoGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  )
}

function XGlyph({ small }: { small?: boolean }) {
  const s = small ? 12 : 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function SendGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m22 2-11 11" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  )
}
