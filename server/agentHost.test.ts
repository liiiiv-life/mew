// 에이전트 감독 프로세스 계약 — mew/프론트 소켓이 사라져도 독립 프로세스가 턴을 마치고 재접속에 재생한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-ws-'))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-data-'))
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-stub-'))
const stubPath = path.join(stubDir, 'stub.mjs')
const finishedFile = path.join(stubDir, 'finished')
process.env.MEW_WORKSPACE = workspace
process.env.MEW_DATA_DIR = dataDir

const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')
fs.writeFileSync(
  stubPath,
  `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'

class SlowAgent {
  constructor(conn) { this.conn = conn }
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true } } }
  async newSession() { return { sessionId: 'host-session' } }
  async loadSession({ sessionId }) {
    await this.conn.sessionUpdate({ sessionId, update: {
      sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '이전 질문' },
    } })
    await this.conn.sessionUpdate({ sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '이전 답변 복원' },
    } })
    return {}
  }
  async authenticate() { return {} }
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

new AgentSideConnection(
  (conn) => new SlowAgent(conn),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`,
)
process.env.MEW_AGENT_CMD = process.execPath
process.env.MEW_AGENT_ARGS = `${stubPath} ${finishedFile}`

const { connectAgentHost, describeError, shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent

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

test('mew 연결이 사라져도 독립 감독이 작업을 끝내고 재접속에 대화를 복원한다', async (t) => {
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
