import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { killMemoryScope, memoryPressure, memoryScopeCommand, parseHostMemory, type MemoryBudget } from './agent-memory.ts'

const GIB = 1024 ** 3
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-memory-test-'))
process.env.MEW_WORKSPACE = root
process.env.MEW_DATA_DIR = path.join(root, 'data')
const { AgentSession } = await import('./agentAcp.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent
const sdk = import.meta.resolve('@agentclientprotocol/sdk')

test('Linux uses reclaimable MemAvailable, not near-empty MemFree', () => {
  const sample = parseHostMemory('MemTotal:       8388608 kB\nMemFree:         10000 kB\nMemAvailable:   4194304 kB\n')
  assert.equal(sample?.available, 4 * GIB)
  assert.equal(memoryPressure([sample!]), null)
  assert.equal(parseHostMemory('MemTotal: 8388608 kB\n'), null)
})

test('host and shared agent budget enforce separate limits with resume hysteresis', () => {
  const host = { source: 'host', total: 8 * GIB, available: 0.7 * GIB }
  assert.match(memoryPressure([host])!, /host/)
  host.available = 1.2 * GIB
  assert.equal(memoryPressure([host]), null)
  assert.match(memoryPressure([host], true)!, /host/)
  host.available = 4 * GIB
  assert.match(memoryPressure([host, { source: 'slice', total: 5 * GIB, available: 0.3 * GIB }])!, /slice/)
})

async function until(check: () => boolean) {
  const deadline = Date.now() + 5_000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for agent')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function fixture(t: test.TestContext) {
  const dir = fs.mkdtempSync(path.join(root, 'case-'))
  const stub = path.join(dir, 'stub.mjs')
  fs.writeFileSync(stub, `
import {Readable,Writable} from 'node:stream';
import {AgentSideConnection,ndJsonStream,PROTOCOL_VERSION} from ${JSON.stringify(sdk)};
let release;
new AgentSideConnection(conn=>({
 initialize:async()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{}}),
 newSession:async()=>({sessionId:'memory-session'}),
 cancel:async()=>{release?.();},
 prompt:async({sessionId,prompt})=>{
  if(prompt[0].text==='hold') await new Promise(r=>{release=r});
  await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:prompt[0].text}}});
  return {stopReason:'end_turn'};
 }
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
`)
  const budget: MemoryBudget = { source: 'fixture', total: 8 * GIB, available: 4 * GIB }
  const session = await AgentSession.start('codex', { cmd: process.execPath, args: [stub] }, dir, 30_000, undefined, () => [budget])
  const events: AgentEvent[] = []
  session.attach(event => events.push(event))
  const meta = () => {
    const event = events.findLast(event => event.type === 'meta')
    assert.equal(event?.type, 'meta')
    return event!.type === 'meta' ? event.meta : assert.fail()
  }
  t.after(() => session.disposeAndWait())
  return { session, budget, events, meta }
}

test('pressure cancels active AI once, retains queue, persists error and requires explicit recovery', { timeout: 10_000 }, async t => {
  const { session, budget, events, meta } = await fixture(t)
  session.prompt('hold')
  session.prompt('queued')
  // Allow the fixture to receive the prompt before delivering cancellation.
  await new Promise(resolve => setTimeout(resolve, 80))
  budget.available = 0.3 * GIB
  session.checkMemory()
  session.checkMemory()
  await until(() => !session.busy)
  assert.equal(events.filter(e => e.type === 'error').length, 1)
  assert.equal(meta().memoryPaused, true)
  assert.deepEqual(meta().queued, ['queued'])
  assert.ok(session.snapshot().some(e => e.type === 'error' && /메모리 부족/.test(e.message)))
  assert.throws(() => session.prompt('rejected'), /메모리/)
  budget.available = 1.2 * GIB
  assert.throws(() => session.prompt('still rejected'), /메모리/)
  budget.available = 4 * GIB
  session.checkMemory()
  session.beginQueuedEdit(0, 'queued')
  session.cancelQueuedEdit(0, 'queued')
  assert.deepEqual(meta().queued, ['queued'])
  assert.equal(meta().memoryPaused, true)
  session.prompt('scheduled', 'scheduled', [], [], undefined, true)
  assert.deepEqual(meta().queued, ['queued', 'scheduled'])
  await assert.rejects(session.runOnce('background'), /메모리 보호/)
  session.prompt('resume')
  await until(() => !session.busy && meta().queued.length === 0)
  assert.equal(meta().memoryPaused, false)
  const sent = events.flatMap(e => e.type === 'update' && e.update.sessionUpdate === 'user_message_chunk' && e.update.content.type === 'text' ? [e.update.content.text] : [])
  assert.deepEqual(sent, ['hold', 'queued', 'scheduled', 'resume'])
})

test('pressure cancels running CLI, preserves waiting CLI and guards queue drain', async t => {
  const { session, budget, meta } = await fixture(t)
  let finish: (() => void) | undefined
  let cancels = 0, queuedRuns = 0, queuedCancels = 0
  session.enqueueTask({ id: 'active', text: 'active', run: () => new Promise<void>(r => { finish = r }), cancel: () => { cancels++; finish?.() } })
  session.enqueueTask({ id: 'waiting', text: 'waiting', run: async () => { queuedRuns++ }, cancel: () => { queuedCancels++ } })
  await until(() => !!finish)
  budget.available = 0
  session.checkMemory()
  await until(() => !session.busy)
  assert.equal(cancels, 1)
  assert.equal(queuedRuns, 0)
  assert.equal(queuedCancels, 0)
  assert.deepEqual(meta().queued, ['waiting'])
  budget.available = 4 * GIB
  session.prompt('resume')
  await until(() => !session.busy && meta().queued.length === 0)
  assert.equal(queuedRuns, 1)
})

test('low memory refuses initial agent spawn', async () => {
  await assert.rejects(AgentSession.start('codex', { cmd: '/must-not-spawn', args: [] }, root, 30_000, undefined,
    () => [{ source: 'fixture', total: 8 * GIB, available: 0 }]), /메모리 부족/)
})

test('required scope fails closed without systemd, while off explicitly selects direct execution', () => {
  const moduleUrl = new URL('./agent-memory.ts', import.meta.url).href
  for (const mode of ['required', 'off']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {memoryScopeCommand} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(memoryScopeCommand('/must-not-run', [])))`], {
      env: { ...process.env, PATH: root, MEW_AGENT_MEMORY_SCOPE: mode }, encoding: 'utf8', timeout: 5_000,
    })
    if (mode === 'required') {
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /OS 메모리 제한/)
    } else {
      assert.equal(result.status, 0)
      assert.deepEqual(JSON.parse(result.stdout), { cmd: '/must-not-run', args: [], scoped: false })
    }
  }
})

test('scope cleanup reaches detached grandchildren without signalling the shared slice', {
  skip: process.env.MEW_TEST_MEMORY_SCOPE !== '1' || process.platform !== 'linux', timeout: 10_000,
}, async t => {
  const command = memoryScopeCommand(process.execPath, ['-e',
    'const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});c.unref();console.log(c.pid)'])
  assert.equal(command.scoped, true)
  t.after(() => killMemoryScope(command.unit, 'SIGKILL'))
  const pid = Number(execFileSync(command.cmd, command.args, { encoding: 'utf8', timeout: 5_000 }).trim())
  assert.ok(pid > 0)
  assert.match(fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8'), new RegExp(command.unit!.replaceAll('.', '\\.')))
  killMemoryScope(command.unit, 'SIGKILL')
  await until(() => {
    try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].startsWith('Z') }
    catch { return true }
  })
})

test('configured scope inherits limits, preserves literal arguments, and contains a bounded OOM', {
  skip: process.env.MEW_TEST_MEMORY_SCOPE !== '1' || process.platform !== 'linux', timeout: 10_000,
}, () => {
  const command = memoryScopeCommand(process.execPath, ['-e', 'console.log(require("fs").readFileSync("/proc/self/cgroup","utf8")); console.log(process.argv[1])', '$HOME; literal'])
  assert.equal(command.scoped, true)
  const output = execFileSync(command.cmd, command.args, { encoding: 'utf8', timeout: 5_000 })
  assert.match(output, /mew-agents\.slice\/mew-agent-.*\.scope/)
  assert.match(output, /\$HOME; literal/)
  const limited = memoryScopeCommand(process.execPath, ['-e', 'const keep=[]; for(let i=0;i<16;i++) keep.push(Buffer.alloc(16*1024*1024,1));'])
  limited.args.splice(limited.args.indexOf('--'), 0, '--property=MemoryMax=64M', '--property=MemorySwapMax=0')
  const result = spawnSync(limited.cmd, limited.args, { encoding: 'utf8', timeout: 5_000 })
  assert.equal(result.error, undefined)
  assert.ok(result.signal === 'SIGKILL' || result.status === 137, JSON.stringify(result))
})

test.after(() => fs.rmSync(root, { recursive: true, force: true }))
