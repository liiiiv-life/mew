import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { WebSocket } from 'ws'
import type { AgentEvent } from './agentAcp.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-history-preview-ws-'))
process.env.MEW_DATA_DIR = path.join(root, 'data')
process.env.MEW_WORKSPACE = root
const stub = path.join(root, 'agent.mjs')
fs.writeFileSync(stub, `import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))};
import fs from 'node:fs';import {Readable,Writable} from 'node:stream';
const root=${JSON.stringify(root)};
new AgentSideConnection(conn=>({
 initialize:async()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{loadSession:true}}),
 newSession:async()=>({sessionId:'new-session'}),
 loadSession:async({sessionId})=>{
   fs.writeFileSync(root+'/'+sessionId+'-entered','');
   while(!fs.existsSync(root+'/'+sessionId+'-release'))await new Promise(resolve=>setTimeout(resolve,10));
   if(sessionId==='failed')throw new RequestError(-32603,'Selected history unavailable');
   await conn.sessionUpdate({sessionId,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Latest question '+sessionId}}});
   await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Latest answer'}}});return{};
 },cancel:async()=>({})
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));`)
process.env.MEW_AGENT_CODEX_CMD = process.execPath
process.env.MEW_AGENT_CODEX_ARGS = stub
const { attachAgentWebSocket } = await import('./agentWs.ts')
const { shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')
const { writeAgentTranscript, closeTranscriptDatabase } = await import('./agentTranscript.ts')

test('authenticated paged WS previews startup and selection beside a gated ACP load, then replaces or recovers', { timeout: 20_000 }, async t => {
  const server = http.createServer()
  attachAgentWebSocket(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agent/ws?runtime=codex&tab=preview&cwd=${encodeURIComponent(root)}&resume=initial&history=1`)
  t.after(async () => {
    ws.terminate()
    shutdownAgentHostsForWorkspace(root)
    server.close()
    closeTranscriptDatabase()
    await new Promise(resolve => setTimeout(resolve, 150))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const messages: { type: string; preview?: { sessionId: string; start: number; events: AgentEvent[] }; page?: { sessionId: string; events: AgentEvent[] }; message?: string }[] = []
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())))
  const saved: AgentEvent[] = []
  for (let i = 0; i < 45; i++) saved.push(
    { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: `Saved question ${i}` } } },
    { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Saved answer ${i}` } } },
  )
  for (const id of ['initial', 'selected', 'failed']) assert.equal(writeAgentTranscript('codex', root, id, saved), true)
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 10_000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Preview timed out; received ${messages.map(message => message.type).join(', ')}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  const initialAt = performance.now()
  await until(() => messages.some(message => message.type === 'history_preview' && message.preview?.sessionId === 'initial'))
  t.diagnostic(`initial server preview: ${Math.round(performance.now() - initialAt)}ms, ACP still gated`)
  const first = messages.find(message => message.type === 'history_preview')!.preview!
  assert.equal(first.start, 50)
  assert.equal(first.events.length, 40)
  assert.equal('generation' in first, false)
  assert.equal(messages.some(message => message.type === 'history'), false)
  await until(() => fs.existsSync(path.join(root, 'initial-entered')))
  fs.writeFileSync(path.join(root, 'initial-release'), '')
  await until(() => messages.some(message => message.type === 'history' && message.page?.sessionId === 'initial'))
  assert.match(JSON.stringify(messages.find(message => message.type === 'history')!.page), /Latest question initial/)
  await until(() => messages.some(message => message.type === 'meta'))

  for (const id of ['selected', 'failed']) {
    const start = messages.length, selectedAt = performance.now()
    ws.send(JSON.stringify({ type: 'load_session', sessionId: id }))
    await until(() => messages.slice(start).some(message => message.type === 'history_preview' && message.preview?.sessionId === id))
    t.diagnostic(`${id} server preview: ${Math.round(performance.now() - selectedAt)}ms, ACP still gated`)
    assert.equal(messages.slice(start).some(message => message.type === 'history'), false)
    await until(() => fs.existsSync(path.join(root, `${id}-entered`)))
    fs.writeFileSync(path.join(root, `${id}-release`), '')
    if (id === 'selected') {
      await until(() => messages.slice(start).some(message => message.type === 'history' && message.page?.sessionId === id))
      assert.match(JSON.stringify(messages.slice(start).find(message => message.type === 'history')!.page), /Latest question selected/)
    } else {
      await until(() => messages.slice(start).some(message => message.type === 'error'))
      assert.equal(messages.slice(start).some(message => message.type === 'history' && message.page?.sessionId === 'failed'), false)
      assert.ok(messages.slice(start).some(message => message.type === 'history' && message.page?.sessionId === 'selected'), 'failed load returns the previous authoritative conversation')
    }
  }
})
