// 에이전트 창 WS — 에이전트가 뜨는 데 걸리는 시간이 창을 세우지 않는지 본다.
// 진짜 Claude를 부르지 않는다: 일부러 늦게 뜨는 가짜 에이전트를 붙인다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'

// paths.ts가 import 시점에 MEW_WORKSPACE를 읽으므로 먼저 심고 동적 import
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agentws-'))
process.env.MEW_WORKSPACE = workspace

const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agentws-stub-'))
const stubPath = path.join(stubDir, 'stub.mjs')
fs.writeFileSync(
  stubPath,
  `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdkUrl)}
import { Readable, Writable } from 'node:stream'

class SlowAgent {
  constructor(conn) { this.conn = conn }
  async initialize() {
    // 진짜 어댑터는 뜨는 데 1초가 넘게 걸린다 — 그 사이를 흉내 낸다
    await new Promise((r) => setTimeout(r, 300))
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }
  }
  async newSession() { return { sessionId: 'stub-ws' } }
  async authenticate() { return {} }
  async cancel() {}
  async prompt({ sessionId, prompt }) {
    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '받음:' + prompt[0].text } } })
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
process.env.MEW_AGENT_ARGS = stubPath

const { AGENT_WS_PATH, attachAgentWebSocket } = await import('./agentWs.ts')
const { disposeAllSessions } = await import('./agentAcp.ts')

test('에이전트가 뜨기 전에 보낸 질문도 잃지 않고, 목록은 물어본 창에만 먼저 간다', async (t) => {
  const server = http.createServer()
  attachAgentWebSocket(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }

  t.after(() => {
    disposeAllSessions()
    server.close()
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(stubDir, { recursive: true, force: true })
  })

  const ws = new WebSocket(`ws://127.0.0.1:${port}${AGENT_WS_PATH}?tab=slow-tab`)
  const kinds: string[] = []
  const answered = new Promise<string>((resolve) => {
    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString()) as { type: string; update?: { sessionUpdate: string; content?: { text?: string } } }
      kinds.push(event.type)
      if (event.type === 'update' && event.update?.sessionUpdate === 'agent_message_chunk')
        resolve(event.update.content?.text ?? '')
    })
  })
  // 붙자마자 — 세션은 아직 뜨는 중이다
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'prompt', text: '안녕' }))
    ws.send(JSON.stringify({ type: 'list_sessions' }))
  })

  assert.equal(await answered, '받음:안녕', '뜨기 전에 보낸 질문이 뜬 뒤에 그대로 실행된다')
  assert.equal(kinds[0], 'ready', 'ready는 에이전트를 기다리지 않는다')
  assert.ok(kinds.indexOf('sessions') < kinds.indexOf('meta'), '세션 목록은 디스크만 읽으므로 meta보다 먼저 온다')
  assert.equal(kinds.filter((k) => k === 'sessions').length, 1, '목록은 물어본 만큼만 간다(붙을 때 미리 보내지 않는다)')
  // 되감기는 붙을 때 한 프레임으로 딱 한 번 — 그 뒤 이벤트는 개별로 흐른다
  assert.equal(kinds.filter((k) => k === 'replay').length, 1, '지나간 대화는 한 덩어리로 한 번만 온다')
  assert.ok(kinds.indexOf('replay') < kinds.indexOf('update'), '되감기가 새 이벤트보다 먼저 온다')
  ws.close()
})
