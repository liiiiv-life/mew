import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { createPrivateIpcServer, listenPrivateIpc, ipcEndpoint } from './platform/index.ts'
import { WebSocket } from 'ws'
import { expandHistoryWork, type HistoryPage } from '../shared/agent-history.ts'
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
 loadSession:async({sessionId})=>{if(sessionId==='history-byte-budget'){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Budget question'}}});for(const size of [1200000,600000,600000,8*1024*1024+1])await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'x'.repeat(size)}}});await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Budget answer'}}});return{}}for(let i=0;i<45;i++){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'q'+i}}});await conn.sessionUpdate({sessionId,update:{sessionUpdate:'tool_call',toolCallId:'saved-'+i,title:'Read fixture',status:'completed',rawInput:{body:'x'.repeat(1000)},rawOutput:{body:'y'.repeat(1000)}}});await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'a'+i}}})}return{}},
 prompt:async({sessionId})=>{await conn.sessionUpdate({sessionId,update:{sessionUpdate:'tool_call',toolCallId:'live-tool',title:'Run fixture',status:'pending',rawInput:{body:'x'.repeat(1000)}}});await conn.sessionUpdate({sessionId,update:{sessionUpdate:'tool_call_update',toolCallId:'live-tool',status:'completed',rawOutput:{body:'y'.repeat(1000)}}});await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'live'}}});return{stopReason:'end_turn'}},
 cancel:async()=>({})
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));`)
process.env.MEW_AGENT_CODEX_CMD = process.execPath
process.env.MEW_AGENT_CODEX_ARGS = stub
const { attachAgentWebSocket } = await import('./agentWs.ts')
const { connectAgentHost, shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')
const { readAgentTranscript, closeTranscriptDatabase } = await import('./agentTranscript.ts')

test('WS negotiates paged history, live sequence and reconnect delta without full replay', { timeout: 20_000 }, async t => {
  const server = http.createServer()
  attachAgentWebSocket(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const sockets: WebSocket[] = []
  t.after(async () => {
    sockets.forEach(socket => socket.terminate())
    shutdownAgentHostsForWorkspace(root)
    closeTranscriptDatabase()
    server.close()
    await new Promise(resolve => setTimeout(resolve, 150))
    fs.rmSync(root, { recursive: true, force: true })
  })
  function connect(extra = '', paged = true) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agent/ws?runtime=codex&tab=history&cwd=${encodeURIComponent(root)}&resume=history-session${paged ? '&history=1' : ''}${extra}`)
    sockets.push(ws)
    const messages: any[] = []
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())))
    return { ws, messages }
  }
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 10_000
    while (!predicate()) { if (Date.now() > deadline) throw new Error('history timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  function displayTools(events: AgentEvent[]) {
    const tools = events.filter(event => event.type === 'update' && ['tool_call', 'tool_call_update'].includes(event.update.sessionUpdate))
    assert.ok(tools.length > 0)
    for (const tool of tools) if (tool.type === 'update') {
      assert.equal('rawInput' in tool.update, false)
      assert.equal('rawOutput' in tool.update, false)
    }
  }
  const first = connect()
  await until(() => first.messages.some(item => item.type === 'history'))
  const page = first.messages.find(item => item.type === 'history').page as HistoryPage<AgentEvent>
  assert.equal(page.usersBefore, 25)
  assert.equal(page.events.filter(event => event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk').length, 20)
  assert.ok(!first.messages.some(item => item.type === 'replay'))
  displayTools(page.events)
  const stored = readAgentTranscript('codex', root, 'history-session')!
  assert.ok(stored.some(event => event.type === 'update' && 'rawOutput' in event.update), 'wire projection leaves the saved ACP tool record intact')
  first.ws.send(JSON.stringify({ type: 'history', range: { generation: page.generation, before: page.start } }))
  await until(() => first.messages.filter(item => item.type === 'history').length === 2)
  const older = first.messages.filter(item => item.type === 'history')[1].page as HistoryPage<AgentEvent>
  assert.equal(older.mode, 'prepend')
  assert.equal(older.end, page.start)
  assert.equal(older.usersBefore, 5)
  displayTools(older.events)
  const lazy = connect('&deferWork=1&turns=3')
  await until(() => lazy.messages.some(item => item.type === 'history'))
  const initial = lazy.messages.find(item => item.type === 'history').page as HistoryPage<AgentEvent>
  assert.equal(initial.usersBefore, 42)
  assert.equal(expandHistoryWork(initial.events).length, initial.end - initial.start)
  assert.ok(initial.events.some(event => event.type === 'work_pending'))
  assert.ok(!initial.events.some(event => event.type === 'update' && event.update.sessionUpdate === 'tool_call'))
  const detailsRange = { generation: initial.generation, start: initial.start, end: initial.end }
  lazy.ws.send(JSON.stringify({ type: 'history_details', requestId: 'details', ...detailsRange }))
  await until(() => lazy.messages.some(item => item.type === 'history_details' && item.requestId === 'details'))
  const details = lazy.messages.find(item => item.type === 'history_details' && item.requestId === 'details')
  assert.deepEqual(details, { type: 'history_details', requestId: 'details', ...detailsRange,
    events: page.events.slice(initial.start - page.start) })
  displayTools(details.events)
  for (const [requestId, range] of [
    ['stale', { ...detailsRange, generation: 'old-generation' }],
    ['oversized', { ...detailsRange, end: initial.start + 257 }],
    ['missing', { ...detailsRange, start: initial.end, end: initial.end + 1 }],
  ] as const) {
    lazy.ws.send(JSON.stringify({ type: 'history_details', requestId, ...range }))
    await until(() => lazy.messages.some(item => item.type === 'history_details' && item.requestId === requestId))
    const rejected = lazy.messages.find(item => item.type === 'history_details' && item.requestId === requestId)
    assert.ok(rejected.error)
    assert.deepEqual({ generation: rejected.generation, start: rejected.start, end: rejected.end }, range)
  }
  let ipcHistory: HistoryPage<AgentEvent> | null = null
  const ipc = await connectAgentHost('codex', 'history', root, { history: { turns: 3, deferWork: true }, onHistory: value => { ipcHistory = value } })
  t.after(() => ipc.close())
  await until(() => ipcHistory !== null)
  assert.deepEqual(ipcHistory, initial, 'work is deferred before supervisor IPC serialization')
  const ipcDetails = await ipc.request<{ events: AgentEvent[] }>({ type: 'history_details', range: detailsRange })
  displayTools(ipcDetails.events)
  const oldTab = 'old-history'
  const digest = crypto.createHash('sha256').update(`${root}\0codex\0${oldTab}`).digest('hex').slice(0, 24)
  const hostDirectory = path.join(root, 'data', 'agent')
  const endpoint = ipcEndpoint(path.join(hostDirectory, `codex-${digest}.sock`))
  let subscribed: any = null
  const oldServer = createPrivateIpcServer(endpoint, hostDirectory, socket => {
    socket.write(`${JSON.stringify({ type: 'hello', runtime: 'codex', tab: oldTab, cwd: root, history: true })}\n`)
    socket.once('data', chunk => {
      subscribed = JSON.parse(String(chunk).trim())
      socket.write(`${JSON.stringify({ type: 'history', page })}\n`)
    })
  })
  await listenPrivateIpc(oldServer, endpoint)
  const oldClient = await connectAgentHost('codex', oldTab, root, { history: { deferWork: true, turns: 3, generation: page.generation, after: page.end } })
  t.after(() => { oldClient.close(); oldServer.close() })
  await until(() => subscribed !== null)
  assert.equal(oldClient.workDetails, false)
  assert.deepEqual(subscribed.history, { generation: page.generation, after: page.end }, 'old supervisors retain their complete history transport')
  let budgetPage: HistoryPage<AgentEvent> | null = null
  const budgetClient = await connectAgentHost('codex', 'history-budget', root, {
    history: { turns: 3, deferWork: true }, onHistory: value => { budgetPage = value },
  }, 'history-byte-budget')
  t.after(() => budgetClient.close())
  await until(() => budgetPage !== null)
  const budgetStart = budgetPage!.start + expandHistoryWork(budgetPage!.events).findIndex(event => event.type === 'work_pending')
  const budgetRange = { generation: budgetPage!.generation, start: budgetStart, end: budgetStart + 3 }
  const firstChunk = await budgetClient.request<{ end: number; events: AgentEvent[] }>({ type: 'history_details', range: budgetRange })
  assert.equal(firstChunk.end, budgetStart + 1, 'one large first event is returned without losing its sequence position')
  assert.equal(firstChunk.events.length, 1)
  const nextChunk = await budgetClient.request<{ end: number; events: AgentEvent[] }>({ type: 'history_details', range: { ...budgetRange, start: firstChunk.end } })
  assert.equal(nextChunk.end, budgetStart + 2, 'the 1MiB target splits later events at event boundaries')
  await assert.rejects(budgetClient.request({ type: 'history_details', range: { ...budgetRange, start: budgetStart + 3, end: budgetStart + 4 } }), /8MiB/)
  const legacy = connect('', false)
  await until(() => legacy.messages.some(item => item.type === 'replay'))
  displayTools(legacy.messages.find(item => item.type === 'replay').events)
  first.ws.send(JSON.stringify({ type: 'prompt', text: 'next' }))
  await until(() => first.messages.some(item => item.type === 'history_event' && item.event.type === 'turn_end'))
  const streamed = first.messages.filter(item => item.type === 'history_event')
  displayTools(streamed.map(item => item.event))
  await until(() => legacy.messages.some(item => item.type === 'turn_end'))
  displayTools(legacy.messages.filter(item => item.type === 'update'))
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
