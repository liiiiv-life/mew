// ACP 계약 테스트 — 핸드셰이크 + 한 턴(스트리밍·권한 승인 왕복·파일 스코프)을 실제 stdio JSON-RPC로 돈다.
// 진짜 Claude를 부르지 않는다(키·네트워크 없음): 스펙만 지키는 가짜 에이전트를 임시 폴더에 써서 붙인다.
// 어댑터를 올릴 때 이게 먼저 터져야 한다 — ADR 0034가 요구하는 그 테스트다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
// 진짜 워크스페이스를 건드리지 않는다 — paths.ts가 import 시점에 MEW_WORKSPACE를 읽으므로 먼저 심고 동적 import
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-ws-'))
process.env.MEW_WORKSPACE = workspace
const { AgentSession, disposeSession, modelsByRuntime, probeModels, reapOrphanAgents, sessionFor } = await import(
  './agentAcp.ts'
)
type AgentEvent = import('./agentAcp.ts').AgentEvent

const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')

// 세션은 워크스페이스에 묶인다 — 스텁이 쓰는 상대 경로도 전부 여기 기준이다(ADR 0043)
const runtime = 'claude'

const stubSource = `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import { Readable, Writable } from 'node:stream'

class StubAgent {
  constructor(conn) { this.conn = conn }
  async initialize(params) {
    this.caps = params.clientCapabilities
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }
  }
  async newSession() { return { sessionId: 'stub-1' } }
  async authenticate() { return {} }
  async cancel() {}
  async prompt({ sessionId }) {
    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '안녕' } } })

    const decision = await this.conn.requestPermission({
      sessionId,
      toolCall: { toolCallId: 't1', title: 'ls', kind: 'execute' },
      options: [
        { optionId: 'allow', name: '허용', kind: 'allow_once' },
        { optionId: 'deny', name: '거부', kind: 'reject_once' },
      ],
    })
    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'decision:' + decision.outcome.optionId } } })

    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'caps:' + JSON.stringify(this.caps) } } })
    return { stopReason: 'end_turn' }
  }
}

new AgentSideConnection(
  (conn) => new StubAgent(conn),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`

// 모드를 광고하는 가짜 에이전트 — 세션은 default로 시작하고, 받은 모드를 다음 턴에 되돌려 준다
const modeStubSource = `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import { Readable, Writable } from 'node:stream'

class ModeAgent {
  constructor(conn) { this.conn = conn; this.mode = 'default' }
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} } }
  async newSession() {
    return {
      sessionId: 'stub-mode',
      modes: {
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default' }, { id: 'bypassPermissions', name: 'Bypass Permissions' }],
      },
    }
  }
  async setSessionMode({ modeId }) { this.mode = modeId; return {} }
  async authenticate() { return {} }
  async cancel() {}
  async prompt({ sessionId }) {
    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'mode:' + this.mode } } })
    return { stopReason: 'end_turn' }
  }
}

new AgentSideConnection(
  (conn) => new ModeAgent(conn),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`

// 같은 가짜 에이전트를 codex 이름으로 — "다 허용"의 이름이 런타임마다 다르다는 것이 요점이다
const codexModeStubSource = modeStubSource
  .replace(
    "[{ id: 'default', name: 'Default' }, { id: 'bypassPermissions', name: 'Bypass Permissions' }]",
    "[{ id: 'read-only', name: 'Read Only' }, { id: 'auto', name: 'Default' }, { id: 'full-access', name: 'Full Access' }]",
  )
  .replace("currentModeId: 'default'", "currentModeId: 'auto'")

// 지난 대화를 되재생하는 어댑터를 흉내 낸다 — 사용자 발화에 CLI 메타(caveat·커맨드 머리)가 섞여 온다
const historyStubSource = `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import { Readable, Writable } from 'node:stream'

const userChunk = (text) => ({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } })

class HistoryAgent {
  constructor(conn) { this.conn = conn }
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} } }
  async newSession() { return { sessionId: 'stub-history' } }
  async authenticate() { return {} }
  async cancel() {}
  async prompt({ sessionId }) {
    await this.conn.sessionUpdate({ sessionId, update: userChunk('<local-command-caveat>Caveat: local commands.</local-command-caveat>') })
    await this.conn.sessionUpdate({ sessionId, update: userChunk('<command-name>/model</command-name>\\n<command-args>opus</command-args>') })
    await this.conn.sessionUpdate({ sessionId, update: userChunk('이 <local-command-caveat>x</local-command-caveat> 왜 붙어?') })
    return { stopReason: 'end_turn' }
  }
}

new AgentSideConnection(
  (conn) => new HistoryAgent(conn),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`

