import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentNoticeTracker, createResourceNoticeTracker, type ResourceSample } from './mewcat-notification-rules.ts'
import { clearMewcatNotices, dismissMewcatNotice, onMewcatNotice, parseNotificationPreferences, publishMewcatNotice } from './mewcat-notifications.ts'
import type { AgentEvent } from './agentFold.ts'

const target = { tabId: 'tab-1', cwd: '/workspace' }
const idle: AgentEvent = { type: 'meta', meta: { sessionId: 'one', startedAt: '', turns: 1, busy: false, queued: [], usage: null, canLoad: true, canList: true } }
const end: AgentEvent = { type: 'turn_end', stopReason: 'end_turn' }
const healthy: ResourceSample = { cpu: { usage: 10, temperature: 40 }, memory: { total: 100, available: 60 }, gpus: [] }

test('agent completion waits for an empty queue, ignores replay and cancelled turns', () => {
  const track = createAgentNoticeTracker('Codex', target)
  assert.equal(track({ type: 'replay', events: [end] }), null)
  assert.equal(track(idle), null)
  track({ type: 'turn_start' })
  assert.equal(track(end), null)
  assert.equal(track({ ...idle, meta: { ...idle.meta, queued: ['next'] } }), null)
  track({ type: 'turn_start' })
  track(end)
  assert.equal(track({ ...idle, meta: { ...idle.meta, activeTask: 'cli' } }), null)
  assert.equal(track(idle)?.kind, 'complete')
  assert.equal(track(idle), null)
  track({ type: 'turn_start' })
  track({ type: 'turn_end', stopReason: 'cancelled' })
  assert.equal(track(idle), null)
  track({ type: 'turn_start' })
  assert.equal(track({ type: 'turn_end', stopReason: 'max_tokens' })?.kind, 'stopped')
  assert.equal(track(idle), null)
})

test('completion while watching is consumed without a notice; other events still notify', () => {
  const track = createAgentNoticeTracker('Codex', target)
  track({ type: 'turn_start' })
  track(end, false)
  assert.equal(track(idle, true), null)
  // Leaving the tab later must not announce work already seen.
  assert.equal(track(idle, false), null)
  track({ type: 'turn_start' })
  track(end, true)
  assert.equal(track(idle, false)?.kind, 'complete')
  track({ type: 'turn_start' })
  assert.equal(track({ type: 'error', message: 'failure' }, true)?.kind, 'error')
  assert.equal(track({ type: 'permission', id: 'p', toolCall: { title: 'approval' }, options: [] }, true)?.kind, 'permission')
  track({ type: 'turn_start' })
  assert.equal(track({ type: 'turn_end', stopReason: 'max_tokens' }, true)?.kind, 'stopped')
})

test('an error followed by failed turn emits once and never emits success', () => {
  const track = createAgentNoticeTracker('Codex', target)
  track({ type: 'turn_start' })
  const error = track({ type: 'error', message: 'SECRET raw error' })
  assert.equal(error?.kind, 'error')
  assert.ok(!JSON.stringify(error).includes('SECRET'))
  assert.equal(track({ type: 'turn_end', stopReason: 'error' }), null)
  assert.equal(track(idle), null)
  track({ type: 'turn_start' })
  assert.equal(track({ type: 'turn_end', stopReason: 'error' })?.kind, 'error')
  assert.equal(track({ type: 'permission', id: 'p', toolCall: { title: 'sensitive command' }, options: [] })?.kind, 'permission')
})

test('resource warnings require sustained load and recovery before another alert', () => {
  const track = createResourceNoticeTracker()
  const high = { ...healthy, cpu: { usage: 92, temperature: null }, memory: { total: 100, available: 8 } }
  assert.deepEqual(track(high), [])
  assert.deepEqual(track(high), [])
  assert.deepEqual(track(high).map(notice => notice.kind), ['cpu', 'memory'])
  for (let i = 0; i < 20; i++) assert.deepEqual(track(high), [])
  track({ ...high, cpu: { usage: 85, temperature: null } })
  assert.deepEqual(track(high), [])
  track(healthy)
  track(high)
  track(high)
  assert.deepEqual(track(high).map(notice => notice.kind), ['cpu', 'memory'])
})

test('missing samples break consecutive load, unknown GPU data does not raise false alerts', () => {
  const track = createResourceNoticeTracker()
  const high = { ...healthy, memory: { total: 100, available: 5 } }
  track(high)
  track(high)
  track(null)
  assert.deepEqual(track(high), [])
  const unknown = { ...healthy, cpu: { usage: null, temperature: null }, memory: { total: 0, available: 0 }, gpus: [{ memoryUsedMb: null, memoryTotalMb: null, temperature: null }] }
  for (let i = 0; i < 4; i++) assert.deepEqual(track(unknown), [])
  const gpu = { ...healthy, gpus: [{ memoryUsedMb: 98, memoryTotalMb: 100, temperature: 95 }] }
  track(gpu)
  track(gpu)
  assert.deepEqual(track(gpu).map(notice => notice.kind), ['gpu', 'temperature'])
})

test('preferences tolerate unavailable, corrupt and partial browser storage', () => {
  const defaults = { visual: true, mewcat: true, desktop: false, sound: false, resources: true }
  assert.deepEqual(parseNotificationPreferences(null), defaults)
  assert.deepEqual(parseNotificationPreferences('broken'), defaults)
  assert.deepEqual(parseNotificationPreferences('{"visual":true,"mewcat":false,"sound":true}'), { ...defaults, mewcat: false, sound: true })
  assert.deepEqual(parseNotificationPreferences('null'), defaults)
  assert.deepEqual(parseNotificationPreferences('{"sound":true,"desktop":"yes","visual":false}'), { ...defaults, sound: true, visual: false })
})

test('duplicate delivery is suppressed and subscribers detach cleanly', () => {
  clearMewcatNotices()
  const received: number[] = []
  const stop = onMewcatNotice(notice => received.push(notice.id))
  const input = { key: 'test', kind: 'error', level: 'danger', source: 'Codex' } as const
  publishMewcatNotice(input)
  publishMewcatNotice(input)
  assert.equal(received.length, 1)
  dismissMewcatNotice(received[0])
  publishMewcatNotice(input)
  assert.equal(received.length, 1)
  stop()
  publishMewcatNotice({ ...input, key: 'different' })
  assert.equal(received.length, 1)
  clearMewcatNotices()
})
