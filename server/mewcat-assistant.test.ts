import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-helper-'))
process.env.MEW_DATA_DIR = path.join(dir, 'data')
process.env.MEW_WORKSPACE = dir
const { bindMewcat } = await import('./mewcat-assistant.ts')
const { relayMewcatRequest } = await import('./mewcat-mcp-stdio.ts')
const { AgentSession } = await import('./agentAcp.ts')
const { planProjectSetup, applyProjectSetup, defaultAgentSettings } = await import('./project-setup.ts')
const { MEWCAT_TOOLS } = await import('../shared/mewcat-assistant.ts')
const sdkUrl = import.meta.resolve('@agentclientprotocol/sdk')

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('Mewcat MCP isolates accounts, checks revoked access, awaits browser results and preserves projects', async t => {
  let authorized = true, owner = true
  const options = { account: 'owner@test', browser: 'flow', runtime: 'codex', authorized: () => authorized, owner: () => owner, send: (_message: unknown) => {} }
  const binding = await bindMewcat(options)
  t.after(() => { binding.disconnect(); binding.server.close() })
  binding.handle({ type: 'mewcat_context', context: { projectRoot: dir, locale: 'ko' } })
  assert.match(binding.prompt('메모 앱'), /UI language \(ko\)/)
  const list = JSON.parse(await relayMewcatRequest(binding.socketPath, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })))
  assert.equal(list.result.tools.length, MEWCAT_TOOLS.length)
  assert.ok(!list.result.tools.some((tool: { name: string }) => /delete|restart|deploy/.test(tool.name)))
  const help = await binding.tool('mew_get_help', { topic: 'mewcat' }) as { source: string; text: string }
  assert.equal(help.source, 'docs/features/화면·계정·운영/뮤캣 도우미·대화·Mew 조작.md')
  assert.match(help.text, /## 상세 동작/)
  assert.match(help.text, /### 자동 MCP/)
  const created = await binding.tool('mew_create_project', { parent: dir, name: 'notes' }) as { path: string }
  assert.equal(created.path, path.join(dir, 'notes'))
  await assert.rejects(binding.tool('mew_create_project', { parent: dir, name: 'notes' }))
  await assert.rejects(binding.tool('mew_create_project', { parent: dir, name: '../escape' }))
  await binding.tool('mew_setup_documents', { projectRoot: created.path })
  assert.match(fs.readFileSync(path.join(created.path, 'docs/MOC.md'), 'utf8'), /문서 지도/)
  fs.writeFileSync(path.join(created.path, 'README.md'), 'User project truth')
  await binding.tool('mew_setup_documents', { projectRoot: created.path })
  assert.equal(fs.readFileSync(path.join(created.path, 'README.md'), 'utf8'), 'User project truth')
  const legacy = path.join(dir, 'legacy')
  fs.mkdirSync(path.join(legacy, '.mew/docs'), { recursive: true })
  fs.writeFileSync(path.join(legacy, '.mew/docs/MOC.md'), 'Legacy document map')
  await binding.tool('mew_setup_documents', { projectRoot: legacy })
  assert.equal(fs.existsSync(path.join(legacy, 'docs')), false)
  assert.equal(fs.readFileSync(path.join(legacy, '.mew/docs/MOC.md'), 'utf8'), 'Legacy document map')
  let actionId = ''
  options.send = (message: unknown) => { actionId = (message as { id: string }).id }
  let completed = false
  const opening = binding.tool('mew_open_project', { path: created.path }).then(value => { completed = true; return value })
  await Promise.resolve()
  assert.equal(completed, false)
  binding.handle({ type: 'mewcat_action_result', id: 'foreign-request', ok: true })
  assert.equal(completed, false)
  binding.handle({ type: 'mewcat_action_result', id: actionId, ok: true })
  assert.deepEqual(await opening, { path: created.path, opened: true })
  owner = false
  await assert.rejects(binding.tool('mew_create_project', { parent: dir, name: 'denied' }), /MEWCAT_FORBIDDEN/)
  assert.equal(fs.existsSync(path.join(dir, 'denied')), false)
  owner = true
  const pending = binding.tool('mew_open_project', { path: created.path })
  authorized = false
  assert.throws(() => binding.handle({ type: 'mewcat_action_result', id: actionId, ok: true }), /MEWCAT_DISCONNECTED/)
  binding.disconnect()
  await assert.rejects(pending, /MEWCAT_DISCONNECTED/)
  await assert.rejects(binding.tool('mew_get_context', {}), /MEWCAT_DISCONNECTED/)
  const other = await bindMewcat({ ...options, account: 'another@test', authorized: () => true })
  t.after(() => { other.disconnect(); other.server.close() })
  assert.notEqual(binding.tab, other.tab)
  assert.notEqual(binding.cwd, other.cwd)
})

