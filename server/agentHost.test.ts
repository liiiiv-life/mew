// 에이전트 감독 프로세스 계약 — mew/프론트 소켓이 사라져도 독립 프로세스가 턴을 마치고 재접속에 재생한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-ws-'))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-data-'))
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-stub-'))
const stubPath = path.join(stubDir, 'stub.mjs')
const finishedFile = path.join(stubDir, 'finished')
const writerLockFile = path.join(stubDir, 'writer-lock')
const authRequiredFile = path.join(stubDir, 'auth-required')
const recoveryFailureFile = path.join(stubDir, 'recovery-failure')
const callsFile = path.join(stubDir, 'calls.jsonl')
process.env.MEW_WORKSPACE = workspace
process.env.MEW_DATA_DIR = dataDir

const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')
fs.writeFileSync(
  stubPath,
  `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from ${JSON.stringify(sdkUrl)}
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'

class SlowAgent {
  constructor(conn) { this.conn = conn; this.sessionCount = 0; this.authenticated = !fs.existsSync(${JSON.stringify(authRequiredFile)}) }
  record(method) { fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({pid:process.pid,method}) + '\\n') }
  async initialize() { this.record('initialize'); return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true }, authMethods: [{id:'login',name:'Login'}] } }
  async newSession() {
    this.record('session/new')
    if (!this.authenticated) throw new RequestError(-32000, 'Authentication required')
    this.sessionCount += 1
    if (this.sessionCount === 1) {
      let holderAlive = false
      try { process.kill(Number(fs.readFileSync(process.argv[3], 'utf8')), 0); holderAlive = true } catch {}
      if (!holderAlive) fs.writeFileSync(process.argv[3], String(process.pid))
    }
    return { sessionId: this.sessionCount === 1 ? 'host-session' : 'cleared-session' }
  }
  async loadSession({ sessionId }) {
    this.record('session/load')
    if (!this.authenticated) throw new RequestError(-32000, 'Authentication required')
    if (sessionId === 'unrecoverable') fs.writeFileSync(${JSON.stringify(recoveryFailureFile)}, '')
    if (fs.existsSync(${JSON.stringify(recoveryFailureFile)})) throw new RequestError(-32603, 'history unavailable')
    if (sessionId === 'saved-session' && this.sessionCount !== 0) {
      throw new Error('복원 전에 빈 세션을 생성하면 안 된다')
    }
    if (sessionId === 'partial-load') {
      fs.writeFileSync(process.argv[3], String(process.pid))
      throw new RequestError(-32603, 'Internal error', { details: 'history replay failed after acquiring writer' })
    }
    if (sessionId === 'busy-thread') {
      throw { code: -32603, message: 'Internal error', data: { details: 'thread busy-thread already has an active writer' } }
    }
    if (sessionId === 'host-session' && this.sessionCount > 1) {
      throw { code: -32603, message: 'Internal error', data: { details: 'thread host-session already has an active writer' } }
    }
    if (sessionId === 'host-session') {
      let holder = 0
      try { holder = Number(fs.readFileSync(process.argv[3], 'utf8')) } catch {}
      let holderAlive = false
      try { if (holder > 0) { process.kill(holder, 0); holderAlive = true } } catch {}
      if (holderAlive && holder !== process.pid) {
        throw { code: -32603, message: 'Internal error', data: { details: 'thread host-session already has an active writer' } }
      }
      fs.writeFileSync(process.argv[3], String(process.pid))
    }
    await this.conn.sessionUpdate({ sessionId, update: {
      sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '이전 질문' },
    } })
    await this.conn.sessionUpdate({ sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '이전 답변 복원' },
    } })
    return {}
  }
  async authenticate() { this.authenticated = true; return {} }
  async cancel() {}
  async prompt({ sessionId }) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    fs.writeFileSync(process.argv[2], 'done')
    await this.conn.sessionUpdate({ sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '독립 완료' },
    } })
    return { stopReason: 'end_turn' }
  }
}

process.on('SIGTERM', () => setTimeout(() => process.exit(0), 150))

new AgentSideConnection(
  (conn) => new SlowAgent(conn),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`,
)
process.env.MEW_AGENT_CMD = process.execPath
process.env.MEW_AGENT_ARGS = `${stubPath} ${finishedFile} ${writerLockFile}`
process.env.MEW_AGENT_CODEX_CMD = process.execPath
process.env.MEW_AGENT_CODEX_ARGS = `${stubPath} ${finishedFile} ${writerLockFile}`

