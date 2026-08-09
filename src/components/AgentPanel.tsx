// 에이전트 창 — ACP 세션과 대화하는 채팅 패널(터미널이 아니다). 서버 쪽은 server/agentAcp.ts.
// 대화 화면은 전부 서버가 보내 준 이벤트에서 파생한다(접는 규칙은 utils/agentFold.ts) — 재접속하면
// 지나간 이벤트를 그대로 되받으므로 클라이언트가 따로 대화를 저장하지 않아도 복원된다.
// 정보줄(세션·토큰·턴 수)은 이벤트가 아니라 서버가 보내는 meta 스냅샷을 그대로 그린다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepFocusOnPress, useOverlayDismiss } from '@mew/ui'
import {
  foldEvents,
  type AgentEvent,
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

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  in_progress: '실행 중',
  completed: '완료',
  failed: '실패',
}

const nf = new Intl.NumberFormat('ko-KR')

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
}: {
  value: string
  options: { id: string; label: string }[]
  onPick: (id: string) => void
  title: string
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
        <span className="truncate">{current?.label ?? value}</span>
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

/** 지난 세션 목록 — 고르면 그 대화를 불러온다(CLI의 `/resume`) */
function SessionList({
  sessions,
  currentId,
  loadingSession,
  onPick,
  onClose,
}: {
  sessions: SessionInfo[] | null
  currentId: string
  loadingSession?: string | null
  onPick: (sessionId: string) => void
  onClose: () => void
}) {
  useOverlayDismiss(onClose)
  return (
    <div className="max-h-64 overflow-y-auto border-b border-edge bg-surface px-3 py-2 text-xs">
      {sessions === null && <div className="py-2 text-ink-muted">불러오는 중…</div>}
      {sessions?.length === 0 && <div className="py-2 text-ink-muted">이 프로젝트에 지난 세션이 없습니다.</div>}
      {sessions?.map((session) => (
        <button
          key={session.sessionId}
          type="button"
          onClick={() => onPick(session.sessionId)}
          disabled={session.sessionId === currentId || session.sessionId === loadingSession}
          className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-surface-raised disabled:opacity-40"
        >
          <span className="w-full truncate text-ink">{session.title || session.sessionId.slice(0, 8)}</span>
          <span className="text-ink-muted">
            {session.sessionId === loadingSession ? '불러오는 중…' : formatTime(session.updatedAt ?? null)}
            {session.sessionId === currentId ? ' · 현재 세션' : ''}
          </span>
        </button>
      ))}
    </div>
  )
}

export function AgentPanel({ project, onClose }: { project: string; onClose: () => void }) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<ModelState | null>(null)
  const [modes, setModes] = useState<ModeState | null>(null)
  const [meta, setMeta] = useState<SessionMeta | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const wsRef = useRef<WebSocket | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useOverlayDismiss(onClose)

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    let ws: WebSocket

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${proto}//${location.host}/api/agent/ws?project=${encodeURIComponent(project)}`)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (raw) => {
        const event = JSON.parse(String(raw.data)) as AgentEvent
        if (event.type === 'ready') return
        if (event.type === 'models') return setModels(event.models)
        if (event.type === 'modes') return setModes(event.modes)
        if (event.type === 'meta') return setMeta(event.meta)
        if (event.type === 'sessions') return setSessions(event.sessions)
        // 새 세션·히스토리 불러오기 — 지금까지 그린 대화를 버린다
        if (event.type === 'reset') {
          setLoadingSession(null)
          setShowSessions(false)
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
  }, [project])

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

  const openSessions = () => {
    if (showSessions) return setShowSessions(false)
    setSessions(null)
    setShowSessions(true)
    send({ type: 'list_sessions' })
  }

  const pending = items.some((item) => item.kind === 'turn' && item.children.some((c) => c.kind === 'permission' && !c.answered))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])

  const currentModel = models?.availableModels.find((m) => m.modelId === models.currentModelId)?.name
  const status = !connected ? '연결 중' : loadingSession ? '세션 불러오는 중' : pending ? '승인 대기' : busy ? '진행 중' : '대기 중'
  const totalTokens = usage ? usage.input + usage.output + usage.cacheWrite + usage.cacheRead : 0

  return (
    <div className="flex h-full w-full flex-col bg-surface-deep" onMouseDown={keepFocusOnPress}>
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold text-ink-soft">에이전트</span>
          {models && models.availableModels.length > 1 ? (
            <HeaderSelect
              value={models.currentModelId}
              options={models.availableModels.map((m) => ({ id: m.modelId, label: m.name }))}
              onPick={(modelId) => send({ type: 'set_model', modelId })}
              title="모델"
            />
          ) : (
            <span className="truncate text-xs font-normal text-ink-muted">{currentModel ?? project}</span>
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
            onClick={() => send({ type: 'new_session' })}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="새 세션"
            title="새 세션 (대화 비우기)"
          >
            <PlusGlyph />
          </button>
          {meta?.canList !== false && (
            <button
              type="button"
              onClick={openSessions}
              className={`flex h-6 w-6 items-center justify-center rounded hover:bg-surface-raised hover:text-ink ${showSessions ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`}
              aria-label="이전 세션"
              title="이전 세션 불러오기"
            >
              <HistoryGlyph />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className={`flex h-6 w-6 items-center justify-center rounded hover:bg-surface-raised hover:text-ink ${showInfo ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`}
            aria-label="세션 정보"
            title="세션 정보"
          >
            <InfoGlyph />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="에이전트 창 닫기"
          >
            <XGlyph />
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
              <InfoRow label="컨텍스트" value={`${nf.format(usage.context)} 토큰`} />
              <InfoRow
                label="입력 / 출력"
                value={`${nf.format(usage.input)} / ${nf.format(usage.output)}`}
              />
              <InfoRow
                label="캐시 (쓰기/읽기)"
                value={`${nf.format(usage.cacheWrite)} / ${nf.format(usage.cacheRead)}`}
              />
              <InfoRow label="전체 토큰" value={`${nf.format(totalTokens)} 토큰`} />
            </>
          ) : (
            <InfoRow label="토큰" value="기록 없음" />
          )}
        </div>
      )}

      {showSessions && (
        <SessionList
          sessions={sessions}
          currentId={meta?.sessionId ?? ''}
          loadingSession={loadingSession}
          onClose={() => setShowSessions(false)}
          onPick={(sessionId) => {
            setLoadingSession(sessionId)
            send({ type: 'load_session', sessionId })
          }}
        />
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {items.length === 0 && <div className="py-8 text-center text-sm text-ink-muted">이 프로젝트 안에서만 작업합니다.</div>}
        {items.map((item) => {
          if (item.kind === 'user')
            return (
              <div key={item.key} className="ml-6 rounded-lg bg-surface-raised px-3 py-2 whitespace-pre-wrap text-ink">
                {item.text}
              </div>
            )
          if (item.kind === 'turn') {
            const open = expanded.has(item.key)
            // 턴 요약: 마지막 agent 텍스트의 첫 줄
            const lastAgent = [...item.children].reverse().find((c) => c.kind === 'agent')
            const summary = lastAgent && lastAgent.kind === 'agent'
              ? (lastAgent.text.length > 80 ? lastAgent.text.slice(0, 80) + '…' : lastAgent.text)
              : '작업 중…'
            return (
              <div key={item.key} className="rounded-lg border border-edge bg-surface">
                <div className="flex items-start">
                  <button type="button" onClick={() => toggle(item.key)} className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-xs text-ink-secondary hover:text-ink">
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
                        return <div key={child.key} className="whitespace-pre-wrap text-ink">{child.text}</div>
                      if (child.kind === 'thought')
                        return <div key={child.key} className="whitespace-pre-wrap text-xs text-ink-muted italic">{child.text}</div>
                      if (child.kind === 'tool_group') {
                        const tOpen = expanded.has(child.key)
                        const failed = child.tools.filter((t) => t.status === 'failed').length
                        const running = child.tools.some((t) => t.status === 'in_progress' || t.status === 'pending')
                        const tSummary = `${running ? '작업 중' : failed ? `${failed}개 실패` : '완료'} · ${child.tools.length}개 작업`
                        return (
                          <div key={child.key} className="rounded border border-edge bg-surface-deep px-2 py-1">
                            <button type="button" onClick={() => toggle(child.key)} className="flex w-full items-center gap-2 text-xs text-ink-secondary hover:text-ink">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${failed ? 'bg-danger' : running ? 'bg-ink-muted' : 'bg-accent-strong'}`} />
                              <CaretGlyph dir={tOpen ? 'down' : 'right'} />
                              <span>{tSummary}</span>
                            </button>
                            {tOpen && (
                              <div className="mt-1 space-y-0.5 border-t border-edge pt-1">
                                {child.tools.map((t) => (
                                  <div key={t.id} className="flex items-center gap-2 text-xs text-ink-secondary">
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.status === 'failed' ? 'bg-danger' : t.status === 'completed' ? 'bg-accent-strong' : 'bg-ink-muted'}`} />
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

      <div className="flex items-end gap-2 border-t border-edge p-2">
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

/** 이전 세션 불러오기 — 시계를 되감는 히스토리 아이콘 */
function HistoryGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
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