// 어댑터가 세션마다 CLI를 하나씩 밑에 두는 것을 흉내 낸다 — 그 손자까지 죽는지 보려는 스텁
// 모델을 광고하는 가짜 에이전트 — 자기 pid를 적어 둬서 목록만 받고 접혔는지 볼 수 있게 한다
const modelStubSource = `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'

fs.writeFileSync(process.argv[2], String(process.pid))

class ModelAgent {
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} } }
  async newSession() {
    return {
      sessionId: 'stub-model',
      models: {
        currentModelId: 'alpha-1',
        availableModels: [{ modelId: 'alpha-1', name: 'Alpha' }, { modelId: 'beta-2', name: 'Beta' }],
      },
    }
  }
  async authenticate() { return {} }
  async cancel() {}
  async prompt() { return { stopReason: 'end_turn' } }
}

new AgentSideConnection(
  () => new ModelAgent(),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`

const treeStubSource = `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'

const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
fs.writeFileSync(process.argv[2], String(grandchild.pid))

class TreeAgent {
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} } }
  async newSession() { return { sessionId: 'stub-tree' } }
  async authenticate() { return {} }
  async cancel() {}
  async prompt() { return { stopReason: 'end_turn' } }
}

new AgentSideConnection(
  () => new TreeAgent(),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
`

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitGone(pid: number) {
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 20))
}

function textOf(events: AgentEvent[]): string {
  const chunks: string[] = []
  for (const event of events) {
    if (event.type !== 'update' || event.update.sessionUpdate !== 'agent_message_chunk') continue
    const content = event.update.content
    if (!Array.isArray(content) && content?.type === 'text') chunks.push(content.text)
  }
  return chunks.join('|')
}

test('ACP 한 턴: 스트리밍·승인 왕복·CLI 기본 파일 도구 유지', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  const events: AgentEvent[] = []
  const done = new Promise<void>((resolve) => {
    session.attach((event) => {
      events.push(event)
      if (event.type === 'permission') session.answerPermission(event.id, 'allow')
      if (event.type === 'turn_end') resolve()
    })
  })

  session.prompt('테스트')
  await done

  const text = textOf(events)
  assert.match(text, /^안녕\|/, '첫 청크가 스트리밍으로 도착')
  assert.match(text, /decision:allow/, '승인 응답이 에이전트로 돌아감')
  // fs capability를 광고하면 어댑터가 CLI의 Read/Write/Edit를 끄고 mcp__acp__*로 갈아끼운다.
  // 그러면 CLI에서 만든 대화를 창에서 불러올 때 전사 속 `Edit` 참조가 API에서 거부된다(ADR 0044).
  assert.match(text, /caps:\{/, '에이전트가 받은 클라이언트 capability를 되돌려 준다')
  assert.doesNotMatch(text, /"readTextFile":\s*true/, 'fs.readTextFile을 광고하지 않는다')
  assert.doesNotMatch(text, /"writeTextFile":\s*true/, 'fs.writeTextFile을 광고하지 않는다')
  assert.deepEqual(events.at(-1), { type: 'turn_end', stopReason: 'end_turn' })
})

