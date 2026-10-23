import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { FeatureStore } from './features.ts'
import { FeatureService } from './feature-service.ts'
import type { AgentHostCallbacks, AgentHostCommand } from './agentHost.ts'
import type { FeatureRun } from '../shared/features.ts'
const set = { id: crypto.randomUUID(), name: 'Any preset', runtime: 'codex', modelId: 'model', role: 'Build' }
const input = () => ({ id: crypto.randomUUID(), title: 'Feature', content: 'Build this', agentSetId: set.id })
const ready = (cb: AgentHostCallbacks) => {
  cb.onEvent?.({ type: 'meta', meta: { sessionId: 'ready', startedAt: '', turns: 0, busy: false, queued: [], usage: null, canLoad: true, canList: false } })
  cb.onEvent?.({ type: 'models', models: { currentModelId: set.modelId, availableModels: [{ modelId: set.modelId, name: 'Model' }] } })
}
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }; assert.ok(check()) }
test('request queue hands off once, waits for valid completion, recovers without respawning and cancels safely', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-service-')), workspace = path.join(root, 'project')
  fs.mkdirSync(workspace); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = new FeatureStore(path.join(root, 'state')), sent: AgentHostCommand[] = []
  let callbacks: AgentHostCallbacks = {}, starts = 0, recoveries = 0
  const connection = { send: (command: AgentHostCommand) => { sent.push(command) }, close: () => {} }
  const context = { projectRoot: workspace, docsRoot: path.join(workspace, 'custom-docs') }
  const connect = async (_runtime: string, _tab: string, _cwd: string, cb: AgentHostCallbacks, binding?: FeatureRun['context']) => { starts++; callbacks = cb; ready(cb); if (starts === 1) assert.deepEqual(binding, context); return connection }
  const reconnect = async (_runtime: string, _tab: string, _cwd: string, cb: AgentHostCallbacks) => { recoveries++; callbacks = cb; return connection }
  const executor = new FeatureService(store, connect, reconnect, () => true)
  const first = await store.request(workspace, 'owner', input(), set, context), second = await store.request(workspace, 'owner', input(), set)
  await Promise.all([executor.pump(workspace), executor.pump(workspace)])
  assert.equal(starts, 1); assert.equal(sent.filter(command => command.type === 'prompt').length, 1)
  assert.equal(store.read(workspace).runs[1].state, 'queued')
  const feature = await store.assign(workspace, first.id, { action: 'new', title: 'Feature', content: 'Build', reason: 'New' })
  await store.report(workspace, first.id, { summary: 'Done', files: [], commits: [] })
  callbacks.onEvent?.({ type: 'turn_end', stopReason: 'end_turn', durationMs: 100 })
  await until(() => store.read(workspace).runs[0].state === 'completed')
  assert.equal(store.read(workspace).features[0].status, 'implemented')
  await executor.pump(workspace); assert.equal(starts, 2)
  executor.stop()
  const recovered = new FeatureService(store, connect, reconnect, () => true)
  await recovered.pump(workspace)
  assert.equal(recoveries, 1); assert.equal(starts, 2)
  await recovered.cancel(workspace, second.id)
  assert.equal(store.read(workspace).runs[1].state, 'cancelling')
  const third = await store.request(workspace, 'owner', input(), set)
  await recovered.pump(workspace); assert.equal(starts, 2, 'cancellation must finish before the next job')
  callbacks.onEvent?.({ type: 'turn_end', stopReason: 'cancelled', durationMs: 120 })
  await until(() => store.read(workspace).runs[1].state === 'cancelled')
  assert.equal(store.read(workspace).features[0].id, feature.id)
  await recovered.pump(workspace); assert.equal(starts, 3)
  callbacks.onEvent?.({ type: 'turn_end', stopReason: 'end_turn', durationMs: 1 })
  await until(() => store.read(workspace).runs.find(run => run.id === third.id)?.state === 'failed')
  recovered.stop()
})
test('cancel during host startup never dispatches the prompt or starts the next request early', async t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-cancel-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  const store = new FeatureStore(path.join(workspace, 'state')), sent: AgentHostCommand[] = []
  let callbacks: AgentHostCallbacks = {}, release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const connect = async (_runtime: string, _tab: string, _cwd: string, cb: AgentHostCallbacks) => { callbacks = cb; await waiting; return { send: (command: AgentHostCommand) => { sent.push(command) }, close() {} } }
  const executor = new FeatureService(store, connect, connect, () => true)
  t.after(() => executor.stop())
  const run = await store.request(workspace, 'owner', input(), set)
  await store.request(workspace, 'owner', input(), set)
  const starting = executor.pump(workspace)
  await until(() => store.read(workspace).runs[0].state === 'starting')
  await executor.cancel(workspace, run.id)
  release(); await starting
  assert.equal(sent.length, 0)
  assert.equal(store.read(workspace).runs[0].state, 'cancelled')
  assert.equal(store.read(workspace).runs[1].state, 'queued')
  assert.equal(typeof callbacks.onEvent, 'function')
})
test('cancel immediately after restart waits for recovered host confirmation', async t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-recover-cancel-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  const store = new FeatureStore(path.join(workspace, 'state')), sent: AgentHostCommand[] = []
  const run = await store.request(workspace, 'owner', input(), set)
  await store.claim(workspace)
  await store.updateRun(workspace, run.id, { dispatchedAt: new Date().toISOString() })
  let callbacks: AgentHostCallbacks = {}
  const executor = new FeatureService(store, async () => { assert.fail('must not spawn') }, async (_runtime, _tab, _cwd, cb) => {
    callbacks = cb; return { send: command => { sent.push(command) }, close() {} }
  }, () => true)
  t.after(() => executor.stop())
  await executor.cancel(workspace, run.id)
  assert.equal(store.read(workspace).runs[0].state, 'cancelling')
  assert.deepEqual(sent, [{ type: 'cancel' }])
  callbacks.onEvent?.({ type: 'turn_end', stopReason: 'cancelled', durationMs: 0 })
  await until(() => store.read(workspace).runs[0].state === 'cancelled')
})
test('revoked permissions prevent queued execution and terminal replay never resends', async t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-access-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  const store = new FeatureStore(path.join(workspace, 'state'))
  const never = async () => { assert.fail('must not spawn') }
  await store.request(workspace, 'owner', input(), set)
  const denied = new FeatureService(store, never, never, () => false)
  await denied.pump(workspace); denied.stop()
  assert.equal(store.read(workspace).runs[0].state, 'failed')
  const run = await store.request(workspace, 'owner', input(), set)
  await store.claim(workspace)
  await store.assign(workspace, run.id, { action: 'new', title: 'Done', content: '', reason: 'New' })
  await store.report(workspace, run.id, { summary: 'Done', files: [], commits: [] })
  const recovered = new FeatureService(store, never, async (_runtime, _tab, _cwd, cb) => {
    cb.onReplay?.([{ type: 'turn_end', stopReason: 'end_turn', durationMs: 1 }], false, null)
    return { send() { assert.fail('must not resend') }, close() {} }
  }, () => true)
  await recovered.pump(workspace); recovered.stop()
  assert.equal(store.read(workspace).runs[1].state, 'completed')
})
test('recovery failures never spawn or resend an uncertain request', async t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-recovery-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  const store = new FeatureStore(path.join(workspace, 'state'))
  await store.request(workspace, 'owner', input(), set); await store.claim(workspace)
  const never = async () => { assert.fail('must not spawn') }
  const executor = new FeatureService(store, never, async () => { throw new Error('No host') }, () => true)
  await executor.pump(workspace)
  assert.equal(store.read(workspace).runs[0].state, 'failed')
  executor.stop()
})
test('authentication and model changes finish before the feature prompt is dispatched once', async t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-ready-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  const store = new FeatureStore(path.join(workspace, 'state')), sent: AgentHostCommand[] = []
  let callbacks: AgentHostCallbacks = {}
  const executor = new FeatureService(store, async (_runtime, _tab, _cwd, cb) => {
    callbacks = cb
    cb.onEvent?.({ type: 'auth', methods: [], authenticating: false, error: null })
    return { send: command => { sent.push(command) }, close() {} }
  }, async () => { assert.fail('must not recover') }, () => true)
  t.after(() => executor.stop())
  const run = await store.request(workspace, 'owner', input(), set)
  await executor.pump(workspace)
  assert.equal(store.read(workspace).runs[0].state, 'blocked')
  assert.equal(sent.length, 0)
  callbacks.onEvent?.({ type: 'auth_complete' })
  callbacks.onEvent?.({ type: 'meta', meta: { sessionId: 'ready', startedAt: '', turns: 0, busy: false, queued: [], usage: null, canLoad: true, canList: false } })
  await until(() => sent.some(command => command.type === 'set_model'))
  assert.equal(sent.some(command => command.type === 'prompt'), false)
  callbacks.onEvent?.({ type: 'models', models: { currentModelId: set.modelId, availableModels: [{ modelId: set.modelId, name: 'Selected' }] } })
  await until(() => sent.some(command => command.type === 'prompt'))
  ready(callbacks); await executor.pump(workspace)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(sent.filter(command => command.type === 'prompt').length, 1)
  assert.equal(await store.beginDispatch(workspace, run.id), false)
})
