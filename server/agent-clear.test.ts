import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-clear-'))
process.env.MEW_WORKSPACE = root
process.env.MEW_DATA_DIR = path.join(root, 'data')
const { AgentSession } = await import('./agentAcp.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent
const sdk = import.meta.resolve('@agentclientprotocol/sdk')

async function fixture(t: test.TestContext) {
  const dir = fs.mkdtempSync(path.join(root, 'case-'))
  const log = path.join(dir, 'calls.jsonl')
  const stub = path.join(dir, 'stub.mjs')
  fs.writeFileSync(stub, `
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdk)}
const dir = ${JSON.stringify(dir)}
const log = (event) => fs.appendFileSync(dir + '/calls.jsonl', JSON.stringify({ pid: process.pid, ...event }) + '\\n')
const counter = dir + '/counter'
const boot = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1
fs.writeFileSync(counter, String(boot))
log({ type: 'boot', boot })
if (fs.existsSync(dir + '/crash')) process.exit(9)
class Agent {
  constructor(conn) { this.conn = conn }
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} } }
  async newSession() {
    if (fs.existsSync(dir + '/fail')) throw new Error('new session failed')
    log({ type: 'new', boot })
    return { sessionId: 'session-' + boot }
  }
  async cancel() {}
  async prompt({ sessionId, prompt }) {
    log({ type: 'prompt', sessionId, text: prompt[0].text })
    await new Promise(resolve => setTimeout(resolve, 60))
    await this.conn.sessionUpdate({ sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: sessionId + ':' + prompt[0].text }
    } })
    log({ type: 'done', sessionId })
    return { stopReason: 'end_turn' }
  }
}
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 120))
new AgentSideConnection(conn => new Agent(conn), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
`)
  const session = await AgentSession.start('codex', { cmd: process.execPath, args: [stub] }, dir)
  const events: AgentEvent[] = []
  session.attach(event => events.push(event))
  t.after(async () => { await session.disposeAndWait(); fs.rmSync(dir, { recursive: true, force: true }) })
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  return { session, events, calls, dir }
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 5_000
  while (!check()) {
    assert.ok(Date.now() < deadline, '조건 대기 시간 초과')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('Codex clear는 앞 턴과 writer 종료를 기다리고 뒤 큐를 새 대화에서 실행한다', { timeout: 10_000 }, async t => {
  const { session, events, calls } = await fixture(t)
  const oldPid = calls()[0].pid
  session.prompt('A')
  session.clearAfterQueue()
  session.prompt('B')
  session.clearAfterQueue()
  session.prompt('C')
  await until(() => session.sessionId === 'session-3' && !session.busy)
  assert.deepEqual(calls().filter(c => c.type === 'prompt').map(c => [c.sessionId, c.text]), [
    ['session-1', 'A'], ['session-2', 'B'], ['session-3', 'C'],
  ])
  assert.throws(() => process.kill(oldPid, 0), { code: 'ESRCH' })
  const ordered = calls().map(c => c.type)
  assert.deepEqual(ordered, ['boot', 'new', 'prompt', 'done', 'boot', 'new', 'prompt', 'done', 'boot', 'new', 'prompt', 'done'])
  assert.equal(events.filter(e => e.type === 'reset').length, 2)
  assert.ok(!events.some(e => e.type === 'error'))
})

for (const failure of ['fail', 'crash']) test(`Codex clear ${failure} 실패는 포인터와 뒤 메시지를 보존하고 재시도로 새 대화에서만 실행한다`, { timeout: 10_000 }, async t => {
  const { session, events, calls, dir } = await fixture(t)
  await session.runOnce('A')
  await until(() => !session.busy)
  fs.writeFileSync(path.join(dir, failure), '')
  session.clearAfterQueue()
  session.prompt('B')
  await until(() => !session.busy && events.some(e => e.type === 'error'))
  assert.equal(session.disposed, false)
  assert.equal(session.sessionId, 'session-1')
  assert.ok(!events.some(e => e.type === 'reset'))
  assert.equal(calls().filter(c => c.type === 'prompt').length, 1)
  session.prompt('C')
  fs.rmSync(path.join(dir, failure))
  session.clearAfterQueue()
  await until(() => calls().filter(c => c.type === 'done').length === 3 && !session.busy)
  assert.deepEqual(calls().filter(c => c.type === 'prompt').map(c => [c.sessionId, c.text]), [
    ['session-1', 'A'], ['session-3', 'B'], ['session-3', 'C'],
  ])
})

test('Codex clear 도중 탭을 닫으면 새 프로세스를 만들지 않는다', { timeout: 10_000 }, async t => {
  const { session, calls } = await fixture(t)
  session.clearAfterQueue()
  await session.disposeAndWait()
  await until(() => !session.busy)
  assert.equal(calls().filter(c => c.type === 'boot').length, 1)
})

async function commandFixture(t: test.TestContext) {
  const base = await fixture(t)
  const { createTmuxManager } = await import('@mew/tmux-term/server')
  const { AgentCommandStore } = await import('./agent-commands.ts')
  const { queueAgentCommand } = await import('./agent-command-queue.ts')
  const manager = createTmuxManager({ cwd: base.dir })
  const launches: string[] = []
  manager.startCommand = async name => { launches.push(name) }
  manager.list = async () => []
  const store = new AgentCommandStore(manager, path.join(base.dir, 'commands'))
  const owner = 'queue@example.test'
  const submit = (command: string, authorize = () => true) => {
    const input = { id: crypto.randomUUID(), tab: 'test', runtime: 'codex', cwd: base.dir, sessionId: base.session.sessionId, command, afterUserCount: 0 }
    const record = queueAgentCommand(base.session, store, owner, input, authorize)
    return { record, input }
  }
  const finish = (id: string) => {
    const record = store.read(owner, id)
    fs.writeFileSync(path.join(store.directory(owner, id), 'record.json'), JSON.stringify({ ...record, state: 'completed', finishedAt: Date.now(), archived: true }))
  }
  return { ...base, launches, store, owner, submit, finish, queueAgentCommand }
}

test('AI → CLI → AI → CLI shares FIFO; queued commands create no tmux and retries do not duplicate', async t => {
  const { session, calls, launches, store, owner, submit, finish, queueAgentCommand } = await commandFixture(t)
  session.prompt('A')
  const b = submit('printf B')
  session.prompt('C')
  const d = submit('printf D')
  queueAgentCommand(session, store, owner, b.input, () => true)
  assert.equal(b.record.state, 'queued')
  assert.equal(launches.length, 0)
  await until(() => launches.length === 1)
  assert.deepEqual(calls().filter(c => c.type === 'prompt').map(c => c.text), ['A'])
  assert.equal(store.read(owner, b.record.id).afterUserCount, 1)
  finish(b.record.id)
  await until(() => launches.length === 2)
  assert.deepEqual(calls().filter(c => c.type === 'prompt').map(c => c.text), ['A', 'C'])
  assert.equal(store.read(owner, d.record.id).afterUserCount, 2)
  finish(d.record.id)
  await until(() => !session.busy)
})

test('CLI queue supports reorder and cancel without executing cancelled commands', async t => {
  const { session, events, launches, store, owner, submit, finish } = await commandFixture(t)
  session.prompt('A')
  const b = submit('B'), c = submit('C')
  session.moveQueued(1, 0)
  const meta = events.filter(e => e.type === 'meta').at(-1)
  assert.ok(meta?.type === 'meta')
  assert.deepEqual(meta.meta.queued, ['C', 'B'])
  assert.deepEqual(meta.meta.queuedKinds, ['cli', 'cli'])
  session.unqueue(1)
  assert.equal(store.read(owner, b.record.id).state, 'interrupted')
  await until(() => launches.length === 1)
  assert.equal(launches[0], c.record.session)
  finish(c.record.id)
  await until(() => !session.busy)
  assert.equal(launches.length, 1)
})

test('cancel during CLI stops active command and clears both AI and CLI waiting items', async t => {
  const { session, calls, launches, store, owner, submit, finish } = await commandFixture(t)
  const a = submit('A')
  await until(() => launches.length === 1)
  session.prompt('B')
  const c = submit('C')
  session.cancel()
  assert.ok(fs.existsSync(path.join(store.directory(owner, a.record.id), 'stop')))
  assert.equal(store.read(owner, c.record.id).state, 'interrupted')
  finish(a.record.id)
  await until(() => !session.busy)
  assert.equal(launches.length, 1)
  assert.equal(calls().filter(c => c.type === 'prompt').length, 0)
})

test('CLI after clear runs in the new conversation and rechecks execution permission', async t => {
  const { session, launches, store, owner, submit, finish } = await commandFixture(t)
  session.prompt('A')
  session.clearAfterQueue()
  const b = submit('B')
  const denied = submit('denied', () => false)
  await until(() => launches.length === 1)
  assert.equal(store.read(owner, b.record.id).sessionId, 'session-2')
  assert.equal(store.read(owner, b.record.id).afterUserCount, 0)
  finish(b.record.id)
  await until(() => !session.busy)
  assert.equal(launches.length, 1)
  assert.equal(store.read(owner, denied.record.id).state, 'failed')
})

test.after(() => fs.rmSync(root, { recursive: true, force: true }))