test('되재생된 사용자 발화에서 CLI 메타만 걷어낸다 — 창에서 친 프롬프트는 그대로 남는다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'history-stub.mjs')
  fs.writeFileSync(stubPath, historyStubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  const events: AgentEvent[] = []
  const done = new Promise<void>((resolve) => {
    session.attach((event) => {
      events.push(event)
      if (event.type === 'turn_end') resolve()
    })
  })
  const typed = '내가 친 <local-command-caveat>진짜</local-command-caveat> 프롬프트'
  session.prompt(typed)
  await done

  const said: string[] = []
  for (const event of events) {
    if (event.type !== 'update' || event.update.sessionUpdate !== 'user_message_chunk') continue
    const content = event.update.content
    if (!Array.isArray(content) && content?.type === 'text') said.push(content.text)
  }
  assert.deepEqual(said, [
    typed, // #run이 넣은 라이브 발화 — 태그를 쳐도 손대지 않는다
    '/model opus', // 되재생된 슬래시 커맨드는 입력한 모양으로
    '이 <local-command-caveat>x</local-command-caveat> 왜 붙어?', // 문장 안의 태그는 그대로
  ])
})

test('세션을 잡으면 기본 권한 모드(bypassPermissions)를 걸어 준다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'mode-stub.mjs')
  fs.writeFileSync(stubPath, modeStubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  assert.equal(session.modes?.currentModeId, 'bypassPermissions', '핸드셰이크 직후 기본 모드가 걸린다')

  const events: AgentEvent[] = []
  const done = new Promise<void>((resolve) => {
    session.attach((event) => {
      events.push(event)
      if (event.type === 'turn_end') resolve()
    })
  })
  session.prompt('테스트')
  await done

  assert.match(textOf(events), /mode:bypassPermissions/, '에이전트가 실제로 그 모드로 돈다')

  await session.setMode('default')
  assert.equal(session.modes?.currentModeId, 'default', '창에서 모드를 되돌릴 수 있다')
})

test('"다 허용" 모드의 이름이 달라도(codex full-access) 그걸 골라 건다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'codex-mode-stub.mjs')
  fs.writeFileSync(stubPath, codexModeStubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  assert.equal(session.modes?.currentModeId, 'full-access', 'bypassPermissions가 없으면 그 런타임의 전체 허용으로 간다')
})

test('취소하면 대기 중인 승인 요청이 cancelled로 닫힌다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'inside.txt'), 'ok')
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  const events: AgentEvent[] = []
  const done = new Promise<void>((resolve) => {
    session.attach((event) => {
      events.push(event)
      if (event.type === 'permission') session.cancel()
      if (event.type === 'turn_end') resolve()
    })
  })

  session.prompt('테스트')
  await done

  assert.ok(
    events.some((e) => e.type === 'permission_done'),
    '취소가 대기 중 승인을 닫는다',
  )
  assert.match(textOf(events), /decision:undefined/, '에이전트는 cancelled outcome을 받는다')
})

test('재접속하면 지나간 이벤트를 되돌려 받는다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'inside.txt'), 'ok')
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  const first: AgentEvent[] = []
  const done = new Promise<void>((resolve) => {
    const detach = session.attach((event) => {
      first.push(event)
      if (event.type === 'permission') session.answerPermission(event.id, 'allow')
      if (event.type === 'turn_end') {
        detach()
        resolve()
      }
    })
  })
  session.prompt('테스트')
  await done

  // 지나간 대화는 스냅샷 한 덩어리로 간다(창이 통째로 갈아끼운다). attach는 그 뒤부터의 것만 흘린다
  const fresh: AgentEvent[] = []
  session.attach((event) => fresh.push(event))
  // meta는 이벤트 흐름이 아니라 현재 상태 스냅샷이라 붙을 때마다 새로 온다 — 대화 비교에서는 뺀다
  const conversation = (events: AgentEvent[]) => events.filter((e) => e.type !== 'meta')
  assert.deepEqual(session.snapshot(), conversation(first), '새로 붙은 창이 같은 대화를 그대로 본다')
  assert.ok(fresh.some((e) => e.type === 'meta'), '붙자마자 세션 상태를 받는다')
  assert.deepEqual(conversation(fresh), [], '지나간 대화가 attach로 두 번 오지 않는다')
})

