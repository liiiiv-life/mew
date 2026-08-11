// 에이전트 창 — ACP 세션과 대화하는 채팅 패널(터미널이 아니다). 서버 쪽은 server/agentAcp.ts.
// **탭 하나가 세션 하나**다: 탭마다 자기 WS·자기 대화·서버 쪽 자식 프로세스를 하나씩 가진다.
// 대화 화면은 전부 서버가 보내 준 이벤트에서 파생한다(접는 규칙은 utils/agentFold.ts) — 재접속하면
// 지나간 이벤트를 그대로 되받으므로 클라이언트가 따로 대화를 저장하지 않아도 복원된다.
// 정보줄(세션·토큰·턴 수)은 이벤트가 아니라 서버가 보내는 meta 스냅샷을 그대로 그린다.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import MarkdownIt from 'markdown-it'
import { keepFocusOnPress, useOverlayDismiss } from '@mew/ui'
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

/**
 * 창에서 고를 수 있는 에이전트 런타임 — 서버의 RUNTIMES(server/agentAcp.ts)와 id가 같아야 한다.
 * 목록이 양쪽에 있는 것은 **아이콘 때문**이다(서버는 spawn 명령만 안다). 판정은 언제나 서버가 한다 —
 * 여기 없는 id를 보내도 WS가 400으로 끊는다.
 */
const RUNTIMES = [
  { id: 'claude', label: 'Claude Code', Glyph: ClaudeGlyph },
  { id: 'hermes', label: 'Hermes', Glyph: HermesGlyph },
]

const RUNTIME_KEY = 'mew:agent-runtime'
const TABS_KEY = 'mew:agent-tabs'

/** 아직 아무 말도 오가지 않은 탭의 이름 — 이 상태의 탭은 화면에 지난 세션 목록을 대신 그린다 */
const NEW_TAB_LABEL = '새 대화'

/** 탭 이름은 첫 질문에서 뽑고 브라우저에만 남는다(서버는 탭 id만 안다) */
type AgentTab = { id: string; label: string }

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

/**
 * 에이전트 답변을 그릴 마크다운 — 모델이 만든 글이므로 raw HTML은 끈다(html:false).
 * 그러면 `<script>` 같은 건 태그가 아니라 글자로 이스케이프돼 들어간다.
 * breaks:true — 채팅에서는 줄바꿈 하나가 그대로 줄바꿈이어야 말이 된다.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
// 링크는 새 탭으로 — 이 창 안에서 열리면 돌아가던 세션 화면을 통째로 잃는다
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noreferrer noopener')
  return self.renderToken(tokens, idx, options)
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
}: {
  value: string
  options: { id: string; label: string }[]
  onPick: (id: string) => void
  title: string
  /** 버튼에 이름 대신 그릴 것(런타임 아이콘) */
  trigger?: ReactNode
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

  const current = options.find((o) => o.id === value)
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          {options.map((option) => (
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
        </div>
      )}
    </div>
  )
}

/**
 * 빈 탭의 화면 — 지난 세션 목록이다. 고르면 이 탭이 그 대화를 이어받고(CLI의 `/resume`),
 * 그냥 아래에 입력하면 이미 잡혀 있는 새 세션으로 간다. 새 탭 = 새 대화이므로 따로 '새 세션' 버튼은 없다.
 */
