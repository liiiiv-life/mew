import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'
import { upsertUser } from './auth.ts'
import { agentSettingsAccount, agentSettingsEnv, agentSettingsPath, runWithAgentAccount } from './agent-account-settings.ts'
import { workspaceContext, pathsForWorkspace } from './paths.ts'
import { readAgentDefault, writeAgentDefault } from './agentDefaults.ts'
import { readAgentSetting, writeAgentSetting, deleteAgentSetting, purgeForbiddenAgentEnv } from './agentSettings.ts'
import { agentGuidanceSettings, updateAgentGuidance, readAgentGuidance } from './agent-guidance.ts'
import { resolvedSpec } from './agentRuntimes.ts'
import { scheduleAgentPrompt, listAgentScheduledPrompts, cancelAgentScheduledPrompt } from './agentScheduledPrompts.ts'
import { normalizeJobs, agentCommand } from './schedules.ts'
import { AgentSession } from './agentAcp.ts'

const alice = 'alice@example.test', bob = 'bob@example.test'
for (const [email, createdAt] of [[alice, 1], [bob, 2]] as const) {
  upsertUser(email, { hash: 'unused-fixture', role: 'owner', mustChangePassword: false, createdAt, passwordChangedAt: 0 })
}

test('legacy settings migrate only to the first owner; every account persists independent guidance, defaults and secrets', async () => {
  fs.writeFileSync(path.join(DATA_DIR, 'agent-guidance.md'), 'Legacy owner guidance')
  writeAgentDefault('codex', { modelId: 'legacy-model' })
  writeAgentSetting('codex', { env: { OPENAI_API_KEY: 'legacy-private-key' } })
  await runWithAgentAccount(bob, async () => {
    assert.equal(readAgentDefault('codex'), null)
    assert.equal(readAgentSetting('codex'), null)
    assert.doesNotMatch(readAgentGuidance(), /Legacy owner guidance/)
    const initial = agentGuidanceSettings()
    updateAgentGuidance({ key: 'language', value: 'en', revision: initial.revision })
    writeAgentDefault('codex', { modelId: 'bob-model', thinkingId: 'high' })
    writeAgentSetting('codex', { env: { OPENAI_API_KEY: 'bob-private-key' } })
  })
  runWithAgentAccount(alice, () => {
    assert.equal(readAgentDefault('codex')?.modelId, 'legacy-model')
    assert.equal(readAgentSetting('codex')?.env?.OPENAI_API_KEY, 'legacy-private-key')
    const initial = agentGuidanceSettings()
    assert.equal(initial.content, 'Legacy owner guidance')
    updateAgentGuidance({ key: 'language', value: 'ko', revision: initial.revision })
    assert.equal(resolvedSpec('codex')?.env?.OPENAI_API_KEY, 'legacy-private-key')
    deleteAgentSetting('codex')
    assert.equal(readAgentSetting('codex'), null, 'reset never imports legacy secrets again')
  })
  await Promise.all([alice, bob].map(email => runWithAgentAccount(email, async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(agentSettingsAccount(), email)
    assert.equal(agentGuidanceSettings().settings.language, email === alice ? 'ko' : 'en')
  })))
  assert.equal(fs.readFileSync(path.join(DATA_DIR, 'agent-guidance.md'), 'utf8'), 'Legacy owner guidance')
  assert.equal(readAgentDefault('codex')?.modelId, 'legacy-model')
  runWithAgentAccount(bob, () => {
    assert.equal(readAgentDefault('codex')?.modelId, 'bob-model')
    assert.equal(resolvedSpec('codex')?.env?.OPENAI_API_KEY, 'bob-private-key')
    const stored = agentSettingsPath('agent-settings.json')
    const value = JSON.parse(fs.readFileSync(stored, 'utf8'))
    value.codex.env.CLAUDE_CODE_OAUTH_TOKEN = 'forbidden-fixture'
    fs.writeFileSync(stored, JSON.stringify(value))
    assert.equal(purgeForbiddenAgentEnv(), true)
    assert.equal(readAgentSetting('codex')?.env?.OPENAI_API_KEY, 'bob-private-key')
  })
})

