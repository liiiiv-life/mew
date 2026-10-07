import test from 'node:test'
import assert from 'node:assert/strict'
import { HistoryIndex } from '../../shared/agent-history.ts'
import { mergeHistoryPage, appendHistoryEvent, appendHistoryEventInPlace } from './agent-history-state.ts'
import { recentHistory } from './agent-history-cache.ts'
import { foldEvents, type AgentEvent } from './agentFold.ts'
const events: AgentEvent[] = Array.from({ length: 100 }, (_, i) => [
  { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: `q${i}` } } },
  { type: 'turn_start', startedAt: 100 },
  { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `a${i}` } } },
  { type: 'turn_end', stopReason: 'end_turn' },
] as AgentEvent[]).flat()
function index() { const value = new HistoryIndex<AgentEvent>('generation'); events.forEach(event => value.push(event)); return value }

test('recent pages preserve complete turns and loading all prior pages reconstructs the original', () => {
  const source = index()
  let state = mergeHistoryPage(null, source.page(events, 'session'))!
  assert.equal(state.usersBefore, 80)
  assert.equal(state.events.length, 80)
  const key = foldEvents(state.events, 'en', state.start)[0].key
  while (state.start) state = mergeHistoryPage(state, source.page(events, 'session', { generation: state.generation, before: state.start }))!
  assert.deepEqual(state.events, events)
  assert.ok(foldEvents(state.events, 'en').some(item => item.key === key))
  const cached = recentHistory(state)
  assert.equal(cached.usersBefore, 80)
  assert.equal(cached.events.length, 80)
})

test('reconnect sends only new events; duplicate live events are ignored and gaps rejected', () => {
  const source = index()
  let state = mergeHistoryPage(null, source.page(events, 'session'))!
  const event: AgentEvent = { type: 'error', message: 'tail' }
  source.push(event)
  const page = source.page([...events, event], 'session', { generation: state.generation, after: state.end })
  assert.deepEqual(page.events, [event])
  state = mergeHistoryPage(state, page)!
  assert.equal(appendHistoryEvent(state, event, { generation: state.generation, seq: state.end - 1 }), state)
  assert.equal(appendHistoryEvent(state, event, { generation: state.generation, seq: state.end + 1 }), null)
  assert.equal(appendHistoryEvent(state, event, { generation: 'new', seq: state.end }), null)
  assert.equal(mergeHistoryPage(null, page), null)
  assert.equal(source.page(events, 'session', { generation: 'old', after: 400 }).mode, 'replace')
})

test('prepend during a live append retains the new tail; question chunks stay together', () => {
  const source = index()
  let state = mergeHistoryPage(null, source.page(events, 'session'))!
  const earlier = source.page(events, 'session', { generation: state.generation, before: state.start })
  const extra: AgentEvent = { type: 'error', message: 'arrived while reading older messages' }
  state = appendHistoryEvent(state, extra, { generation: state.generation, seq: state.end })!
  state = mergeHistoryPage(state, earlier)!
  assert.equal(state.events.at(-1), extra)
  assert.equal(state.usersBefore, 60)
  const chunks = new HistoryIndex<AgentEvent>('chunks')
  for (let i = 0; i < 50; i++) chunks.push(events[0])
  assert.equal(chunks.boundaries.length, 1)
})

test('socket buffer appends advance the reconnect cursor before rendering without changing snapshots', () => {
  const source = index()
  const state = mergeHistoryPage(null, source.page(events, 'session'))!
  const snapshot = state.events.slice()
  const cached = recentHistory(state)
  const event: AgentEvent = { type: 'error', message: 'streamed tail' }
  const position = { generation: state.generation, seq: state.end }
  const original = state.events
  assert.equal(appendHistoryEventInPlace(state, event, position), 'append')
  assert.equal(state.events, original, 'one owned buffer replaces per-event array copies')
  assert.equal(state.end, position.seq + 1)
  assert.equal(snapshot.length, 80)
  assert.equal(cached.events.length, 80, 'a pending cache write keeps its original snapshot')
  assert.equal(appendHistoryEventInPlace(state, event, position), 'duplicate')
  assert.equal(appendHistoryEventInPlace(state, event, { ...position, seq: state.end + 1 }), 'gap')
  assert.equal(appendHistoryEventInPlace(state, event, { ...position, generation: 'other' }), 'gap')
  assert.equal(state.events.length, 81)
  assert.equal(recentHistory(state).events.at(-1), event, 'the cached index includes the new tail')
})

test('incremental cache indexing keeps complete questions as its twenty-turn window advances', () => {
  const state = mergeHistoryPage(null, index().page(events, 'session'))!
  for (let i = 0; i < 5; i++) {
    recentHistory(state)
    for (const event of events.slice(i * 4, i * 4 + 4)) {
      appendHistoryEventInPlace(state, event, { generation: state.generation, seq: state.end })
    }
    const cached = recentHistory(state)
    assert.equal(cached.events.length, 80)
    assert.equal(cached.usersBefore, 81 + i)
    assert.equal(cached.start, 324 + i * 4)
  }
})
