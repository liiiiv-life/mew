import type { HistoryPage, HistoryPosition, HistoryPreview } from '../../shared/agent-history.ts'
import type { AgentAttachmentRef } from '../../shared/agent-attachment.ts'
import { uiText, getUiLocale } from '@mew/ui/i18n-core'
// 에이전트 창이 받은 이벤트 흐름을 화면 항목으로 접는다. 그리는 쪽은 components/AgentPanel.tsx.
// 서버는 상태를 보내지 않고 이벤트만 보낸다 — 재접속하면 지나간 이벤트를 그대로 되받으므로
// 이 함수 하나가 대화 복원 로직 전부다.

import type { AccessIssue } from '../../shared/agent-access'

export type PermissionOption = { optionId: string; name: string; kind: string }

export type ModelInfo = { modelId: string; name: string }
export type ModelState = { currentModelId: string; availableModels: ModelInfo[] }

/** 권한 모드 — 기본은 bypassPermissions다(ADR 0037). 서버가 세션을 잡을 때마다 걸어 준다 */
export type ModeInfo = { id: string; name: string; description?: string | null }
export type ModeState = { currentModeId: string; availableModes: ModeInfo[] }
export type ThinkingState = { configId: string; currentValue: string; options: ModeInfo[] }
export type AgentMessageSettings = { model: string; thinking: string; permission: string; modelId?: string; thinkingId?: string; thinkingConfigId?: string; modeId?: string }

export type Usage = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  context: number
  turns: number
  startedAt: string | null
  /** 같은 토큰을 API로 샀다면 얼마인가(USD) — 구독제면 실제 청구액이 아니라 환산값이다(server/agentUsage.ts) */
  cost: number | null
}

export type SessionMeta = {
  sessionId: string
  startedAt: string
  turns: number
  busy: boolean
  queued: string[]
  queuedKinds?: ('prompt' | 'clear' | 'cli')[]
  queuedAttachments?: AgentAttachmentRef[][]
  queuedSettings?: (AgentMessageSettings | null)[]
  activeTask?: 'cli' | null
  accessIssue?: AccessIssue | null
  memoryPaused?: boolean
  usage: Usage | null
  canLoad: boolean
  canList: boolean
}

export type SessionInfo = { sessionId: string; title?: string | null; updatedAt?: string | null }

export type AgentAuthMethod = {
  id: string
  name: string
  description?: string | null
  kind: 'agent' | 'api-key' | 'terminal'
  surface?: 'browser' | 'terminal'
  browserInput?: 'authorization-code'
  serverBrowser?: boolean
}

export type AgentAuthState = {
  methods: AgentAuthMethod[]
  authenticating: boolean
  error: string | null
}

export type AgentAuthUrl = { id: string; url: string; message: string }

export type SessionUpdate =
  | {
    sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk'
    /** 저장 전사를 다시 흘리는 ACP 런타임이 주는 원래 메시지 경계. */
    messageId?: string
    content: { type: string; text?: string }
  }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title: string; status?: string; kind?: string }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; title?: string | null; status?: string | null }
  // 그리지 않는 나머지(plan·available_commands_update·current_mode_update 등)는 아래 분기에서 그냥 흘려보낸다
  | { sessionUpdate: 'plan' | 'available_commands_update' | 'current_mode_update' }