test('진행 중에 보낸 메시지는 줄을 섰다가 이어서 돈다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'inside.txt'), 'ok')
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  const prompts: string[] = []
  const done = new Promise<void>((resolve) => {
    session.attach((event) => {
      if (event.type === 'permission') session.answerPermission(event.id, 'allow')
      if (event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk') {
        const content = event.update.content
        if (!Array.isArray(content) && content?.type === 'text') prompts.push(content.text)
      }
      if (event.type === 'turn_end' && prompts.length === 2) resolve()
    })
  })

  session.prompt('첫째')
  session.prompt('둘째')
  assert.deepEqual(prompts, ['첫째'], '둘째는 아직 돌지 않는다')
  await done

  assert.deepEqual(prompts, ['첫째', '둘째'], '첫 턴이 끝나면 대기 메시지가 이어서 돈다')
})

test('세션을 접으면 어댑터가 밑에 둔 프로세스까지 같이 죽는다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-'))
  const stubPath = path.join(dir, 'tree-stub.mjs')
  const pidFile = path.join(dir, 'grandchild.pid')
  fs.writeFileSync(stubPath, treeStubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath, pidFile] })
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8'))
  assert.ok(alive(grandchild), '손자가 떠 있다')

  session.dispose()
  await waitGone(grandchild)
  assert.equal(alive(grandchild), false, '어댑터만이 아니라 그 밑까지 정리된다')
})

test('뜰 때 부모 잃은 에이전트 프로세스를 걷어낸다', async (t) => {
  // 이 테스트가 만든 것만 잡히도록 표식을 대상 명령으로 심는다
  const marker = `mew-reap-test-${process.pid}-${Math.random().toString(36).slice(2)}`
  const previous = process.env.MEW_AGENT_CMD
  process.env.MEW_AGENT_CMD = marker
  t.after(() => {
    if (previous === undefined) delete process.env.MEW_AGENT_CMD
    else process.env.MEW_AGENT_CMD = previous
  })

  // 주인(= 띄운 서버)이 먼저 죽고 혼자 남은 모양을 만든다 — 서버가 SIGKILL로 끊겼을 때와 같다.
  // 부트스트랩이 곧 주인 노릇을 한다: 자식을 띄우고 자기 pid를 표식으로 남긴 뒤 바로 죽는다.
  const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-reap-')), 'pid')
  const bootstrap = `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', ${JSON.stringify(marker)}], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, MEW_AGENT_OWNER: String(process.pid) },
    })
    require('node:fs').writeFileSync(process.argv[1], String(child.pid))
    child.unref()
  `
  await new Promise((resolve) => {
    spawn(process.execPath, ['-e', bootstrap, pidFile], { stdio: 'ignore' }).on('exit', resolve)
  })
  const orphan = Number(fs.readFileSync(pidFile, 'utf8'))
  t.after(() => {
    try {
      process.kill(orphan, 'SIGKILL')
    } catch {
      /* 이미 죽었다 */
    }
  })
  assert.ok(alive(orphan), '고아가 떠 있다')

  // 같은 표식이라도 주인이 살아 있으면 지금 돌고 있는 다른 mew의 자식이다 — 건드리면 안 된다
  const attached = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', marker], {
    stdio: 'ignore',
    env: { ...process.env, MEW_AGENT_OWNER: String(process.pid) },
  })
  t.after(() => attached.kill('SIGKILL'))

  reapOrphanAgents()
  await waitGone(orphan)
  assert.equal(alive(orphan), false, '지난 실행이 남긴 프로세스를 뜰 때 정리한다')
  assert.ok(alive(attached.pid!), '주인이 살아 있는 프로세스는 남긴다')
})

test('대기 중인 메시지를 고치면 고친 내용으로 돈다 — 원본이 어긋나면 무시한다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  const prompts: string[] = []
  const done = new Promise<void>((resolve) => {
    session.attach((event) => {
      if (event.type === 'permission') session.answerPermission(event.id, 'allow')
      if (event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk') {
        const content = event.update.content
        if (!Array.isArray(content) && content?.type === 'text') prompts.push(content.text)
      }
      if (event.type === 'turn_end' && prompts.length === 2) resolve()
    })
  })

  session.prompt('첫째')
  session.prompt('둘째')
  // 창이 다른 원본을 보고 있었다 = 그 사이 큐가 당겨졌다 — 엉뚱한 항목을 덮어쓰지 않는다
  session.editQueued(0, '가로채기', '셋째')
  session.editQueued(0, '고친 둘째', '둘째')
  await done

  assert.deepEqual(prompts, ['첫째', '고친 둘째'], '고친 내용이 대기 순서 그대로 돈다')
})

