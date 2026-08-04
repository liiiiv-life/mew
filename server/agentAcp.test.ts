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

const project = 'sample'
const projectDir = path.join(workspace, project)

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

function textOf(events: AgentEvent[]): string {
  const chunks: string[] = []
  for (const event of events) {
    if (event.type !== 'update' || event.update.sessionUpdate !== 'agent_message_chunk') continue
    const content = event.update.content
    if (!Array.isArray(content) && content?.type === 'text') chunks.push(content.text)
  }
  return chunks.join('|')
}

test('ACP 한 턴: 스트리밍·승인 왕복·프로젝트 밖 읽기 차단·쓰기', async (t) => {
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'inside.txt'), 'ok')
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }))

  const session = await AgentSession.start(project, { cmd: process.execPath, args: [stubPath] })
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
  assert.match(text, /read:ok/, '프로젝트 안 파일은 읽힘')
  assert.match(text, /escape:blocked/, '프로젝트 밖 경로는 거부')
  assert.deepEqual(events.at(-1), { type: 'turn_end', stopReason: 'end_turn' })
  assert.equal(fs.readFileSync(path.join(projectDir, 'written/out.txt'), 'utf8'), 'from-agent', '쓰기는 프로젝트 안에 떨어짐')
})

test('취소하면 대기 중인 승인 요청이 cancelled로 닫힌다', async (t) => {
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'inside.txt'), 'ok')
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }))

  const session = await AgentSession.start(project, { cmd: process.execPath, args: [stubPath] })
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
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'inside.txt'), 'ok')
  const stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-acp-')), 'stub.mjs')
  fs.writeFileSync(stubPath, stubSource)
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }))

  const session = await AgentSession.start(project, { cmd: process.execPath, args: [stubPath] })
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
  assert.deepEqual(replayed, first, '새로 붙은 창이 같은 대화를 그대로 본다')
})