export type AgentEvent =
  | { type: 'history'; page: HistoryPage<AgentEvent>; restoreFailure?: { sessionId: string; message: string } }
  | { type: 'history_preview'; preview: HistoryPreview<AgentEvent> }
  | { type: 'history_event'; event: AgentEvent; position: HistoryPosition }
  | { type: 'update'; update: SessionUpdate; settings?: AgentMessageSettings }
  | { type: 'user_images'; images: { path: string; mimeType: string }[] }
  | { type: 'permission'; id: string; toolCall: { title?: string | null }; options: PermissionOption[] }
  | { type: 'permission_done'; id: string }
  // startedAt·durationMs — 서버(agentAcp.ts)가 턴 시작·끝에 새겨 보낸다. 옛 서버 이벤트에는 없을 수 있다
  | { type: 'turn_start'; startedAt?: number }
  | { type: 'turn_end'; stopReason: string; durationMs?: number }
  | { type: 'error'; message: string; accessIssue?: AccessIssue }
  | { type: 'ready'; cwd: string }
  | { type: 'fatal'; message?: string }
  | { type: 'models'; models: ModelState }
  | { type: 'modes'; modes: ModeState }
  | { type: 'thinking'; thinking: ThinkingState | null }
  | { type: 'meta'; meta: SessionMeta }
  | ({ type: 'auth' } & AgentAuthState)
  | ({ type: 'auth_url' } & AgentAuthUrl)
  | { type: 'auth_url_done'; id: string }
  | { type: 'auth_complete' }
  | { type: 'reset' }
  | { type: 'sessions'; sessions: SessionInfo[] }
  // 재접속했을 때 지나간 대화를 한 덩어리로 받는다 — 창은 그린 대화를 이걸로 통째로 갈아끼운다
  | { type: 'replay'; events: AgentEvent[]; restored?: boolean; restoreFailure?: { sessionId: string; message: string } }

export type ToolEntry = { id: string; title: string; status: string }

export type InnerItem =
  | { key: string; kind: 'agent' | 'thought'; text: string; messageId?: string }
  | { key: string; kind: 'tool_group'; tools: ToolEntry[] }
  | { key: string; kind: 'permission'; id: string; title: string; options: PermissionOption[]; answered: boolean }
  | { key: string; kind: 'error'; text: string }

export type Item =
  | { key: string; kind: 'user'; text: string; images: { path: string; mimeType: string }[]; settings?: AgentMessageSettings; messageId?: string }
  // stopReason — 턴이 어떻게 끝났나('end_turn'·'cancelled'·'error' 등, ACP 값 그대로).
  // 되받은 히스토리에는 turn_end가 없어 null로 남는다
  // startedAt(에포크 ms)·durationMs — 작업 버블의 걸린 시간 표시용. 옛 히스토리는 null이다
  | { key: string; kind: 'turn'; children: InnerItem[]; done: boolean; stopReason: string | null; startedAt: number | null; durationMs: number | null }
  | { key: string; kind: 'error'; text: string }

/** 밀리초를 "15초"·"36분 32초"·"2시간 3분 4초" 꼴로 — 0인 윗 단위는 떼고, 초는 반올림한다 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours) parts.push(uiText("{p0}시간", { p0: hours }))
  if (minutes) parts.push(uiText("{p0}분", { p0: minutes }))
  if (seconds || parts.length === 0) parts.push(uiText("{p0}초", { p0: seconds }))
  return parts.join(' ')
}

/**
 * ACP의 session/load 전사는 과거의 turn_end를 다시 보내지 않는다. 마지막 응답은 열린 turn처럼
 * 접히지만, 현재 세션 meta가 유휴면 이미 끝난 작업이다. meta가 아직 없을 때는 파란 진행 상태를 유지한다.
 */
export function isTurnComplete(item: Pick<Extract<Item, { kind: 'turn' }>, 'done'>, busy: boolean | null): boolean {
  return item.done || busy === false
}

type TurnItem = Extract<Item, { kind: 'turn' }>
type ChildLocation = { turn: number; child: number }

export type EventFold = {
  items: Item[]
  toolIndex: Map<string, ChildLocation & { entry: number }>
  permissionIndex: Map<string, ChildLocation>
  turnIdx: number
  length: number
  locale: ReturnType<typeof getUiLocale>
  baseIndex: number
  hasError: boolean
  lastAccessError: Extract<AgentEvent, { type: 'error' }> | null
}

export function createEventFold(locale = getUiLocale(), baseIndex = 0): EventFold {
  return { items: [], toolIndex: new Map(), permissionIndex: new Map(), turnIdx: -1,
    length: 0, locale, baseIndex, hasError: false, lastAccessError: null }
}

