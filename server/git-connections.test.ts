import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import express from 'express'
import simpleGit from 'simple-git'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-account-git-'))
process.env.MEW_DATA_DIR = path.join(root, 'data')
process.env.MEW_WORKSPACE = path.join(root, 'workspace')
fs.mkdirSync(process.env.MEW_WORKSPACE)
const { gitConnections, GitConnectionError } = await import('./git-connections.ts')
const { gitRequestContext, providerRemote, withGitCredential } = await import('./git-execution.ts')
const { gitProvider } = await import('./git-providers.ts')
const { createApiApp } = await import('./api.ts')
const { commitFiles } = await import('./git-commit-files.ts')
const { resetTreeWatchers } = await import('./watcher.ts')
const alice = 'alice@example.test', bob = 'bob@example.test'
const record = (login: string) => ({ provider: 'github', host: 'github.com', login, identity: { name: login, email: `123+${login}@users.noreply.github.com` }, accessToken: `private-${login}-token` })
after(() => { resetTreeWatchers(); fs.rmSync(root, { recursive: true, force: true }) })

async function repository(name: string) {
  const cwd = path.join(process.env.MEW_WORKSPACE!, name); fs.mkdirSync(cwd)
  const git = simpleGit(cwd); await git.init()
  await git.addConfig('user.name', 'OS User'); await git.addConfig('user.email', 'os@example.test')
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'original')
  await git.add('-A'); await git.commit('initial')
  return { cwd, git }
}

test('commit API gates before writing, keeps users separate and applies both author and committer per operation', async () => {
  const { cwd, git } = await repository('api')
  const app = express()
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: String(req.headers['x-account'] ?? alice), mustChangePassword: false }; next() })
  app.use(createApiApp())
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const save = (owner: string, content: string, extra: Record<string, string> = {}, commit = true) => fetch(`${base}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-account': owner, ...extra }, body: JSON.stringify({ project: 'api', path: 'file.txt', content, commit }) })
  try {
    const rejected = await save(alice, 'not written')
    assert.equal(rejected.status, 428)
    assert.equal(((await rejected.json()) as { code: string }).code, 'git-auth-required')
    assert.equal(fs.readFileSync(path.join(cwd, 'file.txt'), 'utf8'), 'original')
    assert.equal(await git.diff(['--cached']), '')
    await git.addRemote('origin', 'git@github.com:owner/repo.git')
    const branch = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim()
    await git.addConfig(`branch.${branch}.remote`, 'origin')
    await git.addConfig(`branch.${branch}.merge`, `refs/heads/${branch}`)
    const push = await fetch(`${base}/git/remote?project=api`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-account': alice }, body: JSON.stringify({ action: 'push', workspace: process.env.MEW_WORKSPACE }) })
    assert.equal(push.status, 428)
    await git.removeRemote('origin')
    assert.equal((await save(alice, 'autosaved', {}, false)).status, 200)
    gitConnections.set(alice, record('alice'))
    assert.equal((await save(bob, 'not bob')).status, 428)
    assert.equal((await save(bob, 'stale', { 'X-Mew-Git-Owner': alice })).status, 409)
    assert.equal((await save(alice, 'stale', { 'X-Mew-Git-Workspace': '/old' })).status, 409)
    fs.writeFileSync(path.join(cwd, 'other.txt'), 'unrelated staged file'); await git.add('other.txt')
    assert.equal((await save(alice, 'by Alice')).status, 200)
    assert.equal((await git.raw(['log', '-1', '--format=%an|%ae|%cn|%ce'])).trim(), 'alice|123+alice@users.noreply.github.com|alice|123+alice@users.noreply.github.com')
    assert.equal((await git.diff(['--cached', '--name-only'])).trim(), 'other.txt')
    gitConnections.set(bob, record('bob'))
    assert.equal((await save(bob, 'by Bob')).status, 200)
    assert.equal((await git.raw(['log', '-1', '--format=%an|%cn'])).trim(), 'bob|bob')
    assert.equal((await git.getConfig('user.name')).value, 'OS User')
    assert.equal(((await fetch(`${base}/git-connections/github?project=api`, { headers: { 'x-account': alice } }).then(r => r.json())) as { login: string }).login, 'alice')
    await fetch(`${base}/git-connections/github?project=api`, { method: 'DELETE', headers: { 'x-account': alice } })
    assert.equal((await save(alice, 'after disconnect')).status, 428)
    assert.equal(gitConnections.require(bob).login, 'bob')
  } finally { server.close(); await once(server, 'close') }
})

test('parallel commits never mutate a shared process identity or repository config', async () => {
  const a = await repository('parallel-a'), b = await repository('parallel-b')
  fs.writeFileSync(path.join(a.cwd, 'file.txt'), 'a'); fs.writeFileSync(path.join(b.cwd, 'file.txt'), 'b')
  const ca = gitConnections.set(alice, record('alice')), cb = gitConnections.set(bob, record('bob'))
  await Promise.all([
    gitRequestContext.run({ owner: alice, connection: ca }, () => commitFiles(a.cwd, 'a', '', ['file.txt'])),
    gitRequestContext.run({ owner: bob, connection: cb }, () => commitFiles(b.cwd, 'b', '', ['file.txt'])),
  ])
  assert.equal((await a.git.raw(['log', '-1', '--format=%ae'])).trim(), ca.identity.email)
  assert.equal((await b.git.raw(['log', '-1', '--format=%ae'])).trim(), cb.identity.email)
  const old = gitConnections.require(alice)
  gitConnections.set(alice, record('replacement'))
  assert.throws(() => gitConnections.require(alice, 'github', 'github.com', old.id), GitConnectionError)
  gitConnections.set(alice, { ...record('expired'), expiresAt: Date.now() - 1 })
  assert.throws(() => gitConnections.require(alice), GitConnectionError)
})

test('credential helper only returns the selected account token to the exact HTTPS host and path, then cleans up', async () => {
  const provider = gitProvider(), identify = provider.identify
  provider.identify = async () => ({ login: 'bob', identity: record('bob').identity })
  const connection = gitConnections.set(bob, record('bob'))
  let socket: string | undefined
  try {
    await withGitCredential(connection, providerRemote('git@github.com:owner/repo.git'), async (env, config) => {
      socket = env.MEW_GIT_CREDENTIAL_SOCKET
      assert.equal(JSON.stringify(env).includes(connection.accessToken), false)
      assert.equal(JSON.stringify(config).includes(connection.accessToken), false)
      const fill = (host: string, pathname: string) => new Promise<string>((resolve, reject) => {
        const child = execFile('git', [...config.flatMap(value => ['-c', value]), 'credential', 'fill'], { cwd: root, env }, (error, stdout) => error ? reject(error) : resolve(stdout))
        child.stdin!.end(`protocol=https\nhost=${host}\npath=${pathname}\n\n`)
      })
      const result = await fill('github.com', 'owner/repo.git')
      assert.ok(result.includes(connection.accessToken))
      await assert.rejects(fill('attacker.test', 'owner/repo.git'))
      await assert.rejects(fill('github.com', 'other/repo.git'))
    })
    assert.equal(fs.existsSync(socket!), false)
  } finally { provider.identify = identify }
  assert.equal(providerRemote('ssh://git@github.com/owner/repo.git').url, 'https://github.com/owner/repo.git')
  for (const remote of ['https://github.com.attacker.test/a/b', 'https://token@github.com/a/b', 'http://github.com/a/b', '/tmp/repo', 'https://gitlab.com/a/b']) assert.throws(() => providerRemote(remote))
})
