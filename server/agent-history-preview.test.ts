import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { HistoryIndex } from '../shared/agent-history.ts'
import type { AgentEvent } from './agentAcp.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-history-preview-'))
process.env.MEW_DATA_DIR = root
const { readAgentHistoryPreview } = await import('./agent-history-preview.ts')
const { writeAgentTranscript, readAgentTranscript, transcriptKey, closeTranscriptDatabase } = await import('./agentTranscript.ts')
after(() => { closeTranscriptDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
const message = (role: 'user' | 'agent', text: string, messageId?: string): AgentEvent => ({
  type: 'update', update: { sessionUpdate: role === 'user' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text }, ...(messageId ? { messageId } : {}) },
} as AgentEvent)

test('absent display storage is optional and preview never creates it', async () => {
  assert.equal(await readAgentHistoryPreview('codex', '/workspace', 'absent'), null)
  assert.equal(fs.existsSync(path.join(root, 'agent-transcripts')), false)
})

test('preview matches the last 20 whole questions across read batches without parsing older records', async () => {
  const events: AgentEvent[] = [{ type: 'models', models: { currentModelId: 'saved', availableModels: [] } }]
  for (let i = 0; i < 100; i++) {
    events.push(message('user', `Question ${i}`, String(i)), message('user', ' continued', String(i)), { type: 'turn_start', startedAt: 100 })
    for (let j = 0; j < 30; j++) events.push(message('agent', `Answer ${i}/${j}`))
    events.push({ type: 'turn_end', stopReason: 'end_turn', durationMs: 1200 })
  }
  assert.equal(writeAgentTranscript('codex', '/workspace', 'long', events), true)
  const index = new HistoryIndex<AgentEvent>('saved')
  for (const event of events) index.push(event)
  const expected = index.page(events, 'long')
  const store = new DatabaseSync(path.join(root, 'agent-transcripts', 'transcripts.sqlite'))
  store.prepare('UPDATE events SET payload=? WHERE session_key=? AND seq=0').run('not JSON', transcriptKey('codex', '/workspace', 'long'))
  store.close()
  let ticks = 0
  const heartbeat = setInterval(() => ticks++, 1)
  try {
    const [preview, duplicate] = await Promise.all([
      readAgentHistoryPreview('codex', '/workspace', 'long'), readAgentHistoryPreview('codex', '/workspace', 'long'),
    ])
    assert.deepEqual(preview, { sessionId: 'long', start: expected.start, events: expected.events })
    assert.equal(preview, duplicate, 'concurrent subscribers share one pending worker read')
    assert.ok(ticks > 0, 'the host keeps processing events while preview is read')
    assert.equal('generation' in preview!, false, 'preview cannot be used as a reconnect cursor')
    assert.equal(await readAgentHistoryPreview('claude', '/workspace', 'long'), null)
    assert.equal(await readAgentHistoryPreview('codex', '/other', 'long'), null)
  } finally { clearInterval(heartbeat) }
})

test('one long streamed question is not split or mistaken for many questions', async () => {
  const events: AgentEvent[] = Array.from({ length: 600 }, () => message('user', 'one long question', 'one'))
  events.push(message('agent', 'one answer'))
  assert.equal(writeAgentTranscript('codex', '/workspace', 'streamed', events), true)
  assert.deepEqual(await readAgentHistoryPreview('codex', '/workspace', 'streamed'), { sessionId: 'streamed', start: 0, events })
  assert.deepEqual(readAgentTranscript('codex', '/workspace', 'streamed'), events, 'preview leaves the writer transcript intact')
})

test('oversized or damaged snapshots fall back to ACP without altering saved data', async () => {
  const events = [message('user', 'large question'), message('agent', 'x'.repeat(4 * 1024 * 1024))]
  assert.equal(writeAgentTranscript('codex', '/workspace', 'large', events), true)
  assert.equal(await readAgentHistoryPreview('codex', '/workspace', 'large'), null)
  const broken = [message('user', 'broken'), message('agent', 'answer')]
  assert.equal(writeAgentTranscript('codex', '/workspace', 'broken', broken), true)
  const store = new DatabaseSync(path.join(root, 'agent-transcripts', 'transcripts.sqlite'))
  const key = transcriptKey('codex', '/workspace', 'broken')
  store.prepare('UPDATE events SET payload=? WHERE session_key=? AND seq=1').run('not JSON', key)
  store.close()
  assert.equal(await readAgentHistoryPreview('codex', '/workspace', 'broken'), null)
  const check = new DatabaseSync(path.join(root, 'agent-transcripts', 'transcripts.sqlite'), { readOnly: true })
  try { assert.equal(check.prepare('SELECT payload FROM events WHERE session_key=? AND seq=1').get(key)?.payload, 'not JSON') }
  finally { check.close() }
})
