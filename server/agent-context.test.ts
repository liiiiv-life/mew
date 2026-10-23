import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSession, type AgentEvent } from './agentAcp.ts'
import { captureAgentContext, restoreAgentContext } from './agent-context.ts'
import { defaultAgentSettings, writeProjectAgentSettings } from './project-agent-settings.ts'
import { stripMewContext } from './project-context-text.ts'
import { setWorkspaceRoot, WORKSPACE_ROOT } from './paths.ts'
import { agentGuidanceSettings, updateAgentGuidance } from './agent-guidance.ts'
import { guidanceOptions } from '../shared/agent-guidance.ts'

test('ACP context follows session across queue, project switch, clear, resume and display replay', { timeout: 15_000 }, async t => {
  const previousRoot = WORKSPACE_ROOT
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-context-'))
  const a = path.join(root, 'a'), b = path.join(root, 'b'), cwd = path.join(a, 'repo')
  for (const dir of [cwd, path.join(a, 'notes'), path.join(a, 'new-notes'), path.join(b, 'docs')]) fs.mkdirSync(dir, { recursive: true })
  writeProjectAgentSettings(a, { ...defaultAgentSettings('notes'), instructions: 'A-specific guidance' })
  writeProjectAgentSettings(b, { ...defaultAgentSettings(), instructions: 'B-specific guidance' })
  setWorkspaceRoot(a)
  assert.equal(captureAgentContext(cwd).projectRoot, a)
  const log = path.join(root, 'calls.jsonl'), stub = path.join(root, 'agent.mjs')
  const sdk = import.meta.resolve('@agentclientprotocol/sdk')
  fs.writeFileSync(stub, `
import fs from 'node:fs'
import crypto from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(sdk)}
const log = ${JSON.stringify(log)}
class Agent {
  constructor(conn) { this.conn = conn }
  async initialize() { return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true } } }
  async newSession() { return { sessionId: crypto.randomUUID() } }
  async cancel() {}
  async loadSession({ sessionId }) {
    for (const call of fs.readFileSync(log, 'utf8').trim().split('\\n').map(s => JSON.parse(s)).filter(c => c.sessionId === sessionId)) {
      await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: call.prompt.map(p => p.text).join('\\n\\n') } } })
      await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } } })
    }
    return {}
  }
  async prompt({ sessionId, prompt }) {
    fs.appendFileSync(log, JSON.stringify({ sessionId, prompt }) + '\\n')
    await new Promise(resolve => setTimeout(resolve, 30))
    await this.conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } } })
    return { stopReason: 'end_turn' }
  }
}
new AgentSideConnection(conn => new Agent(conn), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
`)
  const spec = { cmd: process.execPath, args: [stub] }
  const sessions: AgentSession[] = []
  t.after(async () => { for (const session of sessions) await session.disposeAndWait(); setWorkspaceRoot(previousRoot); fs.rmSync(root, { recursive: true, force: true }) })
  const session = await AgentSession.start('claude', spec, cwd)
  sessions.push(session)
  const events: AgentEvent[] = []
  session.attach(event => events.push(event))
  const oldId = session.sessionId
  session.prompt('first')
  session.prompt('queued')
  setWorkspaceRoot(b)
  const waitIdle = async (expectedCalls: number) => {
    const until = Date.now() + 7000
    while (session.busy || fs.readFileSync(log, 'utf8').trim().split('\n').length < expectedCalls) {
      assert.ok(Date.now() < until)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  await waitIdle(2)
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(calls().length, 2)
  for (const call of calls()) {
    assert.equal(call.prompt.length, 2)
    assert.match(call.prompt[1].text, /A-specific guidance/)
    assert.doesNotMatch(call.prompt[1].text, /Local RAG|server\/rag\/cli|MEW_RAG/)
    assert.ok(!call.prompt[1].text.includes('B-specific guidance'))
    assert.ok(call.prompt[1].text.includes(path.join(a, 'notes')))
  }
  assert.ok(!JSON.stringify(events).includes('<mew-context'))
  const guidance = agentGuidanceSettings()
  updateAgentGuidance({ key: 'subagents', value: 'automatic', revision: guidance.revision })
  writeProjectAgentSettings(a, { ...defaultAgentSettings('new-notes'), instructions: 'A updated' })
  await session.runOnce('same-session')
  await waitIdle(3)
  assert.ok(calls().at(-1).prompt[1].text.includes(guidanceOptions.subagents.automatic), 'the next ACP request receives the updated delegation policy without restarting the session')
  assert.ok(!JSON.stringify(events).includes(guidanceOptions.subagents.automatic), 'guidance stays out of the displayed transcript')
  assert.ok(calls().at(-1).prompt[1].text.includes(path.join(a, 'notes')))
  session.clearAfterQueue()
  session.prompt('after-clear')
  await waitIdle(4)
  assert.notEqual(session.sessionId, oldId)
  assert.ok(calls().at(-1).prompt[1].text.includes(path.join(a, 'new-notes')))
  assert.equal(restoreAgentContext('claude', cwd, oldId)?.docsRoot, path.join(a, 'notes'))
  await session.disposeAndWait()
  const resumed = await AgentSession.start('claude', spec, cwd)
  sessions.push(resumed)
  await resumed.loadSession(oldId)
  assert.ok(!JSON.stringify(resumed.snapshot()).includes('<mew-context'))
  await resumed.runOnce('resumed')
  assert.ok(calls().at(-1).prompt[1].text.includes(path.join(a, 'notes')))
  writeProjectAgentSettings(a, { ...defaultAgentSettings('new-notes'), enabled: false })
  await new Promise(resolve => setTimeout(resolve, 20))
  await resumed.runOnce('disabled')
  assert.equal(calls().at(-1).prompt.length, 1)
})

test('context display filtering preserves ordinary messages and removes separate or joined guidance', () => {
  const block = '<mew-context version="1">\ninternal\n</mew-context>'
  assert.equal(stripMewContext('  original  '), '  original  ')
  assert.equal(stripMewContext(`original\n\n${block}`), 'original')
  assert.equal(stripMewContext(block), '')
})