const { connectAgentHost, describeError, shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')
const { saveAgentTabs } = await import('./agent-tab-state.ts')
const { writeAgentTabs, readAgentTabs } = await import('./userUiState.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent

test('연결되지 않은 탭을 원장에서 삭제하면 이전 runtime/cwd 감독도 종료한다', { timeout: 10_000 }, async t => {
  const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-removed-tab-'))
  t.after(async () => {
    shutdownAgentHostsForWorkspace(workspace)
    shutdownAgentHostsForWorkspace(otherCwd)
    await new Promise(resolve => setTimeout(resolve, 200))
    fs.rmSync(otherCwd, { recursive: true, force: true })
  })
  const start = async (tab: string, cwd: string) => {
    let ready!: () => void
    const started = new Promise<void>(resolve => { ready = resolve })
    const client = await connectAgentHost('codex', tab, cwd, { onEvent: event => { if (event.type === 'meta') ready() } })
    await started
    client.close()
  }
  await start('removed-tab', workspace)
  await start('removed-tab', otherCwd)
  await start('retained-tab', workspace)
  const hosts = () => fs.readdirSync(path.join(dataDir, 'agent')).filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(dataDir, 'agent', name), 'utf8')) as { pid: number; tab: string })
  const removedPids = hosts().filter(host => host.tab === 'removed-tab').map(host => host.pid)
  const retainedPid = hosts().find(host => host.tab === 'retained-tab')!.pid
  assert.equal(removedPids.length, 2)
  const retained = { id: 'retained-tab', label: 'Keep', runtime: 'codex', cwd: workspace }
  writeAgentTabs('removed@example.test', workspace, { tabs: [
    { id: 'removed-tab', label: 'Closed', runtime: 'codex', cwd: otherCwd,
      sessionIds: { [JSON.stringify(['codex', workspace])]: 'host-session', legacy: 'old' } },
    { id: 'never-opened', label: 'Absent', runtime: 'codex', cwd: workspace }, retained,
  ], activeId: 'removed-tab' })
  await assert.rejects(saveAgentTabs('removed@example.test', workspace, null))
  assert.ok(removedPids.every(alive), '잘못된 저장은 감독을 종료하지 않는다')
  await saveAgentTabs('other@example.test', workspace, { tabs: [], activeId: null })
  assert.ok(removedPids.every(alive), '다른 계정의 저장은 감독을 종료하지 않는다')
  const saved = await saveAgentTabs('removed@example.test', workspace, { tabs: [retained], activeId: retained.id })
  await waitFor(() => removedPids.every(pid => !alive(pid)))
  assert.equal(alive(retainedPid), true, '남은 탭의 감독을 보존한다')
  assert.deepEqual(readAgentTabs('removed@example.test', workspace), saved)
  assert.equal(hosts().some(host => host.tab === 'never-opened'), false, '종료할 때 새 감독을 만들지 않는다')
})

test('ACP의 plain object 오류에서 메시지와 상세 원인을 보존한다', () => {
  const message = describeError({
    code: -32603,
    message: 'Internal error',
    data: { details: 'no rollout found for thread id missing-session' },
  })
  assert.match(message, /Internal error/)
  assert.match(message, /no rollout found/)
  assert.doesNotMatch(message, /\[object Object\]/)
})

