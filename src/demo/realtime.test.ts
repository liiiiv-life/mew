import assert from 'node:assert/strict'
import test from 'node:test'
import { DemoWorkspaceStore } from './workspace-store.ts'
import { createDemoSocketFactory } from './socket.ts'
import { configureAppRuntime } from '../runtime/app-runtime.ts'
import { activeRemoteTransport, isRemoteMode, mewFetch, openMewSocket } from '../utils/remote-transport.ts'
import type { AgentEvent } from '../utils/agentFold.ts'

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'demo event arrived before its deadline')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('an incomplete feature frontmatter stays editable while its subscription reports the parse error', async t => {
  const store = new DemoWorkspaceStore(), factory = createDemoSocketFactory(store)
  t.after(() => { factory.close(); store.close() })
  const events: { type: string; value?: { features: { id: string }[] } }[] = []
  const socket = factory('wss://demo.test/api/live/ws')
  socket.onmessage = event => events.push(JSON.parse(String(event.data)))
  socket.onopen = () => socket.send(JSON.stringify({ type: 'subscribe', id: 'features', resource: { kind: 'features', workspace: store.workspacePath } }))
  await until(() => events.some(event => event.type === 'snapshot'))
  const file = 'docs/features/Git·변경 이력/현재 파일 커밋·이력 복원.md', original = store.readFile(file).content
  assert.doesNotThrow(() => store.writeFile(file, '---\ntitle: [unfinished\n---\n\nDraft'))
  assert.match(store.readFile(file).content, /unfinished/)
  assert.equal(events.at(-1)?.type, 'error')
  store.writeFile(file, original)
  assert.ok(events.at(-1)?.value?.features.some(feature => feature.id === 'mew-git-file-history'))
})

test('app runtime injection preserves the independent remote connection meaning', async t => {
  let fetches = 0, closed = 0
  const socket = { readyState: 1 } as WebSocket
  configureAppRuntime({ kind: 'demo', transport: { async fetch() { fetches++; return Response.json({ demo: true }) }, socket() { return socket }, close() { closed++ } } })
  t.after(() => configureAppRuntime({}))
  assert.deepEqual(await (await mewFetch('/api/workspace')).json(), { demo: true })
  assert.equal(openMewSocket('wss://demo.test/api/presence'), socket)
  assert.equal(fetches, 1)
  assert.equal(isRemoteMode(), false)
  assert.equal(activeRemoteTransport(), null)
  configureAppRuntime({})
  assert.equal(closed, 1)
})

test('agent edits, replay and live Git updates all read the same demo workspace', async t => {
  const store = new DemoWorkspaceStore(), socketFactory = createDemoSocketFactory(store)
  t.after(() => { socketFactory.close(); store.close() })
  const snapshots: { type: string; value?: { workingTree: { files: { path: string }[] } } }[] = []
  const live = socketFactory('wss://demo.test/api/live/ws')
  live.onmessage = event => snapshots.push(JSON.parse(String(event.data)))
  live.onopen = () => live.send(JSON.stringify({ type: 'subscribe', id: 'git', resource: { kind: 'git', project: '.workspace', path: '' } }))
  const events: { type: string; events?: unknown[]; meta?: { busy: boolean } }[] = []
  const url = 'wss://demo.test/api/agent/ws?runtime=codex&tab=one&cwd=/demo/mew-playground'
  const agent = socketFactory(url)
  agent.onmessage = event => events.push(JSON.parse(String(event.data)))
  await until(() => events.some(event => event.type === 'meta') && snapshots.length > 0)
  assert.equal(snapshots[0].value?.workingTree.files.length, 0, 'subscriptions sent from onopen are handled')
  agent.send(JSON.stringify({ type: 'prompt', text: '출시 계획을 정리해 줘' }))
  await until(() => events.some(event => event.type === 'turn_end'))
  assert.match(store.readFile('docs/welcome.md').content, /에이전트와 정리한 다음 단계/)
  assert.ok(snapshots.at(-1)?.value?.workingTree.files.some(file => file.path === 'docs/welcome.md'))
  assert.equal(events.filter(event => event.type === 'meta').at(-1)?.meta?.busy, false)
  agent.close()
  const replayed: { type: string; events?: { type: string }[] }[] = []
  const reconnected = socketFactory(url)
  reconnected.onmessage = event => replayed.push(JSON.parse(String(event.data)))
  await until(() => replayed.some(event => event.type === 'replay'))
  assert.ok(replayed.find(event => event.type === 'replay')?.events?.some(event => event.type === 'turn_end'))
})

