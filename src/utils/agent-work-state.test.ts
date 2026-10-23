import test from 'node:test'
import assert from 'node:assert/strict'
import { compactHistoryWork } from '../../shared/agent-display.ts'
import { expandHistoryWork } from '../../shared/agent-history.ts'
import { createEventFold, appendEventFold, foldEvents, type AgentEvent } from './agentFold.ts'
import { hydrateHistoryWork } from './agent-work-state.ts'
import { mergeHistoryPage } from './agent-history-state.ts'
import type { CachedHistory } from './agent-history-cache.ts'

const events: AgentEvent[] = [
  { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Question' } } },
  { type: 'turn_start', startedAt: 10 },
  { type: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thought' } } },
  { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 't', title: 'Inspect', status: 'pending' } },
  { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Answer' } } },
  { type: 'turn_end', stopReason: 'end_turn', durationMs: 20 },
  { type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'failed' } },
]
const history = (): CachedHistory => ({ generation: 'g', sessionId: 's', start: 100, end: 107, total: 107,
  usersBefore: 20, events: expandHistoryWork(compactHistoryWork(events)) })

test('deferred work retains global bubble keys and hydration restores late tool updates', () => {
  const current = history()
  const before = foldEvents(current.events, 'ko', 100)
  assert.deepEqual(before.map(item => item.key), foldEvents(events, 'ko', 100).map(item => item.key))
  const turn = before.find(item => item.kind === 'turn')!
  assert.equal(turn.kind, 'turn')
  if (turn.kind === 'turn') assert.deepEqual(turn.children.filter(child => child.kind === 'deferred_work').map(child => [child.start, child.end]), [[102, 104]])
  const cursor = { start: current.start, end: current.end, total: current.total }
  assert.equal(hydrateHistoryWork(current, 'g', [{ start: 102, events: events.slice(2, 4) }, { start: 106, events: events.slice(6) }]), true)
  assert.deepEqual(foldEvents(current.events, 'ko', 100), foldEvents(events, 'ko', 100))
  assert.deepEqual({ start: current.start, end: current.end, total: current.total }, cursor)
  assert.equal(hydrateHistoryWork(current, 'old-generation', [{ start: 102, events: events.slice(2, 4) }]), false)
})

test('a pending run continued in another frame keeps the previous render immutable', () => {
  const first = appendEventFold(createEventFold('ko', 100), [{ type: 'work_pending', count: 1 }])
  const next = appendEventFold(first, [{ type: 'work_pending', count: 1 }])
  assert.deepEqual(first.items[0].kind === 'turn' && first.items[0].children[0], { key: 'work100', kind: 'deferred_work', start: 100, end: 101 })
  assert.deepEqual(next.items[0].kind === 'turn' && next.items[0].children[0], { key: 'work100', kind: 'deferred_work', start: 100, end: 102 })
})

test('compact replacement preserves already opened details while rejecting missing sequences', () => {
  const current = history()
  hydrateHistoryWork(current, 'g', [{ start: 102, events: events.slice(2, 4) }])
  const page = { ...current, events: compactHistoryWork(events), controls: [], mode: 'replace' as const }
  const merged = mergeHistoryPage(current, page)!
  assert.deepEqual(merged.events.slice(2, 4), events.slice(2, 4))
  assert.deepEqual(merged.events[6], events[6])
  assert.equal(mergeHistoryPage(current, { ...page, end: 108, total: 108 }), null)
  assert.equal(hydrateHistoryWork(current, 'g', [{ start: 100, events: events.slice(2, 4) }]), false)
})
