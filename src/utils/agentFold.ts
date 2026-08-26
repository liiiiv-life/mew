// 에이전트 창이 받은 이벤트 흐름을 화면 항목으로 접는다. 그리는 쪽은 components/AgentPanel.tsx.
// 서버는 상태를 보내지 않고 이벤트만 보낸다 — 재접속하면 지나간 이벤트를 그대로 되받으므로
// 이 함수 하나가 대화 복원 로직 전부다.

export type PermissionOption = { optionId: string; name: string; kind: string }

export type ModelInfo = { modelId: string; name: string }
export type ModelState = { currentModelId: string; availableModels: ModelInfo[] }

/** 권한 모드 — 기본은 bypassPermissions다(ADR 0037). 서버가 세션을 잡을 때마다 걸어 준다 */
export type ModeInfo = { id: string; name: string; description?: string | null }
export type ModeState = { currentModeId: string; availableModes: ModeInfo[] }

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
}

export type AgentAuthState = {
  methods: AgentAuthMethod[]
  authenticating: boolean
  error: string | null
}

export type AgentAuthUrl = { id: string; url: string; message: string }

export type SessionUpdate =
  | { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk'; content: { type: string; text?: string } }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title: string; status?: string; kind?: string }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; title?: string | null; status?: string | null }
  // 그리지 않는 나머지(plan·available_commands_update·current_mode_update 등)는 아래 분기에서 그냥 흘려보낸다
  | { sessionUpdate: 'plan' | 'available_commands_update' | 'current_mode_update' }

export type AgentEvent =
  | { type: 'update'; update: SessionUpdate }
  | { type: 'permission'; id: string; toolCall: { title?: string | null }; options: PermissionOption[] }
  | { type: 'permission_done'; id: string }
  // startedAt·durationMs — 서버(agentAcp.ts)가 턴 시작·끝에 새겨 보낸다. 옛 서버 이벤트에는 없을 수 있다
  | { type: 'turn_start'; startedAt?: number }
  | { type: 'turn_end'; stopReason: string; durationMs?: number }
  | { type: 'error'; message: string }
  | { type: 'ready'; cwd: string }
  | { type: 'fatal'; message?: string }
  | { type: 'models'; models: ModelState }
  | { type: 'modes'; modes: ModeState }
  | { type: 'meta'; meta: SessionMeta }
  | ({ type: 'auth' } & AgentAuthState)
  | ({ type: 'auth_url' } & AgentAuthUrl)
  | { type: 'auth_url_done'; id: string }
  | { type: 'auth_complete' }
  | { type: 'reset' }
  | { type: 'sessions'; sessions: SessionInfo[] }
  // 재접속했을 때 지나간 대화를 한 덩어리로 받는다 — 창은 그린 대화를 이걸로 통째로 갈아끼운다
  | { type: 'replay'; events: AgentEvent[]; restored?: boolean }

export type ToolEntry = { id: string; title: string; status: string }

export type InnerItem =
  | { key: string; kind: 'agent' | 'thought'; text: string }
  | { key: string; kind: 'tool_group'; tools: ToolEntry[] }
  | { key: string; kind: 'permission'; id: string; title: string; options: PermissionOption[]; answered: boolean }
  | { key: string; kind: 'error'; text: string }

export type Item =
  | { key: string; kind: 'user'; text: string }
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
  if (hours) parts.push(`${hours}시간`)
  if (minutes) parts.push(`${minutes}분`)
  if (seconds || parts.length === 0) parts.push(`${seconds}초`)
  return parts.join(' ')
}

