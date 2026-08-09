// ACP 계약 테스트 — 핸드셰이크 + 한 턴(스트리밍·권한 승인 왕복·파일 스코프)을 실제 stdio JSON-RPC로 돈다.
// 진짜 Claude를 부르지 않는다(키·네트워크 없음): 스펙만 지키는 가짜 에이전트를 임시 폴더에 써서 붙인다.
// 어댑터를 올릴 때 이게 먼저 터져야 한다 — ADR 0034가 요구하는 그 테스트다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// 진짜 워크스페이스를 건드리지 않는다 — paths.ts가 import 시점에 MEW_WORKSPACE를 읽으므로 먼저 심고 동적 import
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-ws-'))
process.env.MEW_WORKSPACE = workspace
const { AgentSession } = await import('./agentAcp.ts')
type AgentEvent = import('./agentAcp.ts').AgentEvent

const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')

// 세션은 워크스페이스에 묶인다 — 스텁이 쓰는 상대 경로도 전부 여기 기준이다(ADR 0043)
const runtime = 'claude'

const stubSource = `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import { Readable, Writable } from 'node:stream'

class StubAgent {
  constructor(conn) { this.conn = conn }
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} } }
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

    const inside = await this.conn.readTextFile({ sessionId, path: 'inside.txt' })
    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'read:' + inside.content } } })

    let escaped = 'allowed'
    try {
      await this.conn.readTextFile({ sessionId, path: '../../etc/passwd' })
    } catch { escaped = 'blocked' }
    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'escape:' + escaped } } })

    await this.conn.writeTextFile({ sessionId, path: 'written/out.txt', content: 'from-agent' })
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

function textOf(events: AgentEvent[]): string {
  const chunks: string[] = []
  for (const event of events) {
    if (event.type !== 'update' || event.update.sessionUpdate !== 'agent_message_chunk') continue
    const content = event.update.content
    if (!Array.isArray(content) && content?.type === 'text') chunks.push(content.text)
  }
  return chunks.join('|')
}

test('ACP 한 턴: 스트리밍·승인 왕복·워크스페이스 밖 읽기 차단·쓰기', async (t) => {
  // 파일은 워크스페이스 루트에 둔다 — 세션의 cwd가 여기다
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
      if (event.type === 'permission') session.answerPermission(event.id, 'allow')
      if (event.type === 'turn_end') resolve()
    })
  })

  session.prompt('테스트')
  await done

  const text = textOf(events)
  assert.match(text, /^안녕\|/, '첫 청크가 스트리밍으로 도착')
  assert.match(text, /decision:allow/, '승인 응답이 에이전트로 돌아감')
  assert.match(text, /read:ok/, '워크스페이스 안 파일은 읽힘')
  assert.match(text, /escape:blocked/, '워크스페이스 밖 경로는 거부')
  assert.deepEqual(events.at(-1), { type: 'turn_end', stopReason: 'end_turn' })
  assert.equal(fs.readFileSync(path.join(workspace, 'written/out.txt'), 'utf8'), 'from-agent', '쓰기는 워크스페이스 안에 떨어짐')
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

  const replayed: AgentEvent[] = []
  session.attach((event) => replayed.push(event))
  // meta는 이벤트 흐름이 아니라 현재 상태 스냅샷이라 붙을 때마다 새로 온다 — 대화 비교에서는 뺀다
  const conversation = (events: AgentEvent[]) => events.filter((e) => e.type !== 'meta')
  assert.deepEqual(conversation(replayed), conversation(first), '새로 붙은 창이 같은 대화를 그대로 본다')
  assert.ok(replayed.some((e) => e.type === 'meta'), '붙자마자 세션 상태를 받는다')
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