function SessionPicker({
  sessions,
  takenIds,
  loadingSession,
  onPick,
}: {
  sessions: SessionInfo[] | null
  /** 다른 탭이 이미 열어 둔 세션 — 같은 세션을 두 프로세스가 붙들면 전사가 엉킨다 */
  takenIds: string[]
  loadingSession: string | null
  onPick: (session: SessionInfo) => void
}) {
  return (
    <div className="text-xs">
      <div className="px-2 pb-2 text-ink-muted">이어서 할 대화를 고르거나, 아래에 바로 입력해 새 대화를 시작하세요.</div>
      {sessions === null && <div className="px-2 py-2 text-ink-muted">불러오는 중…</div>}
      {sessions?.length === 0 && <div className="px-2 py-2 text-ink-muted">이 워크스페이스에 지난 세션이 없습니다.</div>}
      {sessions?.map((session) => {
        const taken = takenIds.includes(session.sessionId)
        return (
          <button
            key={session.sessionId}
            type="button"
            onClick={() => onPick(session)}
            disabled={taken || loadingSession !== null}
            className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-surface-raised disabled:opacity-40"
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
  )
}

/** 탭 줄 — 탭 하나가 세션 하나다. `+`는 빈 탭(= 지난 세션 고르기 화면)을 연다 */
function AgentTabBar({
  tabs,
  activeId,
  infos,
  onActivate,
  onAdd,
  onCloseTab,
  onClosePanel,
}: {
  tabs: AgentTab[]
  activeId: string
  infos: Record<string, TabInfo>
  onActivate: (id: string) => void
  onAdd: () => void
  onCloseTab: (id: string) => void
  onClosePanel: () => void
}) {
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId
          return (
            <div
              key={tab.id}
              onClick={() => onActivate(tab.id)}
              className={`group flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-3 text-xs select-none ${
                isActive ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
              }`}
            >
              {/* 안 보고 있는 탭이 돌고 있는지 — 탭 줄에서 바로 보이는 유일한 신호다 */}
              {infos[tab.id]?.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent-strong" />}
              <span className="max-w-[9rem] truncate">{tab.label}</span>
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
        <button
          type="button"
          onClick={onAdd}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
          aria-label="새 탭"
          title="새 탭 (지난 세션 고르기)"
        >
          <PlusGlyph />
        </button>
      </div>
      <button
        type="button"
        onClick={onClosePanel}
        className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
        aria-label="에이전트 창 닫기"
      >
        <XGlyph />
      </button>
    </div>
  )
}

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const [tabs, setTabs] = useState<AgentTab[]>(loadTabs)
  const [activeId, setActiveId] = useState(() => tabs[0].id)
  // 한 번이라도 연 탭만 붙인다 — 탭 하나가 에이전트 프로세스 하나라, 복원된 탭까지 다 띄우면 우르르 뜬다
  const [opened, setOpened] = useState<Set<string>>(() => new Set([tabs[0].id]))
  const [infos, setInfos] = useState<Record<string, TabInfo>>({})
  // 탭을 닫을 때 그 탭의 WS로 close_session을 보내야 한다 — 창을 닫는 것과 달리 세션을 끝내는 뜻이다
  const sendersRef = useRef(new Map<string, (payload: Record<string, unknown>) => void>())

  useOverlayDismiss(onClose)

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
  }, [tabs])

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

  const register = useCallback((id: string, send: ((payload: Record<string, unknown>) => void) | null) => {
    if (send) sendersRef.current.set(id, send)
    else sendersRef.current.delete(id)
  }, [])

  const setTabLabel = useCallback((id: string, label: string) => {
    setTabs((prev) =>
      prev.find((tab) => tab.id === id)?.label === label ? prev : prev.map((tab) => (tab.id === id ? { ...tab, label } : tab)),
    )
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
    >
      <AgentTabBar
        tabs={tabs}
        activeId={activeId}
        infos={infos}
        onActivate={activate}
        onAdd={addTab}
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
  infos,
  onLabel,
  onInfo,
  onRegister,
}: {
  tabId: string
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

  // 에디터에서 누른 Ctrl+L의 [경로:줄] 참조를 입력창에 이어 붙인다 — 터미널과 같은 broadcast를 받는다
  useEffect(() => {
    const onInsertRef = (e: Event) => setDraft((d) => d + (e as CustomEvent<string>).detail)
    window.addEventListener('mew:insert-ref', onInsertRef)
    return () => window.removeEventListener('mew:insert-ref', onInsertRef)
  }, [])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    let ws: WebSocket
    // 런타임을 갈아탄 뒤 옛 대화가 새 세션의 되돌림 이벤트 앞에 남지 않게 비운다
    setEvents([])
    setModels(null)
    setModes(null)
    setMeta(null)

    const connect = () => {
      // 빈 탭이 곧바로 지난 세션을 그릴 수 있게, 붙자마자 한 번만 목록을 물어본다(capability가 있을 때만)
      let listed = false
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const query = `runtime=${encodeURIComponent(runtime)}&tab=${encodeURIComponent(tabId)}`
      ws = new WebSocket(`${proto}//${location.host}/api/agent/ws?${query}`)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (raw) => {
        const event = JSON.parse(String(raw.data)) as AgentEvent
        if (event.type === 'ready') return
        if (event.type === 'models') return setModels(event.models)
        if (event.type === 'modes') return setModes(event.modes)
        if (event.type === 'meta') {
          if (!listed && event.meta.canList) {
            listed = true
            ws.send(JSON.stringify({ type: 'list_sessions' }))
          }
          return setMeta(event.meta)
        }
        if (event.type === 'sessions') return setSessions(event.sessions)
        // 히스토리 불러오기 — 지금까지 그린 대화를 버린다
        if (event.type === 'reset') {
          setLoadingSession(null)
          return setEvents([])
        }
        setEvents((prev) => [...prev, event])
      }
      ws.onclose = () => {
        if (closed) return
        setConnected(false)
        setEvents([])
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
  }, [runtime, tabId])

  // 경과 시간만 흐르게 한다 — 나머지 값은 서버 meta가 밀어 준다
  useEffect(() => {
    if (!showInfo) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [showInfo])

  const items = useMemo(() => foldEvents(events), [events])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

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

  const submit = () => {
    const text = draft.trim()
    if (!text || !connected) return
    // 진행 중이어도 막지 않는다 — 서버가 줄을 세웠다가 턴이 끝나면 이어서 돈다
    send({ type: 'prompt', text })
    setDraft('')
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

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {/* 아직 아무 말도 오가지 않은 탭 = 새 대화 자리 — 대신 지난 세션을 고르는 화면을 그린다.
            meta(=에이전트가 떴다)나 세션 목록 중 먼저 오는 것으로 그린다. 목록은 디스크만 읽어 먼저 오고,
            되받을 대화가 있는 탭은 세션이 이미 살아 있어서 이벤트가 그보다 먼저 replay된다 */}
        {(meta || sessions !== null) && items.length === 0 && (
          <SessionPicker
            sessions={sessions}
            takenIds={takenIds}
            loadingSession={loadingSession}
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
              <div key={item.key} className="ml-6 rounded-lg bg-surface-raised">
                <button
                  type="button"
                  onClick={() => toggle(item.key)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-ink"
                >
                  <span className="shrink-0 pt-1 text-ink-secondary"><CaretGlyph dir={open ? 'down' : 'right'} /></span>
                  <span className={`min-w-0 flex-1 ${open ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>{item.text}</span>
                </button>
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
                  <button type="button" onClick={() => toggle(item.key)} className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-xs text-ink-secondary hover:text-ink">
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${BUBBLE_DOT[state]}`}
                      title={BUBBLE_LABEL[state]}
                      aria-label={BUBBLE_LABEL[state]}
                    />
                    <span className="shrink-0 pt-0.5"><CaretGlyph dir={open ? 'down' : 'right'} /></span>
                    <span className={open ? 'sr-only' : 'line-clamp-2 text-ink'}>{summary}</span>
                  </button>
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
                            dangerouslySetInnerHTML={{ __html: md.render(child.text) }}
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
      </div>

      {queued.length > 0 && (
        <div className="space-y-1 border-t border-edge bg-surface px-3 py-1.5 text-xs">
          <div className="text-ink-muted">대기 {queued.length}건 — 지금 턴이 끝나면 순서대로 보냅니다</div>
          {queued.map((text, index) => (
            <div key={`${index}-${text}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ink-secondary">{text}</span>
              <button
                type="button"
                onClick={() => send({ type: 'unqueue', index })}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink"
                aria-label="대기 메시지 취소"
              >
                <XGlyph small />
              </button>
            </div>
          ))}
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

/** Claude Code — Anthropic의 방사형 표식 */
function ClaudeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0">
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
    </svg>
  )
}

/** Hermes — 날개 달린 투구 */
function HermesGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M7 14a5 5 0 0 1 10 0v3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" />
      <path d="M7 10 2 8m5 4-4 1" />
      <path d="m17 10 5-2m-5 4 4 1" />
    </svg>
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
