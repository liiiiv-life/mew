import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { WebSocket } from 'ws'
import type { HistoryPage } from '../shared/agent-history.ts'
import type { AgentEvent } from './agentAcp.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-history-test-'))
process.env.MEW_DATA_DIR = path.join(root, 'data')
process.env.MEW_WORKSPACE = root
const stub = path.join(root, 'agent.mjs')
fs.writeFileSync(stub, `import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))};
import { Readable, Writable } from 'node:stream';
new AgentSideConnection(conn=>({
 initialize:async()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{loadSession:true}}),
 newSession:async()=>({sessionId:'history-session'}),
 loadSession:async({sessionId})=>{for(let i=0;i<45;i++){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'q'+i}}});await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'a'+i}}})}return{}},
 prompt:async({sessionId})=>{await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'live'}}});return{stopReason:'end_turn'}},
 cancel:async()=>({})
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));`)
process.env.MEW_AGENT_CODEX_CMD = process.execPath
process.env.MEW_AGENT_CODEX_ARGS = stub
const { attachAgentWebSocket } = await import('./agentWs.ts')
const { shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')

test('WS negotiates paged history, live sequence and reconnect delta without full replay', { timeout: 20_000 }, async t => {
  const server = http.createServer()
  attachAgentWebSocket(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const sockets: WebSocket[] = []
  t.after(async () => {
    sockets.forEach(socket => socket.terminate())
    shutdownAgentHostsForWorkspace(root)
    server.close()
    await new Promise(resolve => setTimeout(resolve, 150))
    fs.rmSync(root, { recursive: true, force: true })
  })
  function connect(extra = '') {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agent/ws?runtime=codex&tab=history&cwd=${encodeURIComponent(root)}&resume=history-session&history=1${extra}`)
    sockets.push(ws)
    const messages: any[] = []
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())))
    return { ws, messages }
  }
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 10_000
    while (!predicate()) { if (Date.now() > deadline) throw new Error('history timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  const first = connect()
  await until(() => first.messages.some(item => item.type === 'history'))
  const page = first.messages.find(item => item.type === 'history').page as HistoryPage<AgentEvent>
  assert.equal(page.usersBefore, 25)
  assert.equal(page.events.filter(event => event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk').length, 20)
  assert.ok(!first.messages.some(item => item.type === 'replay'))
  first.ws.send(JSON.stringify({ type: 'history', range: { generation: page.generation, before: page.start } }))
  await until(() => first.messages.filter(item => item.type === 'history').length === 2)
  const older = first.messages.filter(item => item.type === 'history')[1].page as HistoryPage<AgentEvent>
  assert.equal(older.mode, 'prepend')
  assert.equal(older.end, page.start)
  assert.equal(older.usersBefore, 5)
  first.ws.send(JSON.stringify({ type: 'prompt', text: 'next' }))
  await until(() => first.messages.some(item => item.type === 'history_event' && item.event.type === 'turn_end'))
  const streamed = first.messages.filter(item => item.type === 'history_event')
  assert.deepEqual(streamed.map(item => item.position.seq), streamed.map((_, i) => page.end + i))
  first.ws.close()
  const second = connect(`&generation=${page.generation}&after=${page.end}`)
  await until(() => second.messages.some(item => item.type === 'history'))
  const delta = second.messages.find(item => item.type === 'history').page as HistoryPage<AgentEvent>
  assert.equal(delta.mode, 'append')
  assert.deepEqual(delta.events, streamed.map(item => item.event))
  second.ws.send(JSON.stringify({ type: 'clear_session' }))
  await until(() => second.messages.some(item => item.type === 'reset'))
  second.ws.send(JSON.stringify({ type: 'history', range: { generation: page.generation, after: delta.end } }))
  await until(() => second.messages.filter(item => item.type === 'history').length === 2)
  const fresh = second.messages.filter(item => item.type === 'history')[1].page as HistoryPage<AgentEvent>
  assert.equal(fresh.mode, 'replace')
  assert.notEqual(fresh.generation, page.generation)
})
