import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

test('real detached ACP host applies preset before dispatch and records results through the common CLI', { timeout: 20_000 }, async t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-host-')))
  const workspace = path.join(temporary, 'project'), config = path.join(temporary, 'request.json'), stub = path.join(temporary, 'agent.mjs')
  fs.mkdirSync(workspace); fs.mkdirSync(path.join(workspace, 'custom-docs'))
  process.env.MEW_WORKSPACE = workspace; process.env.MEW_DATA_DIR = path.join(temporary, 'data')
  process.env.MEW_AGENT_CODEX_CMD = process.execPath; process.env.MEW_AGENT_CODEX_ARGS = `${stub} ${config}`
  const sdk = import.meta.resolve('@agentclientprotocol/sdk')
  fs.writeFileSync(stub, `
import {AgentSideConnection, ndJsonStream, PROTOCOL_VERSION} from ${JSON.stringify(sdk)};
import {Readable, Writable} from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
class Agent {
  model = 'default';
  async initialize() { return {protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}} }
  async newSession() { return {sessionId: 'feature-host-session', models: {currentModelId: this.model, availableModels: [{modelId: 'default', name: 'Default'}, {modelId: 'selected', name: 'Selected'}]}} }
  async unstable_setSessionModel({modelId}) { await new Promise(resolve => setTimeout(resolve, 80)); this.model = modelId; return {} }
  async prompt({prompt}) {
    const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const text = prompt.filter(block => block.type === 'text').map(block => block.text).join('\\n');
    fs.writeFileSync(path.join(cfg.workspace, 'observed.json'), JSON.stringify({model: this.model, text}));
    if (this.model !== 'selected') throw new Error('wrong model');
    const call = (command, input) => JSON.parse(execFileSync(process.execPath, [cfg.cli, cfg.directory, cfg.workspace, cfg.id, command], {encoding: 'utf8', input: input ? JSON.stringify(input) : undefined}));
    call('list');
    call('assign', {action: 'new', title: 'Generated feature', content: 'Requested requirements', reason: 'Independent feature'});
    fs.writeFileSync(path.join(cfg.workspace, 'result.ts'), 'export const done = true');
    call('report', {summary: 'Implemented fixture', validation: 'Fixture check', files: ['result.ts'], commits: []});
    return {stopReason: 'end_turn'};
  }
  async cancel() {}
}
new AgentSideConnection(() => new Agent(), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
`)
  const { FeatureStore } = await import('./features.ts')
  const { FeatureService } = await import('./feature-service.ts')
  const { shutdownAgentHostsForWorkspace, connectExistingAgentHost } = await import('./agentHost.ts')
  const store = new FeatureStore(path.join(temporary, 'features'))
  const service = new FeatureService(store, undefined, undefined, () => true)
  t.after(async () => {
    service.stop(); shutdownAgentHostsForWorkspace(workspace)
    await new Promise(resolve => setTimeout(resolve, 250))
    fs.rmSync(temporary, { recursive: true, force: true })
  })
  const set = { id: crypto.randomUUID(), name: 'Any preset', runtime: 'codex', modelId: 'selected', role: 'Only build requested features.' }
  const run = await store.request(workspace, 'fixture', { id: crypto.randomUUID(), title: 'Feature', content: 'Requested requirements', agentSetId: set.id }, set, { projectRoot: workspace, docsRoot: path.join(workspace, 'custom-docs') })
  fs.writeFileSync(config, JSON.stringify({ id: run.id, workspace, directory: store.directory, cli: path.join(import.meta.dirname, 'feature-cli.ts') }))
  await service.pump(workspace)
  const deadline = Date.now() + 12_000
  while (!['completed', 'failed'].includes(store.read(workspace).runs[0].state) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  const result = store.read(workspace)
  assert.equal(result.runs[0].state, 'completed', JSON.stringify(result.runs[0]))
  assert.equal(result.features[0].status, 'implemented')
  assert.deepEqual(result.runs[0].report?.files, ['result.ts'])
  assert.ok(result.runs[0].dispatchedAt)
  const observed = JSON.parse(fs.readFileSync(path.join(workspace, 'observed.json'), 'utf8'))
  assert.equal(observed.model, 'selected')
  assert.match(observed.text, /mew-feature-request/)
  assert.ok(observed.text.includes(path.join(workspace, 'custom-docs')))
  // Conversation opens on the same live host and replays the implementation turn.
  let replayed = false
  const conversation = await connectExistingAgentHost('codex', run.tabId, workspace, { onReplay: events => { replayed = events.some(event => event.type === 'turn_end') } })
  t.after(() => conversation.close())
  for (let i = 0; !replayed && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(replayed, true)
  await assert.rejects(connectExistingAgentHost('codex', 'nonexistent-feature', workspace))
})
