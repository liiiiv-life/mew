// ACP가 인증 전에 아예 뜨지 않는 런타임도 감독을 살려 GUI terminal auth 뒤 새 ACP로 복구한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-auth-ws-'))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-auth-data-'))
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-host-auth-stub-'))
const stubPath = path.join(stubDir, 'auth-gated-agent.mjs')
const credentialFile = path.join(stubDir, 'credential')
process.env.MEW_WORKSPACE = workspace
process.env.MEW_DATA_DIR = dataDir

const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')
fs.writeFileSync(
  stubPath,
  `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'

const credentialFile = process.argv[2]
if (process.argv.includes('--cli')) {
  fs.writeFileSync(credentialFile, 'logged-in')
  process.exit(0)
}
if (!fs.existsSync(credentialFile)) process.exit(17)

class AuthenticatedAgent {
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} } }
  async newSession() { return { sessionId: 'host-auth-recovered' } }
  async authenticate() { return {} }
  async cancel() {}
  async prompt() { return { stopReason: 'end_turn' } }
}

new AgentSideConnection(
  () => new AuthenticatedAgent(),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`,
)
process.env.MEW_AGENT_CMD = process.execPath
process.env.MEW_AGENT_ARGS = `${stubPath} ${credentialFile}`

const { connectAgentHost, shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')
const { RUNTIME_LOGIN_METHOD_ID } = await import('./agentRuntimes.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent

function waitForEvent(
  subscribe: (resolve: (event: AgentEvent) => void) => void,
  timeout = 5_000,
): Promise<AgentEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('에이전트 감독 이벤트 시간 초과')), timeout)
    subscribe((event) => {
      clearTimeout(timer)
      resolve(event)
    })
  })
}

test('pre-ACP 인증 실패 → GUI 로그인 spec → ACP 재시작으로 같은 탭이 복구된다', async (t) => {
  const events: AgentEvent[] = []
  const waiters = new Set<(event: AgentEvent) => void>()
  const fatals: string[] = []
  const client = await connectAgentHost('claude', 'pre-acp-auth-tab', workspace, {
    onEvent: (event) => {
      events.push(event)
      for (const waiter of [...waiters]) waiter(event)
    },
    onFatal: (message) => fatals.push(message),
  })
  t.after(async () => {
    try { client.send({ type: 'close_session' }) } catch { /* 이미 닫힘 */ }
    client.close()
    shutdownAgentHostsForWorkspace(workspace)
    await new Promise((resolve) => setTimeout(resolve, 80))
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(dataDir, { recursive: true, force: true })
    fs.rmSync(stubDir, { recursive: true, force: true })
  })

  const auth = await waitForEvent((resolve) => {
    const found = events.find((event) => event.type === 'auth' && !event.authenticating)
    if (found) resolve(found)
    else waiters.add((event) => {
      if (event.type === 'auth' && !event.authenticating) resolve(event)
    })
  })
  assert.equal(auth.type, 'auth')
  assert.deepEqual(auth.methods.map(({ id, kind, surface }) => ({ id, kind, surface })), [
    { id: RUNTIME_LOGIN_METHOD_ID, kind: 'terminal', surface: 'browser' },
    { id: 'mew-claude-console-login', kind: 'terminal', surface: 'browser' },
  ])
  assert.equal(fatals.length, 0, 'ACP 시작 실패가 탭을 fatal로 닫지 않는다')

  const spec = await client.request<{ cmd: string; args: string[]; env?: Record<string, string>; label: string }>({
    type: 'terminal_auth',
    methodId: RUNTIME_LOGIN_METHOD_ID,
  })
  assert.equal(spec.cmd, process.execPath)
  assert.deepEqual(spec.args, [stubPath, credentialFile, '--cli', 'auth', 'login', '--claudeai'])
  execFileSync(spec.cmd, spec.args, { cwd: workspace, env: { ...process.env, ...spec.env } })
  assert.equal(fs.readFileSync(credentialFile, 'utf8'), 'logged-in')

  const recovered = waitForEvent((resolve) => {
    waiters.add((event) => {
      if (event.type === 'meta' && event.meta.sessionId === 'host-auth-recovered') resolve(event)
    })
  })
  client.send({ type: 'retry_auth' })
  const meta = await recovered
  assert.equal(meta.type, 'meta')
  assert.ok(events.some((event) => event.type === 'auth' && event.authenticating))
  assert.ok(events.some((event) => event.type === 'auth_complete'))
  assert.equal(fatals.length, 0)
})
