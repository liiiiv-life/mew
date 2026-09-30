import assert from 'node:assert/strict'
import test from 'node:test'
import { newer, selectUpdates, runUpdateQueue, type UpdateCandidate } from './updates.ts'
import type { UpdateJob } from '../shared/updates.ts'
test('version ordering avoids downgrades and compares prerelease identifiers numerically', () => {
  for (const [current, latest, result] of [['1.9.0', '1.10.0', true], ['2.0.0', '1.9.0', false], ['1.0.0', '1.0.0-beta', false], ['1.0.0-beta.2', '1.0.0-beta.10', true], ['1.0.0-beta', '1.0.0', true], ['1.0.0', '1.0.0', false], [null, '1.0.0', false], ['unknown', '1.0.0', false], ['2026.09.20-ab12', '2026.09.28-cd34', true]] as const) assert.equal(newer(current, latest), result)
})
const row = (id: string): UpdateCandidate => ({ id, label: id, category: 'agent', current: '1.0.0', latest: '2.0.0', available: true, canUpdate: true, error: null, command: { cmd: 'test', args: [id] } })
test('update requests accept registered installed updatable ids only and deduplicate', () => {
  const catalog = [row('a'), { ...row('b'), canUpdate: false }]
  assert.deepEqual(selectUpdates(catalog, ['a', 'a']).map(row => row.id), ['a'])
  for (const ids of [[], null, 'a', [1], ['b'], ['unknown'], ['a; touch /tmp/no']]) assert.throws(() => selectUpdates(catalog, ids))
})
test('batch queue runs serially, retains per-item failures and continues remaining items', async () => {
  const rows = [row('a'), row('b'), row('c')]
  const job: UpdateJob = { running: true, items: rows.map(row => ({ id: row.id, state: 'queued', error: null })) }
  const order: string[] = []
  let active = 0
  await runUpdateQueue(rows, job, async spec => {
    assert.equal(++active, 1)
    const id = spec.args[0]; order.push(id)
    await Promise.resolve(); active--
    if (id === 'b') throw new Error('permission denied')
  })
  assert.deepEqual(order, ['a', 'b', 'c'])
  assert.deepEqual(job.items.map(item => item.state), ['succeeded', 'failed', 'succeeded'])
  assert.equal(job.items[1].error, 'permission denied')
  assert.equal(job.running, false)
})

test('app dependencies and bundled ACP adapters cannot be updated even with stale executable catalog entries', () => {
  for (const candidate of [row('npm:root:react'), row('npm:root:@agentclientprotocol/codex-acp'), row('npm:packages/editor:@tiptap/core'), { ...row('legacy-dependency'), category: 'dependency' as const }]) {
    assert.throws(() => selectUpdates([row('cli:codex'), candidate], ['cli:codex', candidate.id]))
  }
  assert.deepEqual(selectUpdates([row('cli:codex')], ['cli:codex']).map(item => item.id), ['cli:codex'])
})

test('batch policy excludes independent agents and app dependencies', async () => {
  const { batchUpdateIds } = await import('../shared/updates.ts')
  assert.deepEqual(batchUpdateIds([row('cli:codex'), { ...row('npm:root:react'), category: 'dependency' }, { ...row('system:uv'), category: 'system' }, { ...row('system:node'), category: 'system', canUpdate: false }]), ['system:uv'])
})
test('Prime release lookup follows the official installer channel and validates responses', async () => {
  const { primeReleaseUrl, primeReleaseVersion } = await import('./update-policy.ts')
  const installer = 'prime_agent_base_url="${PRIME_AGENT_DOWNLOAD_BASE_URL:-https://releases.example.com}"'
  assert.equal(primeReleaseUrl(installer), 'https://releases.example.com/stable')
  assert.equal(primeReleaseUrl(installer, 'https://mirror.example.com/', 'beta'), 'https://mirror.example.com/beta')
  assert.equal(primeReleaseVersion('v0.9.8\n'), '0.9.8')
  assert.throws(() => primeReleaseUrl('missing'))
  assert.throws(() => primeReleaseUrl(installer, undefined, 'invalid'))
  assert.throws(() => primeReleaseVersion('<html>error</html>'))
})
test('running agent detection includes detached hosts, configured paths and script CLIs', async () => {
  const { agentProcessRunning } = await import('./update-policy.ts')
  assert.equal(agentProcessRunning('/usr/bin/node /app/server/agentHost.ts --host prime tab /workspace', 'prime', ['prime-agent']), true)
  assert.equal(agentProcessRunning('/opt/bin/prime-agent --mode rpc', 'prime', ['prime-agent']), true)
  assert.equal(agentProcessRunning('node /opt/npm/prime-agent/dist/cli.js --mode rpc', 'prime', ['/opt/npm/prime-agent/dist/cli.js']), true)
  assert.equal(agentProcessRunning('/usr/bin/node /app/server/agentHost.ts --host codex tab /workspace', 'prime', ['prime-agent']), false)
  assert.equal(agentProcessRunning('node server/updates.test.ts', 'prime', ['prime-agent']), false)
})

test('API selection rejects batched agents and installation status checks the real Prime executable', async () => {
  const { runtimeStatuses } = await import('./agentRuntimeInstall.ts')
  assert.throws(() => selectUpdates([row('cli:codex'), { ...row('system:uv'), category: 'system' }], ['cli:codex', 'system:uv']))
  const previous = process.env.MEW_PRIME_AGENT_EXECUTABLE
  try {
    process.env.MEW_PRIME_AGENT_EXECUTABLE = '/missing/mew-prime-executable'
    assert.equal(runtimeStatuses().find(row => row.id === 'prime')?.installed, false)
    process.env.MEW_PRIME_AGENT_EXECUTABLE = process.execPath
    assert.equal(runtimeStatuses().find(row => row.id === 'prime')?.installed, true)
  } finally {
    if (previous === undefined) delete process.env.MEW_PRIME_AGENT_EXECUTABLE
    else process.env.MEW_PRIME_AGENT_EXECUTABLE = previous
  }
})
