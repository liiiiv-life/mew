// 실제 계정/서버를 사용하지 않고 stdio ACP로 복원 준비와 인증 폴백을 검증한다.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-startup-'))
process.env.MEW_WORKSPACE = root
process.env.MEW_DATA_DIR = path.join(root, 'data')
const { AgentSession } = await import('./agentAcp.ts')
const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')
const stub = path.join(root, 'agent.mjs')
fs.writeFileSync(stub, `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from ${JSON.stringify(sdkUrl)};
import { Readable, Writable } from 'node:stream';
import fs from 'node:fs';
const [log, mode] = process.argv.slice(2);
const record = method => fs.appendFileSync(log, method + '\\n');
let authenticated = mode !== 'auth';
const modes = {currentModeId:'default',availableModes:[{id:'default',name:'Default'},{id:'full-access',name:'Full access'}]};
new AgentSideConnection(conn => ({
 initialize: async () => {
  record('initialize');
  return {protocolVersion: PROTOCOL_VERSION, agentCapabilities: {loadSession: mode !== 'unsupported' && mode !== 'auth'}, authMethods: [{id:'login',name:'Login'}]};
 },
 newSession: async () => {
  record('session/new');
  if (!authenticated) throw new RequestError(-32000, 'Authentication required');
  await new Promise(resolve => setTimeout(resolve, 200));
  return {sessionId:'new-session',modes};
 },
 loadSession: async ({sessionId}) => {
  record('session/load');
  await conn.sessionUpdate({sessionId, update: {sessionUpdate:'agent_message_chunk',content:{type:'text',text:'restored'}}});
  return {modes};
 },
 setSessionMode: async () => { record('session/set_mode'); return {}; },
 authenticate: async () => { authenticated = true; return {}; },
 cancel: async () => {},
 prompt: async () => ({stopReason:'end_turn'})
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
`)
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

test('복원 준비는 빈 세션 생성 대기 없이 initialize → load로 진행한다', async t => {
  const durations: number[] = []
  for (const deferSessionCreation of [false, true]) {
    const log = path.join(root, `calls-${deferSessionCreation}`)
    const started = performance.now()
    const session = await AgentSession.start('startup-fixture', { cmd: process.execPath, args: [stub, log, 'supported'] }, root,
      undefined, undefined, undefined, { deferSessionCreation })
    t.after(() => session.disposeAndWait())
    await session.loadSession('saved-session')
    durations.push(performance.now() - started)
    assert.equal(session.sessionId, 'saved-session')
    assert.match(JSON.stringify(session.snapshot()), /restored/)
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), deferSessionCreation
      ? ['initialize', 'session/load', 'session/set_mode']
      : ['initialize', 'session/new', 'session/set_mode', 'session/load', 'session/set_mode'])
    assert.ok(session.snapshot().some(event => event.type === 'modes' && event.modes.currentModeId === 'full-access'))
    await session.disposeAndWait()
  }
  // Wall time is diagnostic only; the contract above verifies the removed operation without flaky timing thresholds.
  t.diagnostic(`200ms session/new fixture: before=${Math.round(durations[0])}ms after=${Math.round(durations[1])}ms`)
})

test('load 미지원 런타임은 복원 요청이어도 새 세션을 준비한다', async t => {
  const log = path.join(root, 'unsupported-calls')
  const session = await AgentSession.start('startup-fixture', { cmd: process.execPath, args: [stub, log, 'unsupported'] }, root,
    undefined, undefined, undefined, { deferSessionCreation: true })
  t.after(() => session.disposeAndWait())
  assert.equal(session.canLoadSession, false)
  assert.equal(session.sessionId, 'new-session')
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['initialize', 'session/new', 'session/set_mode'])
})

test('load 미지원·로그아웃 상태는 인증 화면과 로그인 재시도를 유지한다', async t => {
  const log = path.join(root, 'auth-calls')
  const session = await AgentSession.start('startup-fixture', { cmd: process.execPath, args: [stub, log, 'auth'] }, root,
    undefined, undefined, undefined, { deferSessionCreation: true })
  t.after(() => session.disposeAndWait())
  const events: import('./agentAcp.ts').AgentEvent[] = []
  session.attach(event => events.push(event))
  assert.equal(events[0]?.type, 'auth')
  await session.authenticate('login')
  assert.equal(session.sessionId, 'new-session')
  assert.ok(events.some(event => event.type === 'auth_complete'))
})
