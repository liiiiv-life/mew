import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { HistoryIndex, validHistoryRequest, type HistoryPreview, type HistoryRequest } from '../shared/agent-history.ts'
import { agentDisplayEvent, compactHistoryWork, isHistoryWorkEvent } from '../shared/agent-display.ts'
import type { AgentEvent } from './agentAcp.ts'
import { transcriptKey } from './agentTranscript.ts'
import { DATA_DIR } from './dataDir.ts'

const MAX_BYTES = 4 * 1024 * 1024
const MAX_SCAN_BYTES = 64 * 1024 * 1024
const MAX_EVENT_BYTES = 8 * 1024 * 1024
const MAX_SCAN_EVENTS = 50_000
const TIMEOUT_MS = 500
const pending = new Map<string, Promise<HistoryPreview<AgentEvent> | null>>()
type Input = { file: string; key: string; sessionId: string; options: Pick<HistoryRequest, 'deferWork' | 'turns'> }

/** Optional preview I/O and parsing run beside ACP startup, without opening or migrating the writer DB. */
export function readAgentHistoryPreview(runtime: string, cwd: string, sessionId: string, request: Pick<HistoryRequest, 'deferWork' | 'turns'> = {}): Promise<HistoryPreview<AgentEvent> | null> {
  const key = transcriptKey(runtime, cwd, sessionId)
  const options = validHistoryRequest(request)
  const pendingKey = `${key}:${options.turns ?? 20}:${options.deferWork === true}`
  const existing = pending.get(pendingKey)
  if (existing) return existing
  const read = (async () => {
    const file = path.join(DATA_DIR, 'agent-transcripts', 'transcripts.sqlite')
    try { await fs.access(file) } catch { return null }
    return new Promise<HistoryPreview<AgentEvent> | null>(resolve => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { file, key, sessionId, options } satisfies Input,
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
  })().catch(() => null).finally(() => pending.delete(pendingKey))
  pending.set(pendingKey, read)
  return read
}

function readPreview({ file, key, sessionId, options }: Input): HistoryPreview<AgentEvent> | null {
  const store = new DatabaseSync(file, { readOnly: true })
  try {
    store.exec('PRAGMA busy_timeout=50; BEGIN')
    const total = Number(store.prepare('SELECT count FROM sessions WHERE key=?').get(key)?.count ?? 0)
    if (!Number.isSafeInteger(total) || total <= 0) return null
    const sizes = store.prepare('SELECT seq,length(CAST(payload AS BLOB)) AS bytes FROM events WHERE session_key=? AND seq>=? AND seq<? ORDER BY seq')
    const query = store.prepare('SELECT payload FROM events WHERE session_key=? AND seq=?')
    const chunks: AgentEvent[][] = []
    let start = total, bytes = Buffer.byteLength(JSON.stringify({ sessionId, start: total, events: [] }), 'utf8'), scanned = 0, scannedEvents = 0
    while (start > 0) {
      const end = start
      start = Math.max(0, end - 256)
      const rows = sizes.all(key, start, end)
      if (rows.length !== end - start || (scannedEvents += rows.length) > MAX_SCAN_EVENTS) return null
      const projected: AgentEvent[] = []
      for (const [offset, row] of rows.entries()) {
        const rawBytes = Number(row.bytes)
        if (Number(row.seq) !== start + offset || !Number.isSafeInteger(rawBytes) || rawBytes <= 0 || rawBytes > MAX_EVENT_BYTES) return null
        scanned += rawBytes
        if (scanned > MAX_SCAN_BYTES) return null
        const payload = query.get(key, row.seq)?.payload
        if (typeof payload !== 'string') return null
        const source = JSON.parse(payload) as AgentEvent
        const event: AgentEvent = options.deferWork && isHistoryWorkEvent(source)
          ? { type: 'work_pending', count: 1 } : agentDisplayEvent(source)
        bytes += Buffer.byteLength(JSON.stringify(event), 'utf8') + 1
        if (bytes > MAX_BYTES) return null
        projected.push(event)
      }
      chunks.unshift(projected)
      const events = chunks.flat()
      const index = new HistoryIndex<AgentEvent>('preview')
      for (const event of events) index.push(event)
      const range = index.range(options)
      // An extra question excludes a potentially partial first question at the batch boundary.
      if (range.start > 0 || start === 0) return { sessionId, start: start + range.start,
        events: options.deferWork ? compactHistoryWork(events.slice(range.start)) : events.slice(range.start) }
    }
    return null
  } finally { store.close() }
}

if (!isMainThread) {
  let preview: HistoryPreview<AgentEvent> | null = null
  try { preview = readPreview(workerData as Input) } catch { /* ACP still restores unavailable or damaged records. */ }
  parentPort?.postMessage(preview)
}
