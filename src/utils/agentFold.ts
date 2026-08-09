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
  | { type: 'turn_start' }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'error'; message: string }
  | { type: 'ready' }
  | { type: 'fatal'; message?: string }
  | { type: 'models'; models: ModelState }
  | { type: 'modes'; modes: ModeState }
  | { type: 'meta'; meta: SessionMeta }
  | { type: 'reset' }
  | { type: 'sessions'; sessions: SessionInfo[] }

export type ToolEntry = { id: string; title: string; status: string }

export type InnerItem =
  | { key: string; kind: 'agent' | 'thought'; text: string }
  | { key: string; kind: 'tool_group'; tools: ToolEntry[] }
  | { key: string; kind: 'permission'; id: string; title: string; options: PermissionOption[]; answered: boolean }
  | { key: string; kind: 'error'; text: string }

export type Item =
  | { key: string; kind: 'user'; text: string }
  | { key: string; kind: 'turn'; children: InnerItem[]; done: boolean }
  | { key: string; kind: 'error'; text: string }

/** 이벤트 목록을 화면에 그릴 항목으로 접는다 — 질문·턴(답변+작업 묶음)·에러의 세 종류로 나뉜다 */
export function foldEvents(events: AgentEvent[]): Item[] {
  const items: Item[] = []
  // toolCallId -> 위치 — turn 안의 children 배열 기준
  const toolIndex = new Map<string, { turn: number; child: number; entry: number }>()

  type TurnItem = { key: string; kind: 'turn'; children: InnerItem[]; done: boolean }
  let turnIdx = -1

  const currentTurn = (): TurnItem | null => {
    if (turnIdx < 0) return null
    const t = items[turnIdx]
    return t && t.kind === 'turn' ? t : null
  }

  const ensureTurn = (eventIdx: number): TurnItem => {
    const t = currentTurn()
    if (t) return t
    const turn: TurnItem = { key: `turn${eventIdx}`, kind: 'turn', children: [], done: false }
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
      ensureTurn(i)
      continue
    }
    if (event.type === 'turn_end') {
      const t = currentTurn()
      if (t) t.done = true
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
      if (last && last.kind === 'user') last.text += text
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