test('Mewcat MCP stdio handles concurrent JSON-RPC messages without touching runtime settings', async t => {
  const binding = await bindMewcat({ account: 'stdio@test', browser: 'stdio', runtime: 'claude', authorized: () => true, owner: () => true, send() {} })
  t.after(() => { binding.disconnect(); binding.server.close() })
  const server = binding.mcpServers[0]
  assert.ok('command' in server)
  const child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  let output = ''
  child.stdout.setEncoding('utf8')
  const received = new Promise<void>(resolve => child.stdout.on('data', chunk => { output += chunk; if (output.split('\n').filter(Boolean).length === 2) resolve() }))
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  for (const [id, method] of [[1, 'initialize'], [2, 'tools/list']] as const) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { protocolVersion: '2025-11-25' } }) + '\n')
  await received
  const messages = output.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(messages.find(message => message.id === 1).result.protocolVersion, '2025-11-25')
  assert.equal(messages.find(message => message.id === 2).result.tools.length, MEWCAT_TOOLS.length)
})

test('ACP automatically receives Mew MCP on new, clear and restored sessions', async t => {
  const adapter = path.join(dir, 'adapter.mjs')
  const received = path.join(dir, 'received.jsonl')
  fs.writeFileSync(adapter, `
import fs from 'node:fs';
import {AgentSideConnection,ndJsonStream,PROTOCOL_VERSION} from ${JSON.stringify(sdkUrl)};
import {Readable,Writable} from 'node:stream';
const record=(method,params)=>fs.appendFileSync(${JSON.stringify(received)},JSON.stringify({method,...params})+'\\n');
new AgentSideConnection(conn=>({
 initialize:async()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{loadSession:true}}),
 newSession:async params=>{record('new',params);return {sessionId:'mewcat-session'}},
 loadSession:async params=>{record('load',params);return {}},
 prompt:async({sessionId})=>{await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Ready'}}});return {stopReason:'end_turn'}},cancel:async()=>{}
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
`)
  const mcpServers = [{ name: 'mew', command: process.execPath, args: ['test-mcp.ts'], env: [] }]
  const session = await AgentSession.start('codex', { cmd: process.execPath, args: [adapter] }, dir, undefined, undefined, undefined, { mcpServers })
  t.after(() => session.disposeAndWait())
  await session.loadSession('restored-session')
  session.clearAfterQueue()
  const deadline = Date.now() + 5000
  while (fs.readFileSync(received, 'utf8').trim().split('\n').length < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  const requests = fs.readFileSync(received, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(requests.map(request => request.method), ['new', 'load', 'new'])
  for (const request of requests) assert.deepEqual(request.mcpServers, mcpServers)
})

test('Localized document templates preserve existing files and locale belongs to preview revision', () => {
  for (const [locale, title] of [['en', 'Documentation map'], ['ko', '문서 지도'], ['ja', '文書マップ'], ['zh-CN', '文档地图']]) {
    const root = path.join(dir, locale)
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(root, 'README.md'), 'Existing README')
    const input = { projectRoot: root, settings: defaultAgentSettings('docs'), initDocs: true, locale }
    const plan = planProjectSetup(input)
    assert.throws(() => applyProjectSetup({ ...input, locale: locale === 'en' ? 'ko' : 'en' }, plan.revision))
    applyProjectSetup(input, plan.revision)
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'Existing README')
    assert.match(fs.readFileSync(path.join(root, 'docs/MOC.md'), 'utf8'), new RegExp(title))
  }
})