test('terminal commands and database events stay inside the visitor workspace', async t => {
  const store = new DemoWorkspaceStore(), socketFactory = createDemoSocketFactory(store)
  t.after(() => { socketFactory.close(); store.close() })
  const output: string[] = []
  const terminal = socketFactory('wss://demo.test/api/tmux/ws?session=one')
  terminal.onmessage = event => output.push(String(event.data))
  await until(() => output.length > 0)
  terminal.send(JSON.stringify({ type: 'input', data: 'cat docs/welcome.md\r' }))
  assert.match(output.join(''), /Mew 데모에 오신 것을 환영합니다/)
  terminal.send(JSON.stringify({ type: 'input', data: 'rm -rf /\r' }))
  assert.match(output.join(''), /Demo shell:/)
  assert.ok(store.readFile('docs/welcome.md').content)
  const databaseEvents: unknown[] = []
  const database = socketFactory('wss://demo.test/api/db/ws')
  database.onmessage = event => databaseEvents.push(JSON.parse(String(event.data)))
  database.onopen = () => database.send(JSON.stringify({ type: 'subscribe', project: 'docs', dbId: 'one' }))
  await until(() => database.readyState === 1)
  const event = { project: 'docs', dbId: 'one', event: { type: 'row.delete', rowId: 'row-1' } }
  store.setState('db-event:docs:one', event)
  assert.deepEqual(databaseEvents, [{ type: 'db.event', ...event }])
  const unknown = socketFactory('wss://production.example/api/unsupported')
  await until(() => unknown.readyState === 3)
})

test('closing the runtime cancels pending agent work', async () => {
  const store = new DemoWorkspaceStore(), socketFactory = createDemoSocketFactory(store)
  const initial = store.readFile(store.demoFilePath).content
  const agent = socketFactory('wss://demo.test/api/agent/ws?tab=cancel')
  await until(() => agent.readyState === 1)
  agent.send(JSON.stringify({ type: 'prompt', text: '문서를 정리해 줘' }))
  socketFactory.close()
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(store.readFile(store.demoFilePath).content, initial)
  assert.equal(agent.readyState, 3)
  store.close()
})

test('agent scenario paths remain canonical after switching into a nested workspace', async t => {
  const store = new DemoWorkspaceStore(), socketFactory = createDemoSocketFactory(store)
  t.after(() => { socketFactory.close(); store.close() })
  store.openWorkspace(`${store.workspacePath}/docs`)
  const agent = socketFactory(`wss://demo.test/api/agent/ws?tab=nested&cwd=${store.workspaceInfo().path}`)
  const events: { type: string; update?: { sessionUpdate: string; content?: { text?: string } } }[] = []
  agent.onmessage = event => events.push(JSON.parse(String(event.data)))
  await until(() => events.some(event => event.type === 'meta'))
  for (const [prompt, path] of [['출시 계획을 정리해 줘', 'welcome.md'], ['문서를 정리해 줘', 'welcome.md']]) {
    const turnCount = events.filter(event => event.type === 'turn_end').length
    agent.send(JSON.stringify({ type: 'prompt', text: prompt }))
    await until(() => events.filter(event => event.type === 'turn_end').length > turnCount)
    assert.match(store.readFile(path).content, /에이전트와 정리한 다음 단계/)
    const response = events.filter(event => event.update?.sessionUpdate === 'agent_message_chunk').at(-1)?.update?.content?.text ?? ''
    assert.ok(response.includes(`](${store.workspacePath}/docs/${path})`), 'reply links use an unambiguous absolute sandbox path')
  }
  assert.deepEqual(store.gitWorkingTree().files.map(file => file.path).sort(), ['docs/welcome.md'])
  assert.throws(() => store.readFile('docs/welcome.md'), /찾을 수 없습니다/, 'scenarios never create docs/docs duplicates')
})

