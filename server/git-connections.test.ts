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
const { gitRequestContext, providerRemote, withGitCredential, requireGitConnection } = await import('./git-execution.ts')
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

test('branch API validates workspace and operates locally without a GitHub connection', async () => {
  const { git } = await repository('branch-api')
  const current = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim()
  const owner = 'branch-owner@example.test'
  const app = express()
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: owner, mustChangePassword: false }; next() })
  app.use(createApiApp())
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/git/branches?project=branch-api`
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const refs = await fetch(url)
    assert.equal(refs.status, 200)
    assert.deepEqual((await refs.json() as { branches: unknown[] }).branches, [{ name: current, ref: `refs/heads/${current}`, kind: 'local' }])
    assert.equal((await post({ action: 'create', ref: 'HEAD', name: 'stale', workspace: '/old' })).status, 409)
    assert.equal((await git.status()).current, current)
    const created = await post({ action: 'create', ref: 'HEAD', name: 'new-branch', workspace: process.env.MEW_WORKSPACE })
    assert.equal(created.status, 200)
    assert.equal((await created.json() as { branch: string }).branch, 'new-branch')
    assert.equal(gitConnections.get(owner), null)
    assert.equal((await post({ action: 'switch', ref: `refs/heads/${current}`, workspace: process.env.MEW_WORKSPACE })).status, 200)
    assert.equal((await git.status()).current, current)
  } finally { server.close(); await once(server, 'close') }
})

test('remote progress streams after authentication, finishes only on Git exit and sanitizes errors', async () => {
  const { cwd, git } = await repository('progress-api')
  const branch = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim()
  await git.addRemote('origin', 'https://github.com/example/fixture.git')
  await git.addConfig(`branch.${branch}.remote`, 'origin'); await git.addConfig(`branch.${branch}.merge`, `refs/heads/${branch}`)
  const owner = 'progress@example.test'
  const app = express()
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: owner, mustChangePassword: false }; next() })
  app.use(createApiApp())
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/git/remote?project=progress-api`
  const request = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ action: 'push', workspace: process.env.MEW_WORKSPACE }) })
  const provider = gitProvider(), identify = provider.identify, originalPath = process.env.PATH
  const bin = path.join(root, 'progress-bin'); fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
const {spawnSync}=require('node:child_process');const fs=require('node:fs');
if(process.argv.slice(2).includes('push')) {
 if(!process.argv.includes('--progress')) process.exit(2);
 process.stderr.write('Writing objects:  68% (17/25)\\r');
 setTimeout(()=>{if(fs.existsSync('reject-progress')){process.stderr.write('private-progress-token secret failure\\n');process.exit(1)}process.stderr.write('Writing objects: 100% (25/25), done.\\n');process.exit(0)},80);
} else {const r=spawnSync('/usr/bin/git',process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1)}
`, { mode: 0o700 })
  try {
    const missing = await request()
    assert.equal(missing.status, 428, 'auth challenge precedes stream headers')
    assert.equal((await missing.json() as { code: string }).code, 'git-auth-required')
    gitConnections.set(owner, record('progress'))
    provider.identify = async () => ({ login: 'progress', identity: record('progress').identity })
    process.env.PATH = `${bin}:${originalPath}`
    const success = await request()
    assert.equal(success.headers.get('content-type'), 'application/x-ndjson')
    const events = (await success.text()).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(events.map(event => event.type), ['progress', 'progress', 'progress', 'progress', 'complete'])
    assert.deepEqual(events[1].progress, { phase: 'writing', percent: 68, current: 17, total: 25 })
    fs.writeFileSync(path.join(cwd, 'reject-progress'), '')
    const failed = (await (await request()).text()).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(failed.at(-1).type, 'error')
    assert.equal(failed.some(event => event.type === 'complete'), false)
    assert.equal(JSON.stringify(failed).includes('private-progress-token'), false)
  } finally { process.env.PATH = originalPath; provider.identify = identify; server.close(); await once(server, 'close') }
})


test('Git actions refresh expired credentials without opening the account panel', async () => {
  const { cwd } = await repository('expired-action')
  const owner = 'refresh-action@example.test'
  const connection = gitConnections.set(owner, { ...record('alice'), expiresAt: Date.now() - 1, refreshToken: 'refresh-action' })
  const provider = gitProvider(), refresh = provider.refresh
  provider.refresh = async token => {
    assert.equal(token, 'refresh-action')
    return { accessToken: 'renewed-action', expiresAt: Date.now() + 60_000, refreshToken: 'rotated-action' }
  }
  try {
    const renewed = await requireGitConnection(cwd, owner)
    assert.equal(renewed.id, connection.id)
    assert.equal(renewed.accessToken, 'renewed-action')
    assert.equal(gitConnections.require(owner).refreshToken, 'rotated-action')
  } finally { provider.refresh = refresh; gitConnections.remove(owner) }
})
