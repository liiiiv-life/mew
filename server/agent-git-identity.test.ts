import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-git-identity-'))
process.env.MEW_DATA_DIR = path.join(root, 'data')
process.env.MEW_WORKSPACE = root
const { upsertUser } = await import('./auth.ts')
const { gitConnections } = await import('./git-connections.ts')
const { agentGitEnv } = await import('./agent-git-identity.ts')
const { workspaceContext, pathsForWorkspace } = await import('./paths.ts')
const { AgentSession } = await import('./agentAcp.ts')
for (const [email, displayName] of [['alice@example.test', 'Alice Profile'], ['bob@example.test', 'Bob Profile']]) {
  upsertUser(email, { displayName, hash: 'unused-fixture', role: 'owner', mustChangePassword: false, createdAt: 0, passwordChangedAt: 0 })
}
gitConnections.set('alice@example.test', { provider: 'github', host: 'github.com', login: 'alice', identity: { name: 'Alice GitHub', email: '123+alice@users.noreply.github.com' }, accessToken: 'private-fixture-token' })
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

const stub = path.join(root, 'agent.mjs')
fs.writeFileSync(stub, `
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))};
import { Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
new AgentSideConnection(() => ({
 initialize: async () => { execFileSync('git', ['commit', '--allow-empty', '-m', 'agent commit']); return {protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}}; },
 newSession: async () => ({sessionId:'fixture-session'}),
 cancel: async () => {}, prompt: async () => ({stopReason:'end_turn'})
}), ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
`)

test('ACP child commits as its initiating account and preserves shared Git configuration', async () => {
  const cwd = path.join(root, 'repo')
  fs.mkdirSync(cwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'OS User')
  git('config', 'user.email', 'os@example.test')
  for (const [email, expected] of [
    ['alice@example.test', 'Alice GitHub|123+alice@users.noreply.github.com'],
    ['bob@example.test', 'Bob Profile|bob@example.test'],
  ]) {
    const session = await workspaceContext.run(pathsForWorkspace(root, email), () => AgentSession.start('identity-fixture', {
      cmd: process.execPath, args: [stub], env: { GIT_AUTHOR_NAME: 'Wrong Runtime', GIT_AUTHOR_EMAIL: 'wrong@example.test', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z' },
    }, cwd))
    try {
      assert.equal(git('log', '-1', '--format=%an|%ae;%cn|%ce'), `${expected};${expected}`)
      assert.notEqual(git('log', '-1', '--format=%aI').slice(0, 4), '2000')
    } finally { session.dispose() }
  }
  assert.equal(git('config', 'user.name'), 'OS User')
  assert.equal(git('config', 'user.email'), 'os@example.test')
})

test('supervisor inherits only account attribution, never connection tokens or mutations to parent env', () => {
  const base = { PATH: '/fixture', GIT_AUTHOR_NAME: 'OS User', GIT_AUTHOR_DATE: 'old' }
  const env = workspaceContext.run(pathsForWorkspace(root, 'alice@example.test'), () => agentGitEnv(base))
  assert.equal(env.GIT_COMMITTER_EMAIL, '123+alice@users.noreply.github.com')
  assert.equal(env.GIT_AUTHOR_DATE, undefined)
  assert.equal(env.PATH, '/fixture')
  assert.equal(JSON.stringify(env).includes('private-fixture-token'), false)
  assert.equal(base.GIT_AUTHOR_NAME, 'OS User')
  assert.deepEqual(agentGitEnv(base, null), base)
  assert.throws(() => agentGitEnv(base, 'missing@example.test'), /로그인 계정/)
})

test('detached supervisor keeps the initiating identity when another account reconnects', async () => {
  process.env.MEW_AGENT_CODEX_CMD = process.execPath
  process.env.MEW_AGENT_CODEX_ARGS = stub
  const { connectAgentHost, shutdownAgentHostsForWorkspace } = await import('./agentHost.ts')
  const cwd = path.join(root, 'supervised-repo')
  fs.mkdirSync(cwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'OS User')
  git('config', 'user.email', 'os@example.test')
  let markReady!: () => void
  let failReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { markReady = resolve; failReady = reject })
  const client = await workspaceContext.run(pathsForWorkspace(root, 'alice@example.test'), () => connectAgentHost('codex', 'identity-tab', cwd, {
    onEvent: event => { if (event.type === 'meta') markReady() },
    onFatal: message => failReady(new Error(message)),
  }))
  try {
    await ready
    const other = await workspaceContext.run(pathsForWorkspace(root, 'bob@example.test'), () => connectAgentHost('codex', 'identity-tab', cwd))
    other.close()
    assert.equal(git('log', '-1', '--format=%an|%ae;%cn|%ce'), 'Alice GitHub|123+alice@users.noreply.github.com;Alice GitHub|123+alice@users.noreply.github.com')
    assert.equal(git('rev-list', '--count', 'HEAD'), '1')
    assert.equal(git('config', 'user.email'), 'os@example.test')
  } finally { client.close(); await shutdownAgentHostsForWorkspace(cwd) }
})
