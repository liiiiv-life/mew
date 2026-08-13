// 에이전트셋 창 — 에이전트 창(AgentPanel)과 **별개**다.
//
// 에이전트 창이 "내가 한 에이전트와 대화하는" 자리라면, 여기는 "여러 셋에게 일을 시켜 두고 구경하는"
// 자리다. 입력줄은 하나뿐이고, 어디로 갈지는 라우터 셋이 정한다(@로 직접 지목하면 라우터를 건너뛴다).
//
// 창은 상태를 소유하지 않는다 — 큐를 밀고 작업을 닫는 주체는 서버(agentSetRunner.ts)다.
// 창을 닫아도 일은 계속 돌고, 다시 열면 그때의 상태를 통째로 받아 그린다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { MentionTextarea, type MentionOption } from './MentionTextarea'
import { RUNTIMES, runtimeOf } from './agentRuntimes'
import { renderMarkdown } from '../utils/agentMarkdown'
import { foldEvents, type AgentEvent } from '../utils/agentFold'
import { parseAssignment } from '../utils/agentSetMention'
import { useGridDrag } from '../hooks/useGridDrag'

export interface AgentSetDef {
  id: string
  name: string
  role: string
  runtime: string
  modelId: string
}

type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

interface TaskSummary {
  id: string
  setId: string
  prompt: string
  status: TaskStatus
  createdAt: string
  endedAt: string | null
  routedTo: string | null
  error: string | null
}

interface SetView extends AgentSetDef {
  on: boolean
  busy: boolean
  queued: string[]
  tasks: TaskSummary[]
}

const ROUTER_ID = 'router'

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: '대기',
  running: '진행 중',
  done: '완료',
  error: '실패',
  cancelled: '중단됨',
}