/** Append a frame without replaying old events or mutating an earlier render's items. */
export function appendEventFold(previous: EventFold, events: AgentEvent[]): EventFold {
  let items = previous.items
  let toolIndex = previous.toolIndex
  let permissionIndex = previous.permissionIndex
  let turnIdx = previous.turnIdx
  let hasError = previous.hasError
  let lastAccessError = previous.lastAccessError
  const { locale, baseIndex } = previous
  const editedItems = new Set<number>()
  const editedChildren = new Set<string>()
  const writableItems = () => {
    if (items === previous.items) items = items.slice()
    return items
  }
  const pushItem = (item: Item) => {
    editedItems.add(items.length)
    writableItems().push(item)
  }
  const editItem = (index: number): Item => {
    if (!editedItems.has(index)) {
      const item = items[index]
      writableItems()[index] = item.kind === 'turn' ? { ...item, children: item.children.slice() }
        : item.kind === 'user' ? { ...item, images: item.images.slice() } : { ...item }
      editedItems.add(index)
    }
    return items[index]
  }
  const editChild = (turn: number, child: number): InnerItem => {
    const item = editItem(turn) as TurnItem
    const key = `${turn}:${child}`
    if (!editedChildren.has(key)) {
      const old = item.children[child]
      item.children[child] = old.kind === 'tool_group' ? { ...old, tools: old.tools.slice() } : { ...old }
      editedChildren.add(key)
    }
    return item.children[child]
  }

  const currentTurn = (): TurnItem | null => {
    if (turnIdx < 0) return null
    const t = items[turnIdx]
    return t && t.kind === 'turn' ? editItem(turnIdx) as TurnItem : null
  }

  const ensureTurn = (eventIdx: number): TurnItem => {
    const t = currentTurn()
    if (t) return t
    const turn: TurnItem = { key: `turn${eventIdx}`, kind: 'turn', children: [], done: false, stopReason: null, startedAt: null, durationMs: null }
    turnIdx = items.length
    pushItem(turn)
    return turn
  }

  const pushTool = (id: string, title: string, status: string, eventIdx: number) => {
    const turn = ensureTurn(eventIdx)
    const kids = turn.children
    const last = kids.at(-1)
    if (toolIndex === previous.toolIndex) toolIndex = new Map(toolIndex)
    if (last && last.kind === 'tool_group') {
      toolIndex.set(id, { turn: turnIdx, child: kids.length - 1, entry: last.tools.length })
      const group = editChild(turnIdx, kids.length - 1)
      if (group.kind === 'tool_group') group.tools.push({ id, title, status })
    } else {
      toolIndex.set(id, { turn: turnIdx, child: kids.length, entry: 0 })
      kids.push({ key: `tg${eventIdx}`, kind: 'tool_group', tools: [{ id, title, status }] })
    }
  }

  for (const [offset, event] of events.entries()) {
    const i = baseIndex + previous.length + offset
    if (event.type === 'turn_start') {
      const turn = ensureTurn(i)
      if (event.startedAt != null) turn.startedAt = event.startedAt
      continue
    }
    if (event.type === 'user_images') {
      const last = items.at(-1)
      if (last?.kind === 'user') (editItem(items.length - 1) as typeof last).images.push(...event.images)
      continue
    }
    if (event.type === 'turn_end') {
      const t = currentTurn()
      if (t) {
        t.done = true
        t.stopReason = event.stopReason
        // 일부 ACP 어댑터는 마지막 tool_call_update를 흘리지 않는다. 턴이 끝난 뒤에도
        // pending/in_progress를 그대로 두면 끝난 버블이 영구히 "작업 중"으로 보인다.
        for (const [childIndex, child] of t.children.entries()) {
          if (child.kind !== 'tool_group') continue
          for (const [entry, tool] of child.tools.entries()) {
            if (tool.status === 'pending' || tool.status === 'in_progress') {
              const group = editChild(turnIdx, childIndex)
              if (group.kind === 'tool_group') group.tools[entry] = { ...tool, status: 'completed' }
            }
          }
        }
        // 서버가 새긴 걸린 시간. 옛 이벤트(필드 없음)면 startedAt으로 계산하고, 그것도 없으면 null
        if (event.durationMs != null) t.durationMs = event.durationMs
        else if (t.startedAt != null) t.durationMs = Date.now() - t.startedAt
      }
      turnIdx = -1
      continue
    }
    if (event.type === 'error' || event.type === 'fatal') {
      if (event.type === 'error') {
        hasError = true
        if (event.accessIssue) lastAccessError = event
      }
      const text = ('message' in event && event.message) || uiText("알 수 없는 오류", undefined, locale)
      const t = currentTurn()
      if (t) t.children.push({ key: `e${i}`, kind: 'error', text })
      else pushItem({ key: `e${i}`, kind: 'error', text })
      continue
    }
    if (event.type === 'permission') {
      const turn = ensureTurn(i)
      if (!permissionIndex.has(event.id)) {
        if (permissionIndex === previous.permissionIndex) permissionIndex = new Map(permissionIndex)
        permissionIndex.set(event.id, { turn: turnIdx, child: turn.children.length })
      }
      turn.children.push({
        key: `p${event.id}`,
        kind: 'permission',
        id: event.id,
        title: event.toolCall.title || uiText("도구 실행", undefined, locale),
        options: event.options,
        answered: false,
      })
      continue
    }
    if (event.type === 'permission_done') {
      const loc = permissionIndex.get(event.id)
      if (loc) {
        const target = editChild(loc.turn, loc.child)
        if (target.kind === 'permission') target.answered = true
      }
      continue
    }
    if (event.type !== 'update') continue
    const update = event.update
    if (update.sessionUpdate === 'user_message_chunk') {
      const text = update.content?.type === 'text' ? (update.content.text ?? '') : `[${update.content?.type}]`
      const last = items.at(-1)
      // 실시간 스트림에는 메시지 경계가 없다. 반면 저장 전사를 복원하는 런타임은 messageId를 준다.
      // ID가 바뀌면 연속 프레임이어도 반드시 새 질문 버블로 나눈다.
      const sameMessage = last?.kind === 'user'
        && (!update.messageId || update.messageId === last.messageId)
      if (last && last.kind === 'user' && sameMessage) {
        const user = editItem(items.length - 1) as typeof last
        user.text += (user.text ? '\n' : '') + text
      } else pushItem({ key: `m${i}`, kind: 'user', text, images: [], ...(event.settings ? { settings: event.settings } : {}), ...(update.messageId ? { messageId: update.messageId } : {}) })
      // 새 질문은 앞 턴을 닫는다 — 불러온 히스토리에는 turn_end가 없어서 여기서 끊지 않으면
      // 지난 대화 전체가 턴 하나로 뭉친다
      const open = currentTurn()
      if (open) open.done = true
      turnIdx = -1
      continue
    }
    if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') {
      const kind = update.sessionUpdate === 'agent_message_chunk' ? 'agent' as const : 'thought' as const
      const text = update.content?.type === 'text' ? (update.content.text ?? '') : `[${update.content?.type}]`
      const turn = ensureTurn(i)
      const last = turn.children.at(-1)
      // 같은 답변의 청크만 합친다. 히스토리 속 별도 답변을 마지막 답변 버블에 합치지 않는다.
      const sameMessage = last?.kind === kind
        && (!update.messageId || update.messageId === last.messageId)
      if (last && last.kind === kind && sameMessage) {
        const child = editChild(turnIdx, turn.children.length - 1)
        if (child.kind === kind) child.text += text
      }
      else turn.children.push({ key: `m${i}`, kind, text, ...(update.messageId ? { messageId: update.messageId } : {}) })
      continue
    }
    if (update.sessionUpdate === 'tool_call') {
      pushTool(update.toolCallId, update.title, update.status ?? 'pending', i)
      continue
    }
    if (update.sessionUpdate === 'tool_call_update') {
      const loc = toolIndex.get(update.toolCallId)
      if (loc) {
        const group = editChild(loc.turn, loc.child)
        if (group.kind === 'tool_group') {
          const entry = group.tools[loc.entry]
          group.tools[loc.entry] = { ...entry, ...(update.title ? { title: update.title } : {}), ...(update.status ? { status: update.status } : {}) }
        }
      }
    }
  }
  return { ...previous, items, toolIndex, permissionIndex, turnIdx, hasError, lastAccessError,
    length: previous.length + events.length }
}

/** Full reconstruction for a replaced transcript, locale change or earlier history page. */
export function foldEvents(events: AgentEvent[], locale = getUiLocale(), baseIndex = 0): Item[] {
  return appendEventFold(createEventFold(locale, baseIndex), events).items
}