test('request identity overrides inherited host identity and settings follow an account across projects', () => {
  process.env.MEW_AGENT_ACCOUNT = alice
  try {
    assert.equal(agentSettingsAccount(), alice)
    for (const root of ['/tmp/project-a', '/tmp/project-b']) workspaceContext.run(pathsForWorkspace(root, bob), () => {
      assert.equal(agentSettingsAccount(), bob)
      assert.equal(agentGuidanceSettings().settings.language, 'en')
      assert.equal(agentSettingsEnv({}).MEW_AGENT_ACCOUNT, bob)
    })
    workspaceContext.run(pathsForWorkspace('/tmp', null), () => {
      assert.equal(agentSettingsAccount(), null)
      assert.equal(agentSettingsEnv(process.env).MEW_AGENT_ACCOUNT, undefined)
    })
  } finally { delete process.env.MEW_AGENT_ACCOUNT }
})

test('scheduled prompts capture server identity and cannot be edited or cancelled from another account', () => {
  const scope = { runtime: 'codex', tab: 'same-tab', cwd: '/tmp', sessionId: 'fixture' }
  const job = runWithAgentAccount(alice, () => scheduleAgentPrompt({ ...scope, account: bob, text: 'fixture', at: new Date(Date.now() + 3_600_000).toISOString() }))
  assert.equal(job.account, alice)
  runWithAgentAccount(bob, () => {
    assert.deepEqual(listAgentScheduledPrompts(scope), [])
    assert.equal(cancelAgentScheduledPrompt({ ...scope, id: job.id }), false)
  })
  runWithAgentAccount(alice, () => {
    assert.equal(listAgentScheduledPrompts(scope).length, 1)
    assert.equal(cancelAgentScheduledPrompt({ ...scope, id: job.id }), true)
  })
  const set = { id: 'fixture', name: 'Fixture', runtime: 'codex', modelId: '', role: 'fixture' }
  const jobs = runWithAgentAccount(alice, () => normalizeJobs([{ name: 'Fixture', cron: '* * * * *', agentSetId: set.id, account: bob, project: '', prompt: 'fixture' }], { sets: [set], existing: [] }))
  assert.equal(jobs[0].account, alice)
  assert.match(agentCommand(jobs[0]), /--account 'alice@example.test'/)
})

test('a live ACP session keeps its starting account and receives that account’s next guidance update', async t => {
  const stub = path.join(DATA_DIR, 'account-acp.mjs')
  const log = path.join(DATA_DIR, 'account-prompts.jsonl')
  runWithAgentAccount(alice, () => writeAgentDefault('codex', { modelId: 'alice-model' }))
  fs.writeFileSync(stub, `
import fs from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))}
new AgentSideConnection(() => ({
 initialize: async () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }),
 newSession: async () => ({ sessionId: 'account-fixture', models: { currentModelId: 'server-default', availableModels: ['server-default', 'alice-model', 'bob-model'].map(modelId => ({modelId, name: modelId})) } }),
 unstable_setSessionModel: async () => ({}),
 prompt: async ({ prompt }) => { fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(prompt) + '\\n'); return { stopReason: 'end_turn' } },
 cancel: async () => {}
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
`)
  const session = await runWithAgentAccount(alice, () => AgentSession.start('codex', { cmd: process.execPath, args: [stub] }, DATA_DIR))
  t.after(() => session.disposeAndWait())
  assert.equal(session.models?.currentModelId, 'alice-model')
  await runWithAgentAccount(bob, () => session.runOnce('first'))
  runWithAgentAccount(alice, () => {
    const state = agentGuidanceSettings()
    updateAgentGuidance({ key: 'detail', value: 'detailed', revision: state.revision })
  })
  await new Promise(resolve => setTimeout(resolve, 20))
  await runWithAgentAccount(bob, () => session.runOnce('second'))
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.match(calls[0][1].text, /Respond to the user in Korean/)
  assert.doesNotMatch(calls[0][1].text, /Respond to the user in English/)
  assert.match(calls[1][1].text, /detailed/i)
  const other = await runWithAgentAccount(bob, () => AgentSession.start('codex', { cmd: process.execPath, args: [stub] }, DATA_DIR))
  t.after(() => other.disposeAndWait())
  assert.equal(other.models?.currentModelId, 'bob-model')
})
