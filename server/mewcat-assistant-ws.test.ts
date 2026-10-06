import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { WebSocket } from 'ws'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-catws-'))
process.env.MEW_WORKSPACE = dir
process.env.MEW_DATA_DIR = path.join(dir, 'data')
const adapter = path.join(dir, 'adapter.mjs')
const sdk = import.meta.resolve('@agentclientprotocol/sdk')
fs.writeFileSync(adapter, `
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {AgentSideConnection,ndJsonStream,PROTOCOL_VERSION} from ${JSON.stringify(sdk)};
import {Readable,Writable} from 'node:stream';
let mcp, sequence=0;const waiting=new Map();
const call=(method,params={})=>new Promise(resolve=>{const id=++sequence;waiting.set(id,resolve);mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n')});
new AgentSideConnection(conn=>({
 initialize:async()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{}}),
 newSession:async({mcpServers})=>{
   if(mcpServers.length!==1||mcpServers[0].name!=='mew')throw new Error('Missing automatic MCP');
   const server=mcpServers[0];mcp=spawn(server.command,server.args,{stdio:['pipe','pipe','inherit']});
   readline.createInterface({input:mcp.stdout}).on('line',line=>{const m=JSON.parse(line);waiting.get(m.id)?.(m.result);waiting.delete(m.id)});
   await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
   return {sessionId:'mewcat-ws-session'};
 },
 prompt:async({sessionId,prompt})=>{
   const context=await call('tools/call',{name:'mew_get_context',arguments:{}});
   const current=JSON.parse(context.content[0].text);
   if(current.locale!=='ko'||!prompt[0].text.includes('You are Mewcat'))throw new Error('Missing assistant context');
   const created=await call('tools/call',{name:'mew_create_project',arguments:{parent:current.projectRoot,name:'notes'}});
   const project=JSON.parse(created.content[0].text).path;
   const docs=await call('tools/call',{name:'mew_setup_documents',arguments:{projectRoot:project}});
   const opened=await call('tools/call',{name:'mew_open_project',arguments:{path:project}});
   if(docs.isError||opened.isError)throw new Error('Mew action failed');
   await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'프로젝트 준비 완료:'+project}}});
   return {stopReason:'end_turn'};
 },cancel:async()=>{}
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
`)
process.env.MEW_AGENT_CMD = process.execPath
process.env.MEW_AGENT_ARGS = adapter
const { attachAgentWebSocket } = await import('./agentWs.ts')
const { authorizeFeature } = await import('./reqAuth.ts')
const { upsertUser, createSession } = await import('./auth.ts')
const { shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')
upsertUser('owner@test', { hash: 'fixture', role: 'owner', mustChangePassword: false, createdAt: Date.now(), passwordChangedAt: 0 })
const token = createSession('owner@test')

test('Authenticated Mewcat websocket injects MCP into its supervisor and completes project creation and browser navigation', { timeout: 15_000 }, async t => {
  const server = http.createServer()
  attachAgentWebSocket(server, { authorize: authorizeFeature('agent') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/agent/ws?runtime=claude&mewcat=flow&tab=ignored`, { headers: { Cookie: `mew_session=${token}` } })
  let hostCwd = ''
  const events: string[] = []
  const actions: unknown[] = []
  const answer = new Promise<string>((resolve, reject) => {
    ws.on('error', reject)
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString())
      events.push(event.type)
      if (event.type === 'ready') {
        hostCwd = event.cwd
        ws.send(JSON.stringify({ type: 'mewcat_context', context: { projectRoot: dir, locale: 'ko' } }))
        ws.send(JSON.stringify({ type: 'prompt', text: '메모 앱을 만들고 싶어' }))
      }
      if (event.type === 'mewcat_action') {
        actions.push(event.action)
        ws.send(JSON.stringify({ type: 'mewcat_context', context: { projectRoot: event.action.path, locale: 'ko' } }))
        ws.send(JSON.stringify({ type: 'mewcat_action_result', id: event.id, ok: true }))
      }
      if (event.type === 'update' && event.update.sessionUpdate === 'agent_message_chunk') resolve(event.update.content.text)
      if (event.type === 'error' || event.type === 'fatal') reject(new Error(event.message))
    })
  })
  t.after(() => {
    ws.terminate(); server.close()
    if (hostCwd) shutdownAgentHostsForWorkspace(hostCwd)
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 200)
  })
  assert.equal(await answer, `프로젝트 준비 완료:${dir}/notes`)
  assert.deepEqual(actions, [{ kind: 'open_project', path: `${dir}/notes` }])
  assert.match(hostCwd, /data\/mewcat\//)
  assert.match(fs.readFileSync(`${dir}/notes/docs/README.md`, 'utf8'), /description/)
  assert.equal(fs.existsSync(`${dir}/notes/docs/MOC.md`), false)
  assert.ok(events.includes('meta'))
})