const STATUS_DOT: Record<TaskStatus, string> = {
  queued: 'bg-ink-muted',
  running: 'bg-accent',
  done: 'bg-success',
  error: 'bg-danger',
  cancelled: 'bg-ink-muted',
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface ModelInfo {
  modelId: string
  name: string
}

export function AgentSetPanel({ onClose }: { onClose: () => void }) {
  const [sets, setSets] = useState<SetView[]>([])
  /** 런타임별로 서버가 본 적 있는 모델 — 편집 창의 모델 검색 후보다(비어 있으면 자유 입력) */
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({})
  const [connected, setConnected] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [openSetId, setOpenSetId] = useState<string | null>(null)
  const [editing, setEditing] = useState<AgentSetDef | null>(null)
  /** 상세를 펼친 작업 — 이벤트는 이 하나만 서버에서 흘러온다 */
  const [openTask, setOpenTask] = useState<{ task: TaskSummary; events: AgentEvent[] } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    let ws: WebSocket
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${proto}//${location.host}/api/agentset/ws`)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (raw) => {
        const msg = JSON.parse(String(raw.data)) as
          | { type: 'state'; sets: SetView[]; models: Record<string, ModelInfo[]> }
          | { type: 'task'; task: TaskSummary; events: AgentEvent[] }
          | { type: 'task_events'; taskId: string; events: AgentEvent[] }
          | { type: 'error'; message: string }
        if (msg.type === 'state') {
          setModels(msg.models ?? {})
          return setSets(msg.sets)
        }
        if (msg.type === 'task') return setOpenTask({ task: msg.task, events: msg.events })
        if (msg.type === 'task_events')
          return setOpenTask((prev) =>
            prev && prev.task.id === msg.taskId ? { ...prev, events: [...prev.events, ...msg.events] } : prev,
          )
        if (msg.type === 'error') setNotice(msg.message)
      }
      ws.onclose = () => {
        if (closed) return
        setConnected(false)
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
  }, [])

  const send = useCallback((payload: Record<string, unknown>) => wsRef.current?.send(JSON.stringify(payload)), [])

  // 알림은 잠깐만 — 다음 입력을 가리지 않게
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const openSet = sets.find((s) => s.id === openSetId) ?? null

  // 열어 둔 작업이 있으면 서버에 알린다 — 그 작업의 이벤트만 흘러온다
  const openTaskId = openTask?.task.id ?? null
  useEffect(() => {
    if (connected) send({ type: 'open_task', taskId: openTaskId })
  }, [connected, openTaskId, send])

  // 열어 둔 작업의 상태(진행 중 → 완료)는 상태 스냅샷이 밀어 준다
  useEffect(() => {
    if (!openTask) return
    const fresh = sets.flatMap((s) => s.tasks).find((t) => t.id === openTask.task.id)
    if (fresh && fresh.status !== openTask.task.status) setOpenTask((prev) => (prev ? { ...prev, task: fresh } : prev))
  }, [sets, openTask])

  const mentionOptions: MentionOption[] = useMemo(
    () =>
      sets
        .filter((s) => s.id !== ROUTER_ID)
        .map((s) => ({ id: s.id, label: s.name, hint: runtimeOf(s.runtime).label, insert: `@${s.name}` })),
    [sets],
  )

  const submit = (targetSetId?: string) => {
    const parsed = parseAssignment(draft, sets)
    const setId = targetSetId ?? parsed.setId
    const text = targetSetId ? draft.trim() : parsed.text
    if (!text) return
    send({ type: 'submit', text, setId })
    setDraft('')
  }

  const saveSets = async (next: AgentSetDef[]) => {
    const res = await fetch('/api/agent-sets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sets: next }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setNotice(body.error ?? '저장하지 못했습니다')
      return false
    }
    return true
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-deep">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm text-ink">에이전트셋</span>
          <span className="text-xs text-ink-muted">{connected ? `${sets.length}개` : '연결 중'}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing({ id: '', name: '', role: '', runtime: RUNTIMES[0].id, modelId: '' })}
            className="rounded px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink"
          >
            + 새 셋
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 그리드 — 라우터까지 포함해 모든 셋이 한눈에 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
          {sets.map((set) => (
            <SetCard key={set.id} set={set} onOpen={() => setOpenSetId(set.id)} onEdit={() => setEditing(set)} />
          ))}
        </div>
        {sets.length <= 1 && (
          <p className="mt-3 text-xs text-ink-muted">
            아직 라우터뿐입니다. [+ 새 셋]으로 역할을 가진 셋을 만들면, 아래에 프롬프트를 넣었을 때 라우터가 그중 하나를 골라 맡깁니다.
          </p>
        )}
      </div>

      {notice && <div className="border-t border-edge bg-surface px-3 py-1.5 text-xs text-danger">{notice}</div>}

      {/* 창을 통틀어 입력줄은 이것 하나다 — @로 지목하지 않으면 라우터가 정한다 */}
      <div className="flex items-end gap-2 border-t border-edge p-2" data-keep-keyboard>
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          options={mentionOptions}
          onSubmit={() => submit()}
          rows={2}
          placeholder="할 일을 적으세요 — @로 특정 셋을 지목할 수 있습니다"
          className="w-full resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        <button
          type="button"
          onClick={() => submit()}
          disabled={!connected || !draft.trim()}
          className="flex h-8 shrink-0 items-center justify-center rounded bg-accent px-3 text-xs text-ink disabled:opacity-40"
        >
          맡기기
        </button>
      </div>

      {openSet && (
        <SetTasksPopup
          set={openSet}
          openTask={openTask}
          onOpenTask={(task) => (task ? setOpenTask({ task, events: [] }) : setOpenTask(null))}
          onClose={() => {
            setOpenSetId(null)
            setOpenTask(null)
          }}
          send={send}
        />
      )}

      {editing && (
        <SetEditModal
          draft={editing}
          isNew={!editing.id}
          models={models}
          onProbe={(runtime) => send({ type: 'probe_models', runtime })}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            const others = sets.filter((s) => s.id !== next.id).map(({ id, name, role, runtime, modelId }) => ({ id, name, role, runtime, modelId }))
            const ok = await saveSets([...others, next])
            if (ok) setEditing(null)
          }}
          onDelete={
            editing.id && editing.id !== ROUTER_ID
              ? async () => {
                  const others = sets
                    .filter((s) => s.id !== editing.id)
                    .map(({ id, name, role, runtime, modelId }) => ({ id, name, role, runtime, modelId }))
                  const ok = await saveSets(others)
                  if (ok) setEditing(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

/** 그리드 한 칸 — 켜짐·진행 상황이 한눈에 보여야 한다 */
function SetCard({ set, onOpen, onEdit }: { set: SetView; onOpen: () => void; onEdit: () => void }) {
  const Glyph = runtimeOf(set.runtime).Glyph
  const running = set.tasks.find((t) => t.status === 'running')
  const state = running ? '진행 중' : set.on ? '켜짐 · 대기' : '꺼짐'
  return (
    <div className={`flex flex-col gap-1 rounded-lg bg-surface p-2 ${set.busy ? 'ring-1 ring-accent' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${set.busy ? 'bg-accent' : set.on ? 'bg-success' : 'bg-ink-faint'}`} />
        <span className="text-ink-secondary"><Glyph /></span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline">
          {set.name}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded px-1 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink"
          aria-label={`${set.name} 설정`}
        >
          ⚙
        </button>
      </div>
      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <div className="truncate text-xs text-ink-muted">{state}</div>
        {running && <div className="line-clamp-2 text-xs text-ink-secondary">{running.prompt}</div>}
        {set.queued.length > 0 && <div className="text-xs text-ink-muted">대기 {set.queued.length}건</div>}
      </button>
    </div>
  )
}

/**
 * 셋 하나의 작업 리스트 → 아이템을 누르면 **같은 팝업 안에서** 상세로 바뀐다.
 * 어느 화면에서든 입력줄이 있어서 이 셋에게 바로 일을 더 시킬 수 있다.
 */
function SetTasksPopup({
  set,
  openTask,
  onOpenTask,
  onClose,
  send,
}: {
  set: SetView
  openTask: { task: TaskSummary; events: AgentEvent[] } | null
  onOpenTask: (task: TaskSummary | null) => void
  onClose: () => void
  send: (payload: Record<string, unknown>) => void
}) {
  const [draft, setDraft] = useState('')
  useOverlayDismiss(openTask ? () => onOpenTask(null) : onClose)

  const detail = openTask ? set.tasks.find((t) => t.id === openTask.task.id) ?? openTask.task : null
  const items = useMemo(() => (openTask ? foldEvents(openTask.events) : []), [openTask])

  // 대기 줄 재정렬 — 에이전트 창의 큐와 같은 손짓(꾹 눌러 집어 옮긴다)
  const queueDrag = useGridDrag({
    enabled: set.queued.length > 1,
    mouseHoldMs: 500,
    onMove: (from, to) => send({ type: 'queue', setId: set.id, op: { type: 'move', from, to } }),
  })
  const [editingQueued, setEditingQueued] = useState<{ index: number; text: string; original: string } | null>(null)

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    send({ type: 'submit', text, setId: set.id })
    setDraft('')
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-surface-deep shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          {openTask && (
            <button
              type="button"
              onClick={() => onOpenTask(null)}
              className="rounded px-1.5 py-0.5 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink"
            >
              ← 목록
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {set.name}
            {detail && <span className="text-ink-muted"> · {detail.prompt.split('\n')[0].slice(0, 40)}</span>}
          </span>
          {set.on && (
            <button
              type="button"
              onClick={() => send({ type: 'stop_set', setId: set.id })}
              className="shrink-0 rounded px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink"
              title="세션을 끕니다 — 다음 작업이 오면 다시 뜹니다"
            >
              끄기
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {!openTask ? (
            <div className="space-y-1">
              {set.tasks.length === 0 && <div className="py-6 text-center text-xs text-ink-muted">아직 맡긴 일이 없습니다</div>}
              {set.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task)}
                  className="flex w-full items-start gap-2 rounded-lg bg-surface px-3 py-2 text-left hover:bg-surface-raised"
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[task.status]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-sm text-ink">{task.prompt}</span>
                    <span className="text-xs text-ink-muted">
                      {STATUS_LABEL[task.status]}
                      {task.routedTo && ` → ${task.routedTo}`}
                      {task.endedAt && ` · ${formatTime(task.endedAt)}`}
                    </span>
                    {task.error && <span className="block truncate text-xs text-danger">{task.error}</span>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg bg-surface px-3 py-2">
                <div className="whitespace-pre-wrap text-sm text-ink">{detail?.prompt}</div>
                <div className="mt-1 text-xs text-ink-muted">
                  {detail && STATUS_LABEL[detail.status]}
                  {detail?.routedTo && ` → ${detail.routedTo}`}
                  {detail?.createdAt && ` · ${formatTime(detail.createdAt)}`}
                </div>
              </div>
              {detail?.status === 'running' && (
                <button
                  type="button"
                  onClick={() => send({ type: 'cancel_task', taskId: detail.id })}
                  className="rounded bg-surface px-2 py-1 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink"
                >
                  중단
                </button>
              )}
              {items.length === 0 && detail?.status === 'queued' && (
                <div className="text-xs text-ink-muted">앞 작업이 끝나면 시작합니다</div>
              )}
              <TaskEvents items={items} onPermission={(id, optionId) => send({ type: 'permission', setId: set.id, id, optionId })} />
            </div>
          )}
        </div>

        {/* 대기 줄 — 목록에서도 상세에서도 늘 보인다(지금 이 셋 뒤에 뭐가 밀려 있는지가 늘 궁금하다) */}
        {set.queued.length > 0 && (
          <div className="space-y-1 border-t border-edge bg-surface px-3 py-1.5 text-xs">
            <div className="text-ink-muted">대기 {set.queued.length}건 — 순서대로 보냅니다</div>
            {set.queued.map((text, index) => {
              const drag = queueDrag.drag
              const lifted = drag !== null && drag.slot === index
              const editing = editingQueued?.index === index ? editingQueued : null
              return (
                <div
                  key={`${index}-${text}`}
                  ref={queueDrag.registerCell(index)}
                  {...(editing ? {} : queueDrag.getTileProps(index))}
                  style={lifted ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
                  className={`flex items-center gap-2 ${editing ? '' : 'select-none'} ${
                    lifted ? 'relative z-10 rounded bg-surface-raised opacity-80' : drag !== null && drag.target === index ? 'rounded bg-surface-raised' : ''
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
                          e.currentTarget.blur()
                        }
                      }}
                      onBlur={() => {
                        const next = editing.text.trim()
                        if (next && next !== editing.original)
                          send({ type: 'queue', setId: set.id, op: { type: 'edit', index: editing.index, text: next, expect: editing.original } })
                        setEditingQueued(null)
                      }}
                      rows={3}
                      className="min-w-0 flex-1 resize-none rounded bg-surface-raised px-2 py-1 text-xs text-ink outline-none"
                    />
                  ) : (
                    <span
                      onDoubleClick={() => setEditingQueued({ index, text, original: text })}
                      title="두 번 눌러 고치기 · 꾹 눌러 순서 바꾸기"
                      className="min-w-0 flex-1 cursor-pointer truncate text-ink-secondary"
                    >
                      {text}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (queueDrag.consumeClick()) return
                      send({ type: 'queue', setId: set.id, op: { type: 'unqueue', index } })
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink"
                    aria-label="대기 작업 취소"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* 이 셋에게 직접 일을 넣는 자리 — 라우터를 거치지 않는다 */}
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
            placeholder={`${set.name}에게 직접 맡기기 (Ctrl+Enter)`}
            className="min-w-0 flex-1 resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            className="flex h-8 shrink-0 items-center justify-center rounded bg-accent px-3 text-xs text-ink disabled:opacity-40"
          >
            맡기기
          </button>
        </div>
      </div>
    </div>
  )
}

/** 작업 상세의 본문 — 에이전트 창과 같은 접기 규칙을 쓰되, 여기서는 펼쳐 놓고 읽는다 */
function TaskEvents({
  items,
  onPermission,
}: {
  items: ReturnType<typeof foldEvents>
  onPermission: (id: string, optionId: string | null) => void
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => {
        if (item.kind === 'user') return null // 프롬프트는 위에 이미 있다(역할 머리말까지 다시 보일 필요 없다)
        if (item.kind !== 'turn')
          return (
            <div key={item.key} className="rounded-lg bg-surface px-3 py-2 text-xs text-danger">
              {item.text}
            </div>
          )
        return (
          <div key={item.key} className="space-y-2">
            {item.children.map((child) => {
              if (child.kind === 'agent')
                return (
                  <div
                    key={child.key}
                    className="prose prose-sm max-w-none rounded-lg bg-surface px-3 py-2 text-ink dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-surface-deep"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(child.text) }}
                  />
                )
              if (child.kind === 'thought')
                return (
                  <div key={child.key} className="whitespace-pre-wrap px-3 text-xs italic text-ink-muted">
                    {child.text}
                  </div>
                )
              if (child.kind === 'tool_group')
                return (
                  <div key={child.key} className="space-y-0.5 rounded border border-edge bg-surface-deep px-2 py-1">
                    {child.tools.map((tool) => (
                      <div key={tool.id} className="flex items-center gap-2 text-xs text-ink-secondary">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            tool.status === 'failed' ? 'bg-danger' : tool.status === 'completed' ? 'bg-success' : 'bg-accent'
                          }`}
                        />
                        <span className="truncate">{tool.title}</span>
                      </div>
                    ))}
                  </div>
                )
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
                            onClick={() => onPermission(child.id, option.optionId)}
                            className={`rounded px-2 py-1 text-xs ${
                              option.kind.startsWith('allow') ? 'bg-accent text-ink' : 'bg-surface-raised text-ink-secondary'
                            } hover:bg-surface-hover`}
                          >
                            {option.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              return (
                <div key={child.key} className="px-3 text-xs text-danger">
                  {child.text}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** 셋 하나를 만들거나 고친다. 라우터는 역할·이름이 잠겨 있고 에이전트·모델만 고를 수 있다 */
function SetEditModal({
  draft,
  isNew,
  models,
  onProbe,
  onClose,
  onSave,
  onDelete,
}: {
  draft: AgentSetDef
  isNew: boolean
  models: Record<string, ModelInfo[]>
  /** 그 런타임의 모델 후보를 서버가 아직 모를 때 알아봐 달라고 한다 */
  onProbe: (runtime: string) => void
  onClose: () => void
  onSave: (set: AgentSetDef) => void
  onDelete?: () => void
}) {
  const [form, setForm] = useState(draft)
  const locked = form.id === ROUTER_ID
  useOverlayDismiss(onClose)

  const choices = models[form.runtime] ?? []
  // 후보를 모르는 런타임이면 서버가 세션을 잠깐 띄워 알아본다 — 런타임당 한 번만 조른다
  // (실패해도 다시 묻지 않는다. 자유 입력은 그대로 살아 있다)
  const [asked, setAsked] = useState<string[]>([])
  useEffect(() => {
    if (choices.length > 0 || asked.includes(form.runtime)) return
    setAsked((prev) => [...prev, form.runtime])
    onProbe(form.runtime)
  }, [form.runtime, choices.length, asked, onProbe])
  const loading = choices.length === 0 && asked.includes(form.runtime)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-surface-deep p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm text-ink">{isNew ? '새 에이전트셋' : locked ? '라우터' : '에이전트셋 수정'}</div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-ink-muted">이름</span>
            <input
              value={form.name}
              disabled={locked}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none disabled:text-ink-muted"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">에이전트</span>
            <select
              value={form.runtime}
              onChange={(e) => setForm({ ...form, runtime: e.target.value })}
              className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none"
            >
              {RUNTIMES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <div className="block">
            <span className="text-xs text-ink-muted">
              모델 — 비워 두면 그 에이전트의 기본 모델
              {/* 실패해도 이 문구가 남는다 — 사유는 창의 알림줄로 간다. 어느 쪽이든 그냥 쳐 넣으면 된다 */}
              {loading && ' (후보를 찾는 중 — 안 뜨면 직접 쳐 넣으세요)'}
            </span>
            <ModelCombo
              value={form.modelId}
              choices={choices}
              onChange={(modelId) => setForm({ ...form, modelId })}
            />
          </div>
          <label className="block">
            <span className="text-xs text-ink-muted">
              {locked ? '역할 — 라우터는 고칠 수 없습니다' : '역할 — 이 셋이 무엇을 하는지(시스템 프롬프트)'}
            </span>
            <textarea
              value={locked ? '사용자 프롬프트를 읽고 어느 셋에 맡길지 판단합니다.' : form.role}
              disabled={locked}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              rows={5}
              className="mt-1 w-full resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none disabled:text-ink-muted"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {onDelete ? (
            <button type="button" onClick={onDelete} className="rounded px-2 py-1 text-xs text-danger hover:bg-surface-raised">
              삭제
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-raised">
              취소
            </button>
            <button
              type="button"
              onClick={() => onSave(form)}
              className="rounded bg-accent px-3 py-1.5 text-xs text-ink disabled:opacity-40"
              disabled={!locked && (!form.name.trim() || !form.role.trim())}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 모델 고르기 — 친 글자로 후보를 걸러 아래에 펼치고, 고르면 그 modelId가 값이 된다.
 * <select>가 아니라 입력창인 이유: 후보를 모르는 런타임이거나 방금 나온 모델이어도 그냥 쳐서 넣을 수
 * 있어야 한다(서버는 여기 없는 id도 그대로 받는다). 목록은 그 위에 얹은 검색 결과일 뿐이다.
 */
function ModelCombo({
  value,
  choices,
  onChange,
}: {
  value: string
  choices: ModelInfo[]
  onChange: (modelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Esc·모바일 뒤로가기가 편집 창 대신 이 목록을 먼저 닫게 한다
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const q = value.trim().toLowerCase()
  // 이미 고른 값이 그대로 들어 있으면 그건 검색어가 아니다 — 그 한 줄만 남기지 말고 후보를 다 보여
  // 준다(고른 뒤 다시 열었을 때 다른 모델로 갈아탈 수 있어야 한다)
  const picked = choices.some((m) => m.modelId.toLowerCase() === q)
  const shown =
    q && !picked
      ? choices.filter((m) => m.modelId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : choices
  const pick = (modelId: string) => {
    onChange(modelId)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          // Enter는 첫 번째 결과 — 몇 글자 치고 바로 고르는 흐름(에이전트 창의 HeaderSelect와 같다)
          if (e.key === 'Enter' && open && shown.length > 0) {
            e.preventDefault()
            pick(shown[0].modelId)
          }
        }}
        placeholder={choices.length > 0 ? '쳐서 찾기 — 예: claude-opus-5' : '예: claude-opus-5'}
        className="mt-1 w-full rounded bg-surface py-1.5 pl-2 pr-8 text-sm text-ink outline-none placeholder:text-ink-muted"
      />
      {/* 그냥 입력칸으로 보이면 아무도 목록이 있는 줄 모른다 — 누르면 후보가 통째로 펼쳐진다 */}
      {choices.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="모델 후보"
          className="absolute right-1 top-1 flex h-8 w-7 items-center justify-center rounded text-ink-muted hover:text-ink"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 9 7 7 7-7" />
          </svg>
        </button>
      )}
      {open && shown.length > 0 && (
        <div
          role="listbox"
          aria-label="모델"
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
        >
          {shown.map((m) => (
            <button
              key={m.modelId}
              type="button"
              role="option"
              aria-selected={m.modelId === value}
              onClick={() => pick(m.modelId)}
              className={`block w-full px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover ${
                m.modelId === value ? 'text-ink' : 'text-ink-secondary'
              }`}
            >
              <span className="block truncate">{m.name}</span>
              {m.name !== m.modelId && <span className="block truncate text-ink-muted">{m.modelId}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
