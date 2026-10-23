import test from 'node:test'
import assert from 'node:assert/strict'
import { agentDisplayEvent, agentDisplayMessage, compactHistoryWork } from '../shared/agent-display.ts'
import { HistoryIndex, expandHistoryWork, validHistoryRequest, validHistoryDetailsRequest, type HistoryPage } from '../shared/agent-history.ts'
import { foldEvents, type AgentEvent } from '../src/utils/agentFold.ts'

function records() {
  return [
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Question' } } },
    { type: 'turn_start', startedAt: 10 },
    { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'tool', title: 'Read a file', status: 'pending', kind: 'read', rawInput: { body: 'x'.repeat(100_000) }, locations: [{ path: '/fixture' }] }, settings: { model: 'Model', thinking: 'High', permission: 'Ask' } },
    { type: 'permission', id: 'approval', toolCall: { title: 'Read a file', rawInput: { path: '/fixture' } }, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }] },
    { type: 'permission_done', id: 'approval' },
    { type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool', title: null, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'result'.repeat(100_000) } }], rawOutput: { ok: true } } },
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Answer' } } },
    { type: 'turn_end', stopReason: 'end_turn', durationMs: 10 },
  ]
}

test('display projection preserves the rendered conversation and approvals without changing source records', () => {
  const events = records()
  const original = structuredClone(events)
  for (const event of events) { if ('update' in event) Object.freeze(event.update); Object.freeze(event) }
  const projected = events.map(agentDisplayEvent)
  assert.deepEqual(events, original)
  assert.deepEqual(foldEvents(projected as AgentEvent[], 'ko'), foldEvents(events as AgentEvent[], 'ko'))
  assert.equal(projected[3], events[3], 'approval payloads retain their complete tool request and options')
  assert.equal(projected[6], events[6], 'answer text is untouched')
  assert.deepEqual(projected[2], { ...events[2], update: { sessionUpdate: 'tool_call', toolCallId: 'tool', title: 'Read a file', status: 'pending', kind: 'read' } })
  assert.deepEqual(projected[5], { ...events[5], update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool', title: null, status: 'completed' } })
  assert.ok(JSON.stringify(projected).length < JSON.stringify(events).length / 100)
  assert.equal(agentDisplayEvent(projected[2]), projected[2], 'already projected events are reused')
})

test('paged, preview, replay, sequenced and legacy messages share the display contract and preserve all envelope fields', () => {
  const events = records() as AgentEvent[], index = new HistoryIndex<AgentEvent>('generation')
  events.forEach(event => index.push(event))
  const page: HistoryPage<AgentEvent> = { ...index.page(events, 'session'), controls: [{ type: 'models', models: { currentModelId: 'model', availableModels: [] } }] }
  const history = { type: 'history', page, restoreFailure: { sessionId: 'previous', message: 'unavailable' } }
  const displayHistory = agentDisplayMessage(history)
  assert.deepEqual(displayHistory, { ...history, page: { ...page, events: events.map(agentDisplayEvent) } })
  assert.deepEqual(history.page.events, events)
  for (const mode of ['append', 'prepend', 'replace'] as const) {
    const source = { ...history, page: { ...page, mode, start: 100, end: 100 + events.length, total: 200, usersBefore: 20 } }
    assert.deepEqual(agentDisplayMessage(source), { ...source, page: { ...source.page, events: events.map(agentDisplayEvent) } })
  }
  const preview = { type: 'history_preview', preview: { sessionId: 'session', start: 100, events } }
  assert.deepEqual(agentDisplayMessage(preview), { ...preview, preview: { ...preview.preview, events: events.map(agentDisplayEvent) } })
  const replay = { type: 'replay', restored: true, events, restoreFailure: history.restoreFailure }
  assert.deepEqual(agentDisplayMessage(replay), { ...replay, events: events.map(agentDisplayEvent) })
  const live = { type: 'history_event', event: events[5], position: { generation: 'generation', seq: 105 } }
  assert.deepEqual(agentDisplayMessage(live), { ...live, event: agentDisplayEvent(events[5]) })
  assert.deepEqual(agentDisplayMessage(events[5]), agentDisplayEvent(events[5]))
  const controls = { type: 'models', models: { currentModelId: 'model', availableModels: [] } }
  assert.equal(agentDisplayMessage(controls), controls)
})

test('deferred work compresses only thoughts and tools while preserving sequence positions and approvals', () => {
  const events: AgentEvent[] = [
    ...records().slice(0, 3) as AgentEvent[],
    { type: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private work'.repeat(10_000) } } },
    ...records().slice(3) as AgentEvent[],
  ]
  const original = structuredClone(events)
  const compressed = compactHistoryWork(events)
  const expanded = expandHistoryWork(compressed)
  assert.equal(expanded.length, events.length)
  assert.deepEqual(compressed.filter(event => event.type === 'work_pending'), [
    { type: 'work_pending', count: 2 },
  ])
  assert.equal(expanded[4], events[4], 'approvals keep their original position and complete request')
  assert.deepEqual(expanded[6], agentDisplayEvent(events[6]), 'late status updates remain visible without creating deferred turns')
  assert.equal(expanded[7], events[7], 'visible answer text is immediately available')
  assert.deepEqual(compactHistoryWork(expanded), compressed)
  assert.deepEqual(events, original)
  assert.ok(!JSON.stringify(compressed).includes('private work'))
})

test('history accepts bounded page sizes and details ranges without changing the legacy page size', () => {
  const events: AgentEvent[] = []
  for (let i = 0; i < 30; i++) events.push(
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: `q${i}` } } },
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `a${i}` } } },
  )
  const index = new HistoryIndex<AgentEvent>('generation')
  events.forEach(event => index.push(event))
  assert.equal(index.range().usersBefore, 10)
  const recent = index.range({ deferWork: true, turns: 3 })
  assert.equal(recent.usersBefore, 27)
  assert.equal(index.range({ generation: 'generation', before: recent.start, turns: 3 }).usersBefore, 24)
  assert.deepEqual(validHistoryRequest({ turns: 21, deferWork: 'true' }), {})
  assert.deepEqual(validHistoryRequest({ turns: 3, deferWork: true }), { turns: 3, deferWork: true })
  assert.deepEqual(validHistoryDetailsRequest({ generation: 'generation', start: 0, end: 256 }), { generation: 'generation', start: 0, end: 256 })
  for (const range of [{ start: 0, end: 257 }, { start: -1, end: 0 }, { start: 1, end: 1 }, { start: 0.5, end: 1 }, { start: 0, end: Number.MAX_SAFE_INTEGER }]) {
    assert.equal(validHistoryDetailsRequest({ generation: 'generation', ...range }), null)
  }
})
