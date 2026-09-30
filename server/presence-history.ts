import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { DATA_DIR } from './dataDir.ts'
import { projectRoot } from './paths.ts'
import { fileAccess } from './access-policy.ts'
import type { RequestAuth } from './reqAuth.ts'
import type { ActiveMewSession, MewSessionHistory, MewSessionRecord } from '../shared/active-sessions.ts'

export const HISTORY_MAX_RECORDS = 50_000
export class HistoryQueryError extends Error {}
export interface HistoryRange { from: number; to: number; dayFrom: number; dayTo: number; person?: string }

export function parseHistoryRange(query: Record<string, unknown>): HistoryRange {
  const number = (key: string) => typeof query[key] === 'string' && /^\d{1,15}$/.test(query[key] as string) ? Number(query[key]) : NaN
  const from = number('from'), to = number('to'), dayFrom = number('dayFrom'), dayTo = number('dayTo')
  if (![from, to, dayFrom, dayTo].every(Number.isSafeInteger) || dayFrom < 0 || dayTo - dayFrom < 1 || dayTo - dayFrom > 25 * 3600_000
    || from < dayFrom || to > dayTo || from >= to || to > 8.64e15) throw new HistoryQueryError('Invalid day/time range')
  if (query.person !== undefined && (typeof query.person !== 'string' || query.person.length > 320)) throw new HistoryQueryError('Invalid person')
  return { from, to, dayFrom, dayTo, person: query.person as string | undefined }
}

/** Root identity is internal; it must never be returned to the browser or spreadsheet. */
export function historyScope(project: string | null): string | null {
  if (!project) return null
  try { return createHash('sha256').update(fs.realpathSync(projectRoot(project))).digest('hex') } catch { return null }
}