test('cancelling a turn drains queued prompts in FIFO order before newly submitted work', async t => {
  const store = new DemoWorkspaceStore(), socketFactory = createDemoSocketFactory(store)
  t.after(() => { socketFactory.close(); store.close() })
  const events: AgentEvent[] = []
  const agent = socketFactory('wss://demo.test/api/agent/ws?tab=fifo')
  agent.onmessage = event => events.push(JSON.parse(String(event.data)) as AgentEvent)
  await until(() => events.some(event => event.type === 'meta'))
  agent.send(JSON.stringify({ type: 'prompt', text: 'first' }))
  agent.send(JSON.stringify({ type: 'prompt', text: 'second' }))
  agent.send(JSON.stringify({ type: 'cancel' }))
  agent.send(JSON.stringify({ type: 'prompt', text: 'third' }))
  const users = () => events.flatMap(event => event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk' ? [event.update.content.text] : [])
  assert.deepEqual(users(), ['first', 'second'], 'cancel starts the queued second prompt immediately')
  await until(() => events.filter(event => event.type === 'turn_end').length === 3)
  assert.deepEqual(users(), ['first', 'second', 'third'])
  assert.equal(events.find(event => event.type === 'turn_end')?.stopReason, 'cancelled')
  const lastMeta = events.filter(event => event.type === 'meta').at(-1)
  assert.equal(lastMeta?.meta.busy, false)
  assert.deepEqual(lastMeta?.meta.queued, [])
})

test('closing a conversation closes every peer, preserves history and reconnects to a fresh session', async t => {
  const store = new DemoWorkspaceStore(), socketFactory = createDemoSocketFactory(store)
  t.after(() => { socketFactory.close(); store.close() })
  const initial = store.readFile(store.demoFilePath).content
  const events: AgentEvent[] = []
  const url = 'wss://demo.test/api/agent/ws?runtime=codex&tab=close'
  const first = socketFactory(url), peer = socketFactory(url)
  first.onmessage = event => events.push(JSON.parse(String(event.data)) as AgentEvent)
  await until(() => events.some(event => event.type === 'meta') && peer.readyState === 1)
  const oldId = events.find(event => event.type === 'meta')?.meta.sessionId
  assert.ok(oldId)
  first.send(JSON.stringify({ type: 'prompt', text: 'closed prompt' }))
  first.send(JSON.stringify({ type: 'prompt', text: 'queued prompt must not run' }))
  first.send(JSON.stringify({ type: 'close_session' }))
  assert.equal(first.readyState, 3)
  assert.equal(peer.readyState, 3)
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(store.readFile(store.demoFilePath).content, initial, 'closing never drains pending work')
  const reconnected = socketFactory(`${url}&resume=${oldId}`)
  const restored: AgentEvent[] = []
  reconnected.onmessage = event => restored.push(JSON.parse(String(event.data)) as AgentEvent)
  await until(() => restored.some(event => event.type === 'meta'))
  assert.notEqual(restored.find(event => event.type === 'meta')?.meta.sessionId, oldId)
  assert.deepEqual(restored.find(event => event.type === 'replay')?.events, [])
  reconnected.send(JSON.stringify({ type: 'list_sessions' }))
  assert.ok(restored.find(event => event.type === 'sessions')?.sessions.some(session => session.sessionId === oldId))
  reconnected.send(JSON.stringify({ type: 'load_session', sessionId: oldId }))
  assert.equal(restored.filter(event => event.type === 'meta').at(-1)?.meta.sessionId, oldId)
  const saved = restored.filter(event => event.type === 'replay').at(-1)?.events ?? []
  assert.ok(saved.some(event => event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk' && event.update.content.text === 'closed prompt'))
  assert.deepEqual(restored.filter(event => event.type === 'meta').at(-1)?.meta.queued, [])
})