test('/clear 뒤 같은 탭의 이전 Codex thread를 새 writer로 복원한다', async (t) => {
  fs.rmSync(writerLockFile, { force: true })
  t.after(async () => {
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise((resolve) => setTimeout(resolve, 80))
  })

  let currentSessionId = ''
  let cleared = false
  let refreshed: (() => void) | null = null
  const errors: string[] = []
  let resolveSession!: (sessionId: string) => void
  let nextSession = new Promise<string>((resolve) => { resolveSession = resolve })
  const client = await connectAgentHost('codex', 'clear-resume-tab', workspace, {
    onReplay: (_events, restored) => { if (restored) refreshed?.() },
    onEvent: (event) => {
      if (event.type === 'error') errors.push(event.message)
      if (event.type === 'reset') cleared = true
      if (event.type !== 'meta' || (event.meta.sessionId === currentSessionId && !cleared)) return
      cleared = false
      currentSessionId = event.meta.sessionId
      resolveSession(currentSessionId)
    },
  })
  t.after(() => client.close())

  assert.equal(await nextSession, 'host-session')
  const initialWriter = Number(fs.readFileSync(writerLockFile, 'utf8'))
  nextSession = new Promise<string>((resolve) => { resolveSession = resolve })
  client.send({ type: 'clear_session' })
  assert.equal(await nextSession, 'host-session', '새 프로세스의 첫 세션을 사용한다')
  assert.equal(alive(initialWriter), false, '히스토리를 불러오기 전부터 이전 writer가 종료돼 있다')

  const restored = new Promise<void>(resolve => { refreshed = resolve })
  const callsBeforeLoad = fs.readFileSync(callsFile, 'utf8').length
  client.send({ type: 'load_session', sessionId: 'host-session' })
  await restored
  const oldWriter = fs.readFileSync(writerLockFile, 'utf8')
  const reloaded = new Promise<void>(resolve => { refreshed = resolve })
  client.send({ type: 'load_session', sessionId: 'host-session' })
  await reloaded
  assert.equal(fs.readFileSync(callsFile, 'utf8').slice(callsBeforeLoad).includes('session/new'), false,
    '히스토리 전환과 현재 대화 새로고침은 임시 세션을 만들지 않는다')
  assert.notEqual(fs.readFileSync(writerLockFile, 'utf8'), oldWriter, '현재 대화 새로고침도 이전 writer가 종료된 뒤 같은 ID를 다시 읽는다')
  assert.deepEqual(errors, [])
})

test('Codex 히스토리 실패 뒤 복구도 실패한 writer가 종료된 뒤 시작한다', { timeout: 10_000 }, async (t) => {
  fs.rmSync(writerLockFile, { force: true })
  t.after(async () => {
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise((resolve) => setTimeout(resolve, 200))
  })
  let ready!: () => void
  const started = new Promise<void>((resolve) => { ready = resolve })
  let failed!: (message: string) => void
  const failure = new Promise<string>((resolve) => { failed = resolve })
  let restored: AgentEvent[] = []
  const client = await connectAgentHost('codex', 'failed-writer-tab', workspace, {
    onReplay: (events, recovery) => { if (recovery) restored = events },
    onEvent: (event) => {
      if (event.type === 'meta') ready()
      if (event.type === 'error') failed(event.message)
    },
  })
  t.after(() => client.close())
  await started
  client.send({ type: 'load_session', sessionId: 'partial-load' })
  assert.match(await failure, /history replay failed/)
  assert.ok(restored.some((event) => event.type === 'update'
    && event.update.sessionUpdate === 'agent_message_chunk'
    && event.update.content.type === 'text'
    && event.update.content.text === '이전 답변 복원'), '복구 오류로 빈 세션을 남기지 않고 이전 전사를 다시 읽는다')
})

test('자동 복원 실패가 fallback 세션으로 원래 thread 포인터를 덮지 않게 알린다', async (t) => {
  t.after(async () => {
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise((resolve) => setTimeout(resolve, 80))
  })

  let failure: { sessionId: string; message: string } | null = null
  let replayed!: () => void
  const replayReady = new Promise<void>((resolve) => { replayed = resolve })
  const client = await connectAgentHost('claude', 'restore-failure-tab', workspace, {
    onReplay: (_events, _restored, restoreFailure) => {
      failure = restoreFailure
      replayed()
    },
  }, 'busy-thread')
  t.after(() => client.close())

  await replayReady
  const received = failure as { sessionId: string; message: string } | null
  assert.ok(received)
  assert.equal(received.sessionId, 'busy-thread')
  assert.match(received.message, /Internal error/)
})