test('중단하면 대기 중인 메시지도 같이 버린다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'inside.txt'), 'ok')
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  const session = await AgentSession.start(runtime, { cmd: process.execPath, args: [stubPath] })
  t.after(() => session.dispose())

  const prompts: string[] = []
  const done = new Promise<void>((resolve) => {
    session.attach((event) => {
      if (event.type === 'permission') session.cancel()
      if (event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk') {
        const content = event.update.content
        if (!Array.isArray(content) && content?.type === 'text') prompts.push(content.text)
      }
      if (event.type === 'turn_end') resolve()
    })
  })

  session.prompt('첫째')
  session.prompt('둘째')
  await done
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.deepEqual(prompts, ['첫째'], '중단한 뒤에는 대기 메시지가 돌지 않는다')
})

test('탭마다 세션이 따로 뜬다 — 한 탭을 닫아도 다른 탭은 그대로다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'tab-stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  // sessionFor는 spec을 받지 않는다(등록표에서 뽑는다) — 환경변수로 스텁을 가리킨다
  const saved = { cmd: process.env.MEW_AGENT_CMD, args: process.env.MEW_AGENT_ARGS }
  process.env.MEW_AGENT_CMD = process.execPath
  process.env.MEW_AGENT_ARGS = stubPath
  t.after(() => {
    for (const tab of ['tab-a', 'tab-b']) disposeSession(runtime, tab)
    if (saved.cmd === undefined) delete process.env.MEW_AGENT_CMD
    else process.env.MEW_AGENT_CMD = saved.cmd
    if (saved.args === undefined) delete process.env.MEW_AGENT_ARGS
    else process.env.MEW_AGENT_ARGS = saved.args
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  const a = await sessionFor(runtime, 'tab-a')
  const b = await sessionFor(runtime, 'tab-b')
  assert.notEqual(a, b, '탭이 다르면 대화도 자식 프로세스도 다르다')
  assert.equal(await sessionFor(runtime, 'tab-a'), a, '같은 탭으로 다시 붙으면 하던 대화가 이어진다')

  disposeSession(runtime, 'tab-a')
  assert.equal(await sessionFor(runtime, 'tab-b'), b, '탭 하나를 닫아도 옆 탭 세션은 살아 있다')
  assert.notEqual(await sessionFor(runtime, 'tab-a'), a, '닫은 탭은 다음에 붙을 때 새로 뜬다')
})

test('모델 후보를 물어보면 세션을 잠깐 띄웠다 접는다 — 두 번째부터는 안 띄운다', async (t) => {
  fs.mkdirSync(workspace, { recursive: true })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-'))
  const stubPath = path.join(dir, 'model-stub.mjs')
  const pidFile = path.join(dir, 'pid')
  fs.writeFileSync(stubPath, modelStubSource)
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))

  // 등록표에 없는 id로 돈다 — 캐시가 런타임별이라 다른 테스트의 'claude'와 섞이지 않는다
  const probeRuntime = 'probe-stub'
  const models = await probeModels(probeRuntime, { cmd: process.execPath, args: [stubPath, pidFile] })
  assert.deepEqual(
    models.map((m) => m.modelId),
    ['alpha-1', 'beta-2'],
  )
  assert.deepEqual(modelsByRuntime()[probeRuntime], models, '런타임별 후보로 남아 다음 창이 바로 쓴다')

  await waitGone(Number(fs.readFileSync(pidFile, 'utf8')))
  assert.equal(alive(Number(fs.readFileSync(pidFile, 'utf8'))), false, '목록만 받고 프로세스는 접힌다')

  // 이미 아는 런타임이면 뜨지 않는다 — 없는 실행 파일을 줘도 캐시가 그대로 돌아온다
  assert.deepEqual(await probeModels(probeRuntime, { cmd: '/nonexistent/agent', args: [] }), models)
})
