// ACP 히스토리는 메시지 본문만 다시 흘리고 Mew turn_end(소요 시간·종료 이유)는 보존하지 않는다.
// 완료 턴의 화면 전사를 DATA_DIR에 남겨 감독의 유휴 종료 뒤에도 같은 정보를 복원한다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import type { AgentEvent } from './agentAcp.ts'

const TRANSCRIPT_DIR = path.join(DATA_DIR, 'agent-transcripts')
// v1은 최근 500개만 저장해 긴 턴의 질문과 답변 앞부분을 잃었다. 그 파일을 기준본으로
// 쓰지 않고 ACP 원본 히스토리로 폴백하도록 완전 전사부터 새 버전으로 구분한다.
const VERSION = 2

type StoredTranscript = {
  version: typeof VERSION
  runtime: string
  cwd: string
  sessionId: string
  events: AgentEvent[]
}

function transcriptFile(runtime: string, cwd: string, sessionId: string): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify([runtime, cwd, sessionId])).digest('hex')
  return path.join(TRANSCRIPT_DIR, `${digest}.json`)
}

/** 완료된 턴만 동기 저장한다 — 스트리밍 청크마다 디스크를 쓰지 않는다. */
export function writeAgentTranscript(runtime: string, cwd: string, sessionId: string, events: AgentEvent[]): void {
  if (!sessionId) return
  const value: StoredTranscript = { version: VERSION, runtime, cwd, sessionId, events }
  try {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true, mode: 0o700 })
    writeFileAtomic(transcriptFile(runtime, cwd, sessionId), `${JSON.stringify(value)}\n`)
  } catch (err) {
    // 이 파일은 복원 품질을 높이는 보조 기록이다. 저장 실패가 이미 끝난 작업을 실패로 바꾸지 않는다.
    console.error('[mew:agent] 전사 저장 실패:', err)
  }
}

/** 현재 런타임·작업 경로·ACP 세션 ID가 모두 같은 전사만 되돌린다. */
export function readAgentTranscript(runtime: string, cwd: string, sessionId: string): AgentEvent[] | null {
  try {
    const value = readJsonFile<unknown>(transcriptFile(runtime, cwd, sessionId))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const stored = value as Partial<StoredTranscript>
    if (stored.version !== VERSION || stored.runtime !== runtime || stored.cwd !== cwd || stored.sessionId !== sessionId || !Array.isArray(stored.events)) return null
    return stored.events as AgentEvent[]
  } catch {
    return null
  }
}

/** ACP may replay whole messages while the saved transcript contains streaming chunks. */
function conversationTurns(events: AgentEvent[]): { events: AgentEvent[]; identity: string; userIdentity: string }[] {
  const turns: { events: AgentEvent[]; identity: string; userIdentity: string }[] = []
  let group: AgentEvent[] = [], messages: { role: string; content: unknown[] }[] = [], hasUser = false, replied = false
  const flush = () => {
    if (group.length) turns.push({
      events: group,
      identity: JSON.stringify(messages),
      userIdentity: JSON.stringify(messages.filter(message => message.role === 'user_message_chunk')),
    })
    group = []; messages = []; hasUser = false; replied = false
  }
  for (const event of events) {
    const update = event.type === 'update' ? event.update : null
    const user = update?.sessionUpdate === 'user_message_chunk'
    if (user && hasUser && replied) flush()
    group.push(event)
    if (user) hasUser = true
    else if (event.type === 'turn_end' || update && ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'].includes(update.sessionUpdate)) replied = true
    if (update?.sessionUpdate !== 'user_message_chunk' && update?.sessionUpdate !== 'agent_message_chunk') continue
    const role = update.sessionUpdate
    let message = messages.at(-1)
    if (!message || message.role !== role) { message = { role, content: [] }; messages.push(message) }
    const content = update.content
    if (content.type === 'text') {
      const last = message.content.at(-1)
      if (typeof last === 'string') message.content[message.content.length - 1] = last + content.text
      else message.content.push(content.text)
    } else message.content.push(content)
  }
  flush()
  return turns
}

/** Fresh backend history wins; only an identical completed prefix keeps Mew-only detail. */
export function reconcileAgentTranscript(saved: AgentEvent[] | null, loaded: AgentEvent[]): AgentEvent[] {
  if (!saved?.length) return loaded
  // Some ACP adapters restore context without replaying conversation messages.
  if (!loaded.some(event => event.type === 'update' && ['user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'].includes(event.update.sessionUpdate))) return saved
  const cached = conversationTurns(saved), fresh = conversationTurns(loaded)
  let matching = true
  let matchingUsers = true
  return fresh.flatMap((turn, index) => {
    const previous = cached[index]
    matching = matching && !!previous && previous.identity === turn.identity && previous.events.some(event => event.type === 'turn_end')
    matchingUsers = matchingUsers && !!previous && previous.userIdentity === turn.userIdentity
    if (matching) return previous.events
    // ACP can omit intermediate replies or replay different answer text. Settings belong to
    // the submitted question, so retain them independently of answer/turn_end equality.
    // Stop at the first changed question: repeated text in a different turn is not a match.
    if (!matchingUsers) return turn.events
    const settings = previous.events.flatMap(event =>
      event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk' && event.settings ? [event.settings] : [])
    const first = settings[0]
    if (!first || settings.some(value => value.model !== first.model || value.thinking !== first.thinking || value.permission !== first.permission)) return turn.events
    return turn.events.map(event =>
      event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk' && !event.settings
        ? { ...event, settings: first }
        : event)
  })
}
