// SQLite contains Mew's display transcript; ACP remains the runtime context authority.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DATA_DIR, readJsonFile } from './dataDir.ts'
import type { AgentEvent } from './agentAcp.ts'

const TRANSCRIPT_DIR = path.join(DATA_DIR, 'agent-transcripts')
let database: DatabaseSync | null = null
const written = new WeakMap<AgentEvent[], { key: string; count: number; revision: string }>()

export function transcriptKey(runtime: string, cwd: string, sessionId: string): string {
  return crypto.createHash('sha256').update(JSON.stringify([runtime, cwd, sessionId])).digest('hex')
}

function db(): DatabaseSync {
  if (database) return database
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true, mode: 0o700 })
  const file = path.join(TRANSCRIPT_DIR, 'transcripts.sqlite')
  const opened = new DatabaseSync(file)
  try {
    fs.chmodSync(file, 0o600)
    const version = Number(opened.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version > 1) throw new Error('지원하지 않는 전사 DB 버전')
    opened.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY, runtime TEXT NOT NULL, cwd TEXT NOT NULL, session_id TEXT NOT NULL,
        revision TEXT NOT NULL, count INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        session_key TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (session_key, seq)
      ) WITHOUT ROWID; PRAGMA user_version=1;`)
    database = opened
    return opened
  } catch (error) { opened.close(); throw error }
}

export function closeTranscriptDatabase(): void { database?.close(); database = null }

/** Same append-only array: serialize/insert only its new tail. A restored array replaces atomically. */
export function writeAgentTranscript(runtime: string, cwd: string, sessionId: string, events: AgentEvent[], onlyIfMissing = false): boolean {
  if (!sessionId) return false
  try {
    const store = db(), key = transcriptKey(runtime, cwd, sessionId)
    const previous = written.get(events)
    store.exec('BEGIN IMMEDIATE')
    let count = 0, revision = crypto.randomUUID() as string
    try {
      const current = store.prepare('SELECT count, revision FROM sessions WHERE key=?').get(key)
      if (onlyIfMissing && current) { store.exec('COMMIT'); return true }
      if (previous?.key === key && current && (current.revision !== previous.revision || current.count !== previous.count)) {
        throw new Error('다른 writer가 변경한 전사를 오래된 버퍼로 덮어쓸 수 없습니다')
      }
      if (previous?.key === key && previous.count <= events.length
        && current?.revision === previous.revision && current?.count === previous.count) {
        count = previous.count
        revision = previous.revision
        if (count === events.length) { store.exec('COMMIT'); return true }
      } else {
        store.prepare('DELETE FROM events WHERE session_key=?').run(key)
      }
      const insert = store.prepare('INSERT INTO events(session_key,seq,payload) VALUES(?,?,?)')
      for (let i = count; i < events.length; i++) insert.run(key, i, JSON.stringify(events[i]))
      store.prepare(`INSERT INTO sessions VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
        revision=excluded.revision, count=excluded.count, updated_at=excluded.updated_at`)
        .run(key, runtime, cwd, sessionId, revision, events.length, Date.now())
      store.exec('COMMIT')
      written.set(events, { key, count: events.length, revision })
      return true
    } catch (error) { store.exec('ROLLBACK'); throw error }
  } catch (error) {
    console.error('[mew:agent] 전사 저장 실패:', error)
    return false
  }
}

function importLegacy(runtime: string, cwd: string, sessionId: string): void {
  const key = transcriptKey(runtime, cwd, sessionId)
  if (db().prepare('SELECT key FROM sessions WHERE key=?').get(key)) return
  const value = readJsonFile<unknown>(path.join(TRANSCRIPT_DIR, `${key}.json`))
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const stored = value as { version?: number; runtime?: string; cwd?: string; sessionId?: string; events?: AgentEvent[] }
  // v1 was truncated. Never promote it to a complete transcript.
  if (stored.version !== 2 || stored.runtime !== runtime || stored.cwd !== cwd || stored.sessionId !== sessionId
    || !Array.isArray(stored.events) || !stored.events.every(event => event && typeof event.type === 'string')) return
  if (!writeAgentTranscript(runtime, cwd, sessionId, stored.events, true)) throw new Error('기존 전사 이전 실패')
}

export function readAgentTranscript(runtime: string, cwd: string, sessionId: string): AgentEvent[] | null {
  try {
    importLegacy(runtime, cwd, sessionId)
    const key = transcriptKey(runtime, cwd, sessionId)
    if (!db().prepare('SELECT key FROM sessions WHERE key=?').get(key)) return null
    return readAgentTranscriptRange(runtime, cwd, sessionId, 0, Number.MAX_SAFE_INTEGER)
  } catch (error) {
    console.error('[mew:agent] 전사 읽기 실패:', error)
    return null
  }
}

/** Indexed half-open range, without parsing the rest of the conversation. */
export function readAgentTranscriptRange(runtime: string, cwd: string, sessionId: string, start: number, end: number): AgentEvent[] {
  return db().prepare('SELECT payload FROM events WHERE session_key=? AND seq>=? AND seq<? ORDER BY seq')
    .all(transcriptKey(runtime, cwd, sessionId), start, end).map(row => JSON.parse(String(row.payload)) as AgentEvent)
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
