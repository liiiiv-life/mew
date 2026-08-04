// 에이전트 창 — ACP 세션과 대화하는 채팅 패널(터미널이 아니다). 서버 쪽은 server/agentAcp.ts.
// 화면 상태는 전부 서버가 보내 준 이벤트에서 파생한다 — 재접속하면 지나간 이벤트를 그대로 되받으므로
// 클라이언트가 따로 대화를 저장하지 않아도 복원된다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { keepFocusOnPress, useOverlayDismiss } from '@mew/ui'

type PermissionOption = { optionId: string; name: string; kind: string }

type SessionUpdate =
  | { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk'; content: { type: string; text?: string } }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title: string; status?: string; kind?: string }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; title?: string | null; status?: string | null }
  // 그리지 않는 나머지(plan·available_commands_update·current_mode_update 등)는 아래 분기에서 그냥 흘려보낸다
  | { sessionUpdate: 'plan' | 'available_commands_update' | 'current_mode_update' }

type AgentEvent =
  | { type: 'update'; update: SessionUpdate }
  | { type: 'permission'; id: string; toolCall: { title?: string | null }; options: PermissionOption[] }
  | { type: 'permission_done'; id: string }
  | { type: 'turn_start' }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'error'; message: string }
  | { type: 'ready' }
  | { type: 'fatal'; message?: string }

type Item =
  | { key: string; kind: 'user' | 'agent' | 'thought'; text: string }
  | { key: string; kind: 'tool'; title: string; status: string }
  | { key: string; kind: 'permission'; id: string; title: string; options: PermissionOption[]; answered: boolean }
  | { key: string; kind: 'error'; text: string }

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  in_progress: '실행 중',
  completed: '완료',
  failed: '실패',
}

/** 이벤트 목록을 화면에 그릴 항목으로 접는다 — 같은 종류의 연속 청크는 한 덩어리로 합친다 */
function foldEvents(events: AgentEvent[]): Item[] {
  const items: Item[] = []
  const toolIndex = new Map<string, number>()
  for (const [i, event] of events.entries()) {
    if (event.type === 'error' || event.type === 'fatal') {
      items.push({ key: `e${i}`, kind: 'error', text: ('message' in event && event.message) || '알 수 없는 오류' })
      continue
    }
    if (event.type === 'permission') {
      items.push({
        key: `p${event.id}`,
        kind: 'permission',
        id: event.id,
        title: event.toolCall.title || '도구 실행',
        options: event.options,
        answered: false,
      })
      continue
    }
    if (event.type === 'permission_done') {
      const target = items.find((item) => item.kind === 'permission' && item.id === event.id)
      if (target && target.kind === 'permission') target.answered = true
      continue
    }
    if (event.type !== 'update') continue
    const update = event.update
    if (
      update.sessionUpdate === 'user_message_chunk' ||
      update.sessionUpdate === 'agent_message_chunk' ||
      update.sessionUpdate === 'agent_thought_chunk'
    ) {
      const kind = update.sessionUpdate === 'user_message_chunk' ? 'user' : update.sessionUpdate === 'agent_message_chunk' ? 'agent' : 'thought'
      const text = update.content?.type === 'text' ? (update.content.text ?? '') : `[${update.content?.type}]`
      const last = items.at(-1)
      if (last && last.kind === kind && kind !== 'user') last.text += text
      else items.push({ key: `m${i}`, kind, text })
      continue
    }
    if (update.sessionUpdate === 'tool_call') {
      toolIndex.set(update.toolCallId, items.length)
      items.push({ key: `t${update.toolCallId}`, kind: 'tool', title: update.title, status: update.status ?? 'pending' })
      continue
    }
    if (update.sessionUpdate === 'tool_call_update') {
      const at = toolIndex.get(update.toolCallId)
      const target = at == null ? undefined : items[at]
      if (target && target.kind === 'tool') {
        if (update.title) target.title = update.title
        if (update.status) target.status = update.status
      }
    }
  }
  return items
}

