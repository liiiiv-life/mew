import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { HistoryIndex, type HistoryPreview } from '../shared/agent-history.ts'
import type { AgentEvent } from './agentAcp.ts'
import { transcriptKey } from './agentTranscript.ts'
import { DATA_DIR } from './dataDir.ts'

const MAX_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 500
const pending = new Map<string, Promise<HistoryPreview<AgentEvent> | null>>()
type Input = { file: string; key: string; sessionId: string }

/** Optional preview I/O and parsing run beside ACP startup, without opening or migrating the writer DB. */
export function readAgentHistoryPreview(runtime: string, cwd: string, sessionId: string): Promise<HistoryPreview<AgentEvent> | null> {
  const key = transcriptKey(runtime, cwd, sessionId)
  const existing = pending.get(key)
  if (existing) return existing
  const read = (async () => {
    const file = path.join(DATA_DIR, 'agent-transcripts', 'transcripts.sqlite')
    try { await fs.access(file) } catch { return null }
    return new Promise<HistoryPreview<AgentEvent> | null>(resolve => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { file, key, sessionId } satisfies Input,
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      })
      let settled = false
      const finish = (value: HistoryPreview<AgentEvent> | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
        void worker.terminate()
      }
      const timer = setTimeout(() => finish(null), TIMEOUT_MS)
      timer.unref()
      worker.once('message', finish)
      worker.once('error', () => finish(null))
      worker.once('exit', () => finish(null))
    })
  })().catch(() => null).finally(() => pending.delete(key))
  pending.set(key, read)
  return read
}

function readPreview({ file, key, sessionId }: Input): HistoryPreview<AgentEvent> | null {
  const store = new DatabaseSync(file, { readOnly: true })
  try {
    store.exec('PRAGMA busy_timeout=50; BEGIN')
    const total = Number(store.prepare('SELECT count FROM sessions WHERE key=?').get(key)?.count ?? 0)
    if (!Number.isSafeInteger(total) || total <= 0) return null
    const query = store.prepare('SELECT payload FROM events WHERE session_key=? AND seq>=? AND seq<? ORDER BY seq')
    const chunks: AgentEvent[][] = []
    let start = total, bytes = 0
    while (start > 0) {
      const end = start
      start = Math.max(0, end - 256)
      const rows = query.all(key, start, end)
      if (rows.length !== end - start) return null
      for (const row of rows) bytes += Buffer.byteLength(String(row.payload), 'utf8')
      if (bytes > MAX_BYTES) return null
      chunks.unshift(rows.map(row => JSON.parse(String(row.payload)) as AgentEvent))
      const events = chunks.flat()
      const index = new HistoryIndex<AgentEvent>('preview')
      for (const event of events) index.push(event)
      const range = index.range()
      // An extra question excludes a potentially partial first question at the batch boundary.
      if (range.start > 0 || start === 0) return { sessionId, start: start + range.start, events: events.slice(range.start) }
    }
    return null
  } finally { store.close() }
}

if (!isMainThread) {
  let preview: HistoryPreview<AgentEvent> | null = null
  try { preview = readPreview(workerData as Input) } catch { /* ACP still restores unavailable or damaged records. */ }
  parentPort?.postMessage(preview)
}