export class PresenceHistoryStore {
  private database: DatabaseSync
  private current = new Map<string, { signature: string; updatedAt: number }>()
  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(file)
    try {
      fs.chmodSync(file, 0o600)
      const version = Number(this.database.prepare('PRAGMA user_version').get()?.user_version ?? 0)
      if (version > 1) throw new Error('Unsupported presence history database version')
      this.database.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
        CREATE TABLE IF NOT EXISTS history_meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY, connected_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, disconnected_at INTEGER);
        CREATE TABLE IF NOT EXISTS intervals(
          id INTEGER PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id),
          started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, email TEXT, snapshot TEXT NOT NULL, scope TEXT
        );
        CREATE INDEX IF NOT EXISTS intervals_time ON intervals(ended_at, started_at);
        CREATE INDEX IF NOT EXISTS intervals_person_time ON intervals(email, ended_at);
        CREATE INDEX IF NOT EXISTS intervals_connection ON intervals(connection_id, id);
        PRAGMA user_version=1;
        UPDATE connections SET disconnected_at=last_seen WHERE disconnected_at IS NULL;`)
      this.database.prepare('INSERT OR IGNORE INTO history_meta VALUES(?,?)').run('recorded_since', Date.now())
    } catch (error) { this.database.close(); throw error }
  }
  close() { this.database.close() }
  observe(session: ActiveMewSession, observedAt: number, scope = historyScope(session.project), changedAt = observedAt) {
    const snapshot = { ...session, agents: session.agents ? { running: session.agents.running, reportedAt: 0 } : null }
    const signature = JSON.stringify([snapshot, scope])
    const previous = this.current.get(session.id)
    observedAt = Math.max(session.connectedAt, observedAt, previous?.updatedAt ?? 0)
    if (previous && previous.signature !== signature) observedAt = Math.max(observedAt, changedAt)
    // Peer broadcasts do not extend this connection's lifetime. Heartbeats refresh at most every 30s.
    if (previous?.signature === signature && observedAt - previous.updatedAt < 30_000) return
    const store = this.database
    store.exec('BEGIN IMMEDIATE')
    try {
      store.prepare(`INSERT INTO connections VALUES(?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET
        last_seen=MAX(last_seen,excluded.last_seen), disconnected_at=NULL`).run(session.id, session.connectedAt, observedAt)
      if (previous && previous.signature !== signature) {
        store.prepare('UPDATE intervals SET ended_at=MAX(ended_at,?) WHERE id=(SELECT MAX(id) FROM intervals WHERE connection_id=?)').run(observedAt, session.id)
      }
      if (!previous || previous.signature !== signature) {
        store.prepare('INSERT INTO intervals(connection_id,started_at,ended_at,email,snapshot,scope) VALUES(?,?,?,?,?,?)')
          .run(session.id, previous ? observedAt : session.connectedAt, observedAt, session.email, JSON.stringify(snapshot), scope)
      } else {
        store.prepare('UPDATE intervals SET ended_at=MAX(ended_at,?) WHERE id=(SELECT MAX(id) FROM intervals WHERE connection_id=?)').run(observedAt, session.id)
      }
      store.exec('COMMIT')
      this.current.set(session.id, { signature, updatedAt: observedAt })
    } catch (error) { store.exec('ROLLBACK'); throw error }
  }
  disconnect(id: string, at: number) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE connections SET last_seen=MAX(last_seen,?),disconnected_at=MAX(last_seen,?) WHERE id=?').run(at, at, id)
      this.database.prepare('UPDATE intervals SET ended_at=MAX(ended_at,?) WHERE id=(SELECT MAX(id) FROM intervals WHERE connection_id=?)').run(at, id)
      this.database.exec('COMMIT')
      this.current.delete(id)
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  query(range: HistoryRange, canSee: (session: ActiveMewSession, scope: string | null) => boolean): MewSessionHistory {
    const rows = this.database.prepare(`SELECT i.*, c.disconnected_at FROM intervals i JOIN connections c ON c.id=i.connection_id
      WHERE i.started_at<? AND i.ended_at>? AND (? IS NULL OR COALESCE(i.email,'guest')=?)
      ORDER BY i.started_at,i.id LIMIT ?`).all(range.to, range.from, range.person || null, range.person || null, HISTORY_MAX_RECORDS + 1)
    if (rows.length > HISTORY_MAX_RECORDS) throw new HistoryQueryError('Too many records; choose a shorter time range or a person')
    const people = this.database.prepare(`SELECT i.email, i.snapshot FROM intervals i
      WHERE i.started_at<? AND i.ended_at>? GROUP BY i.email ORDER BY i.email`).all(range.dayTo, range.dayFrom)
      .map(row => { const session = JSON.parse(String(row.snapshot)) as ActiveMewSession; return { email: session.email, displayName: session.displayName } })
    return {
      records: rows.map(row => {
        const session = JSON.parse(String(row.snapshot)) as ActiveMewSession
        const visible = canSee(session, row.scope === null ? null : String(row.scope))
        return { ...session, agents: session.agents ? { ...session.agents, reportedAt: Number(row.ended_at) } : null,
          ...(visible ? {} : { project: null, path: null, workspaceLabel: null }),
          recordId: Number(row.id), startedAt: Math.max(range.from, Number(row.started_at)), endedAt: Math.min(range.to, Number(row.ended_at)),
          disconnectedAt: row.disconnected_at === null ? null : Number(row.disconnected_at),
        } satisfies MewSessionRecord
      }), people, generatedAt: Date.now(), recordedSince: Number(this.database.prepare("SELECT value FROM history_meta WHERE key='recorded_since'").get()!.value),
    }
  }
}
let store: PresenceHistoryStore | undefined
const recordingErrors = new Map<string, unknown>()
function historyStore() { return store ??= new PresenceHistoryStore(path.join(DATA_DIR, 'presence', 'history.sqlite')) }
export function recordPresence(session: ActiveMewSession, observedAt: number) {
  try { historyStore().observe(session, observedAt, historyScope(session.project), Date.now()); recordingErrors.delete(session.id) }
  catch (error) { if (!recordingErrors.has(session.id)) console.error('[mew:presence] History recording failed', error); recordingErrors.set(session.id, error) }
}
export function endPresence(id: string, at: number) {
  try { historyStore().disconnect(id, at); recordingErrors.delete(id) }
  catch (error) { if (!recordingErrors.has(id)) console.error('[mew:presence] History recording failed', error); recordingErrors.set(id, error) }
}
export function readPresenceHistory(range: HistoryRange, auth: RequestAuth) {
  if (auth.role === 'guest' || auth.mustChangePassword) throw new Error('Authentication required')
  if (recordingErrors.size) throw new Error('Session history recording is unavailable')
  const roots = new Map<string, string | null>()
  const permissions = new Map<string, boolean>()
  return historyStore().query(range, (session, scope) => {
    if (!session.project) return true
    const key = JSON.stringify([session.project, session.path, scope])
    if (permissions.has(key)) return permissions.get(key)!
    if (!roots.has(session.project)) roots.set(session.project, historyScope(session.project))
    const visible = scope !== null && scope === roots.get(session.project) && fileAccess(auth, session.project, session.path ?? '').view
    permissions.set(key, visible)
    return visible
  })
}