test('복원에서 인증이 만료되면 로그인 화면으로 폴백하고 같은 탭에서 재시도한다', { timeout: 10_000 }, async t => {
  fs.writeFileSync(authRequiredFile, '')
  t.after(async () => {
    fs.rmSync(authRequiredFile, { force: true })
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise(resolve => setTimeout(resolve, 200))
  })
  let authReady!: () => void
  let sessionReady!: (id: string) => void
  const auth = new Promise<void>(resolve => { authReady = resolve })
  const ready = new Promise<string>(resolve => { sessionReady = resolve })
  let failureId: string | undefined
  const client = await connectAgentHost('claude', 'expired-auth-tab', workspace, {
    onReplay: (_events, _restored, failure) => { failureId = failure?.sessionId },
    onEvent: event => {
      if (event.type === 'auth') authReady()
      if (event.type === 'meta' && event.meta.sessionId) sessionReady(event.meta.sessionId)
    },
  }, 'saved-session')
  t.after(() => client.close())
  await auth
  assert.equal(failureId, 'saved-session', '인증 실패도 원래 대화 포인터를 보존한다')
  client.send({ type: 'authenticate', methodId: 'login' })
  assert.equal(await ready, 'host-session')
})

test('Codex 선택 기록과 이전 대화 복구가 모두 실패하면 준비된 새 세션으로 폴백한다', { timeout: 10_000 }, async t => {
  t.after(async () => {
    fs.rmSync(recoveryFailureFile, { force: true })
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise(resolve => setTimeout(resolve, 200))
  })
  let firstReady!: () => void
  let recoveryReady!: () => void
  const first = new Promise<void>(resolve => { firstReady = resolve })
  const recovery = new Promise<void>(resolve => { recoveryReady = resolve })
  let currentSessionId = ''
  const client = await connectAgentHost('codex', 'failed-recovery-tab', workspace, {
    onEvent: event => {
      if (event.type === 'meta') { currentSessionId = event.meta.sessionId; firstReady() }
      if (event.type === 'error') recoveryReady()
    },
  })
  t.after(() => client.close())
  await first
  const callsBeforeLoad = fs.readFileSync(callsFile, 'utf8').length
  client.send({ type: 'load_session', sessionId: 'unrecoverable' })
  await recovery
  assert.equal(currentSessionId, 'host-session', '대화 ID 없는 복원 전용 연결을 화면에 노출하지 않는다')
  const calls = fs.readFileSync(callsFile, 'utf8').slice(callsBeforeLoad).trim().split('\n').map(line => JSON.parse(line).method)
  assert.deepEqual(calls, ['initialize', 'session/load', 'initialize', 'session/load', 'initialize', 'session/new'])
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(check: () => boolean, timeout = 3_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('조건을 기다리다 시간 초과')
}

test('CLI HTTP relay queues behind AI and independent host completes it after disconnect', { timeout: 10_000 }, async t => {
  const { upsertUser } = await import('./auth.ts')
  const { queueCommandInHost } = await import('./agentHost.ts')
  const { AgentCommandStore } = await import('./agent-commands.ts')
  const { createTmuxManager } = await import('@mew/tmux-term/server')
  const tmux = execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim()
  const socket = `mew-host-cli-${crypto.randomUUID()}`
  const bin = path.join(stubDir, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nexec '${tmux}' -L '${socket}' "$@"\n`, { mode: 0o700 })
  const previousPath = process.env.PATH
  process.env.PATH = `${bin}:${previousPath}`
  t.after(async () => {
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise(resolve => setTimeout(resolve, 200))
    try { execFileSync(tmux, ['-L', socket, 'kill-server'], { stdio: 'ignore' }) } catch { /* already cleaned up */ }
    process.env.PATH = previousPath
  })
  const owner = 'host-cli@example.test'
  upsertUser(owner, { hash: 'unused', role: 'owner', createdAt: 0, passwordChangedAt: 0, mustChangePassword: false })
  let turnStarted = false
  const client = await connectAgentHost('claude', 'cli-queue-tab', workspace, {
    onEvent: event => { if (event.type === 'turn_start') turnStarted = true },
  })
  t.after(() => client.close())
  client.send({ type: 'prompt', text: 'before CLI', promptText: 'before CLI' })
  await waitFor(() => turnStarted)
  const record = await queueCommandInHost(owner, {
    runtime: 'claude', tab: 'cli-queue-tab', cwd: workspace, sessionId: 'host-session',
    id: crypto.randomUUID(), command: 'printf "queued host output"', afterUserCount: 0,
  })
  assert.equal(record.state, 'queued')
  client.close()
  const store = new AgentCommandStore(createTmuxManager({ cwd: workspace }))
  await waitFor(() => store.read(owner, record.id).state === 'completed', 6000)
  const saved = store.read(owner, record.id)
  assert.equal(saved.afterUserCount, 1)
  assert.notEqual(saved.queueHostPid, process.pid)
  assert.equal(gunzipSync(fs.readFileSync(path.join(store.directory(owner, record.id), 'output.gz'))).toString(), 'queued host output')
})

test('mew 연결이 사라져도 독립 감독이 작업을 끝내고 재접속에 대화를 복원한다', async (t) => {
  fs.rmSync(finishedFile, { force: true })
  t.after(async () => {
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise((resolve) => setTimeout(resolve, 80))
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(stubDir, { recursive: true, force: true })
  })

  let turnStarted!: () => void
  const started = new Promise<void>((resolve) => { turnStarted = resolve })
  const first = await connectAgentHost('claude', 'survive-tab', workspace, {
    onEvent: (event) => {
      if (event.type === 'turn_start') turnStarted()
    },
  })
  first.send({ type: 'prompt', text: '계속해', promptText: '계속해' })
  await started

  const metaFile = fs.readdirSync(path.join(dataDir, 'agent')).find((name) => name.endsWith('.json'))
  assert.ok(metaFile)
  const hostPid = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent', metaFile), 'utf8')).pid as number
  assert.notEqual(hostPid, process.pid, 'ACP 세션은 mew와 다른 감독 프로세스가 소유한다')
  first.close() // 프론트 종료 + mew 중계 소켓 종료를 흉내 낸다

  await waitFor(() => fs.existsSync(finishedFile))
  assert.ok(alive(hostPid), '연결이 없어져도 감독은 턴 완료 뒤 살아 있다')

  let replayed: AgentEvent[] = []
  let replayResolve!: () => void
  const replayReady = new Promise<void>((resolve) => {
    replayResolve = resolve
  })
  const second = await connectAgentHost('claude', 'survive-tab', workspace, {
    onReplay: (events) => {
      replayed = events
      if (events.some((event) => event.type === 'turn_end')) replayResolve()
    },
  })
  t.after(() => second.close())
  await replayReady
  assert.ok(replayed.some((event) => event.type === 'turn_end'), '완료 이벤트까지 감독 메모리에서 복원된다')
  assert.match(JSON.stringify(replayed), /독립 완료/)

  let restoredEvents: AgentEvent[] = []
  let restoredReplay = false
  let restoredMeta = ''
  let restoreResolve!: () => void
  const restoreReady = new Promise<void>((resolve) => { restoreResolve = resolve })
  const restored = await connectAgentHost('claude', 'restore-tab', workspace, {
    onReplay: (events, restored) => {
      restoredEvents = events
      restoredReplay = restored
    },
    onEvent: (event) => {
      if (event.type !== 'meta') return
      restoredMeta = event.meta.sessionId
      restoreResolve()
    },
  }, 'saved-session')
  t.after(() => restored.close())
  await restoreReady
  assert.equal(restoredMeta, 'saved-session', '새 감독은 탭이 기억한 ACP 세션을 자동 resume한다')
  assert.equal(restoredReplay, true, '브라우저가 캐시와 중복 병합하지 않도록 복원 replay를 표식한다')
  assert.match(JSON.stringify(restoredEvents), /이전 답변 복원/, '복원된 세션의 전사가 replay된다')
  restored.send({ type: 'close_session' })
  restored.close()

  second.send({ type: 'close_session' })
  second.close()
  await waitFor(() => !alive(hostPid))
  assert.equal(alive(hostPid), false, '탭을 명시적으로 닫으면 30분을 기다리지 않고 감독이 끝난다')
})