export function AgentPanel({ project, onClose }: { project: string; onClose: () => void }) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
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
        // 재접속하면 서버가 지나간 이벤트를 처음부터 다시 보낸다 — ready에서 화면을 비워 중복을 막는다
        if (event.type === 'ready') {
          setEvents([])
          return
        }
        if (event.type === 'turn_start') setBusy(true)
        if (event.type === 'turn_end') setBusy(false)
        setEvents((prev) => [...prev, event])
      }
      ws.onclose = () => {
        setConnected(false)
        setBusy(false)
        if (!closed) retry = window.setTimeout(connect, 1000)
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

  const items = useMemo(() => foldEvents(events), [events])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  const send = (payload: Record<string, unknown>) => wsRef.current?.send(JSON.stringify(payload))

  const submit = () => {
    const text = draft.trim()
    if (!text || busy || !connected) return
    send({ type: 'prompt', text })
    setDraft('')
  }

  const pending = items.find((item) => item.kind === 'permission' && !item.answered)

  return (
    <div className="flex h-full w-full flex-col bg-surface-deep" onMouseDown={keepFocusOnPress}>
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="text-sm font-semibold text-ink-soft">
          에이전트 <span className="text-xs font-normal text-ink-muted">{project}</span>
        </div>
        <div className="flex items-center gap-2">
          {!connected && <span className="text-xs text-ink-muted">연결 중…</span>}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="에이전트 창 닫기"
          >
            ×
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {items.length === 0 && <div className="py-8 text-center text-sm text-ink-muted">이 프로젝트 안에서만 작업합니다.</div>}
        {items.map((item) => {
          if (item.kind === 'user')
            return (
              <div key={item.key} className="ml-6 rounded-lg bg-surface-raised px-3 py-2 whitespace-pre-wrap text-ink">
                {item.text}
              </div>
            )
          if (item.kind === 'agent')
            return (
              <div key={item.key} className="whitespace-pre-wrap text-ink">
                {item.text}
              </div>
            )
          if (item.kind === 'thought')
            return (
              <div key={item.key} className="whitespace-pre-wrap text-xs text-ink-muted italic">
                {item.text}
              </div>
            )
          if (item.kind === 'tool')
            return (
              <div key={item.key} className="flex items-center gap-2 text-xs text-ink-secondary">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.status === 'failed' ? 'bg-danger' : item.status === 'completed' ? 'bg-accent-strong' : 'bg-ink-muted'}`} />
                <span className="truncate">{item.title}</span>
                <span className="shrink-0 text-ink-muted">{STATUS_LABEL[item.status] ?? item.status}</span>
              </div>
            )
          if (item.kind === 'permission')
            return (
              <div key={item.key} className="rounded-lg border border-edge-bright bg-surface px-3 py-2">
                <div className="mb-2 text-xs text-ink-secondary">{item.title}</div>
                {item.answered ? (
                  <div className="text-xs text-ink-muted">응답함</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {item.options.map((option) => (
                      <button
                        key={option.optionId}
                        type="button"
                        onClick={() => send({ type: 'permission', id: item.id, optionId: option.optionId })}
                        className={`rounded px-2 py-1 text-xs ${option.kind.startsWith('allow') ? 'bg-accent text-ink' : 'bg-surface-raised text-ink-secondary'} hover:bg-surface-hover`}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          return (
            <div key={item.key} className="rounded-lg bg-surface px-3 py-2 text-xs text-danger">
              {item.text}
            </div>
          )
        })}
      </div>

      <div className="border-t border-edge p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={pending ? '승인을 기다리는 중입니다' : '메시지 (Enter 전송, Shift+Enter 줄바꿈)'}
          className="w-full resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        <div className="mt-1 flex justify-end gap-1.5">
          {busy && (
            <button
              type="button"
              onClick={() => send({ type: 'cancel' })}
              className="rounded bg-surface-raised px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
            >
              중단
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy || !connected || !draft.trim()}
            className="rounded bg-accent px-2.5 py-1 text-xs text-ink disabled:opacity-40"
          >
            보내기
          </button>
        </div>
      </div>
    </div>
  )
}