/** 이벤트 목록을 화면에 그릴 항목으로 접는다 — 질문·턴(답변+작업 묶음)·에러의 세 종류로 나뉜다 */
export function foldEvents(events: AgentEvent[]): Item[] {
  const items: Item[] = []
  // toolCallId -> 위치 — turn 안의 children 배열 기준
  const toolIndex = new Map<string, { turn: number; child: number; entry: number }>()

  type TurnItem = {
    key: string
    kind: 'turn'
    children: InnerItem[]
    done: boolean
    stopReason: string | null
    startedAt: number | null
    durationMs: number | null
  }
  let turnIdx = -1

  const currentTurn = (): TurnItem | null => {
    if (turnIdx < 0) return null
    const t = items[turnIdx]
    return t && t.kind === 'turn' ? t : null
  }

  const ensureTurn = (eventIdx: number): TurnItem => {
    const t = currentTurn()
    if (t) return t
    const turn: TurnItem = { key: `turn${eventIdx}`, kind: 'turn', children: [], done: false, stopReason: null, startedAt: null, durationMs: null }
    turnIdx = items.length
    items.push(turn)
    return turn
  }

  const pushTool = (id: string, title: string, status: string, eventIdx: number) => {
    const turn = ensureTurn(eventIdx)
    const kids = turn.children
    const last = kids.at(-1)
    if (last && last.kind === 'tool_group') {
      toolIndex.set(id, { turn: turnIdx, child: kids.length - 1, entry: last.tools.length })
      last.tools.push({ id, title, status })
    } else {
      toolIndex.set(id, { turn: turnIdx, child: kids.length, entry: 0 })
      kids.push({ key: `tg${eventIdx}`, kind: 'tool_group', tools: [{ id, title, status }] })
    }
  }

  for (const [i, event] of events.entries()) {
    if (event.type === 'turn_start') {
      const turn = ensureTurn(i)
      if (event.startedAt != null) turn.startedAt = event.startedAt
      continue
    }
    if (event.type === 'turn_end') {
      const t = currentTurn()
      if (t) {
        t.done = true
        t.stopReason = event.stopReason
        // 일부 ACP 어댑터는 마지막 tool_call_update를 흘리지 않는다. 턴이 끝난 뒤에도
        // pending/in_progress를 그대로 두면 끝난 버블이 영구히 "작업 중"으로 보인다.
        for (const child of t.children) {
          if (child.kind !== 'tool_group') continue
          for (const tool of child.tools) {
            if (tool.status === 'pending' || tool.status === 'in_progress') tool.status = 'completed'
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
      const text = ('message' in event && event.message) || '알 수 없는 오류'
      const t = currentTurn()
      if (t) t.children.push({ key: `e${i}`, kind: 'error', text })
      else items.push({ key: `e${i}`, kind: 'error', text })
      continue
    }
    if (event.type === 'permission') {
      const turn = ensureTurn(i)
      turn.children.push({
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
      // 모든 턴의 children에서 찾는다
      for (const item of items) {
        if (item.kind !== 'turn') continue
        const target = item.children.find((c) => c.kind === 'permission' && c.id === event.id)
        if (target && target.kind === 'permission') { target.answered = true; break }
      }
      continue
    }
    if (event.type !== 'update') continue
    const update = event.update
    if (update.sessionUpdate === 'user_message_chunk') {
      const text = update.content?.type === 'text' ? (update.content.text ?? '') : `[${update.content?.type}]`
      const last = items.at(-1)
      // 청크 스트림에는 메시지 경계가 없어 연속 사용자 발화는 한 말풍선이 된다 — 줄바꿈으로만 가른다
      if (last && last.kind === 'user') last.text += (last.text ? '\n' : '') + text
      else items.push({ key: `m${i}`, kind: 'user', text })
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
      if (last && last.kind === kind) last.text += text
      else turn.children.push({ key: `m${i}`, kind, text })
      continue
    }
    if (update.sessionUpdate === 'tool_call') {
      pushTool(update.toolCallId, update.title, update.status ?? 'pending', i)
      continue
    }
    if (update.sessionUpdate === 'tool_call_update') {
      const loc = toolIndex.get(update.toolCallId)
      if (loc) {
        const turnItem = items[loc.turn]
        if (turnItem && turnItem.kind === 'turn') {
          const group = turnItem.children[loc.child]
          if (group && group.kind === 'tool_group') {
            const entry = group.tools[loc.entry]
            if (update.title) entry.title = update.title
            if (update.status) entry.status = update.status
          }
        }
      }
    }
  }
  return items
}
