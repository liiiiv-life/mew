import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { GitHubAuth } from './github-auth.ts'
import { GitConnections } from './git-connections.ts'
import { githubProvider, type GitProvider } from './git-providers.ts'

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-auth-test-'))
  const connections = new GitConnections(root)
  const closed: string[][] = []
  let mode: 'complete' | 'pending' | 'slow_down' = 'complete', identify: (() => Promise<void>) | undefined
  const provider: GitProvider = {
    gitUsername: 'x-access-token', acceptsPath: () => true,
    id: 'github', host: 'github.com', verificationUrl: 'https://github.com/login/device', configured: () => true,
    begin: async () => ({ code: 'ABCD-1234', deviceCode: 'private-device', verificationUrl: 'https://github.com/login/device', expiresIn: 2, interval: 0.005 }),
    poll: async () => mode === 'complete' ? { state: 'complete', accessToken: 'private-token' } : { state: mode },
    identify: async () => { await identify?.(); return { login: 'octocat', identity: { name: 'Octocat', email: '1+octocat@users.noreply.github.com' } } },
  }
  const store = new GitHubAuth(async (...args) => { closed.push(args) }, provider, connections)
  t.after(() => { store.disconnect('alice'); store.disconnect('bob'); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, connections, store, closed, provider, mode: (value: typeof mode) => { mode = value }, identify: (value: () => Promise<void>) => { identify = value } }
}
async function until(check: () => Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await check()) return; await delay(5) } assert.fail('timed out') }

test('starts disconnected despite OS credentials; OAuth persists only for its owner and never exposes tokens', async t => {
  const f = fixture(t)
  assert.equal((await f.store.status('alice')).login, null)
  const job = f.store.start('alice')
  assert.equal(f.store.start('alice').id, job.id)
  await until(async () => (await f.store.status('alice')).job?.state === 'complete')
  const result = await f.store.status('alice')
  assert.equal(result.login, 'octocat')
  assert.equal((await f.store.status('bob')).login, null)
  assert.equal(JSON.stringify(result).includes('private'), false)
  const disk = fs.readdirSync(f.root).filter(file => file.endsWith('.json')).map(file => fs.readFileSync(path.join(f.root, file), 'utf8')).join('')
  assert.equal(disk.includes('private-token'), false)
  assert.equal(f.connections.require('alice').accessToken, 'private-token')
  assert.equal(new GitConnections(f.root).require('alice').login, 'octocat')
  assert.deepEqual(f.closed, [['alice', `github-${job.id}`]])
  f.store.disconnect('alice')
  assert.equal((await f.store.status('alice')).login, null)
})

test('accounts can authorize concurrently but cannot read, cancel or open each other’s jobs', async t => {
  const f = fixture(t); f.mode('pending')
  const alice = f.store.start('alice'), bob = f.store.start('bob')
  await delay(1)
  assert.notEqual(alice.id, bob.id)
  assert.equal((await f.store.status('bob')).busy, false)
  assert.throws(() => f.store.stop('bob', alice.id))
  assert.throws(() => f.store.browserJob('bob', alice.id))
  assert.equal(f.store.browserJob('alice', alice.id), `github-${alice.id}`)
  f.store.stop('alice', alice.id)
  assert.equal((await f.store.status('bob')).job?.state, 'waiting')
})

test('disconnect during identity lookup prevents late OAuth response from recreating a connection', async t => {
  const f = fixture(t)
  let release!: () => void
  f.identify(() => new Promise<void>(resolve => { release = resolve }))
  f.store.start('alice')
  await until(async () => (await f.store.status('alice')).job?.state === 'configuring')
  f.store.disconnect('alice'); release(); await delay(5)
  assert.equal(f.connections.get('alice'), null)
})

test('expired jobs clear codes and missing app configuration has an actionable error', async t => {
  const f = fixture(t); f.mode('pending')
  f.provider.begin = async () => ({ code: 'ABCD-1234', deviceCode: 'private', verificationUrl: f.provider.verificationUrl, expiresIn: 0.01, interval: 0.005 })
  f.store.start('alice')
  await until(async () => (await f.store.status('alice')).job?.state === 'failed')
  assert.equal((await f.store.status('alice')).job?.code, null)
  f.provider.configured = () => false
  assert.equal((await f.store.status('alice')).available, false)
  assert.throws(() => f.store.start('alice'), /MEW_GITHUB_CLIENT_ID/)
})

test('GitHub device adapter sends documented OAuth fields and derives a private author address', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const request: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init })
    return Response.json(url.endsWith('/device/code') ? { device_code: 'device-secret', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }
      : url.endsWith('/access_token') ? { access_token: 'secret' } : { id: 123, login: 'octocat', name: 'Octo Cat' })
  }
  const provider = githubProvider(request, () => 'client-id')
  const device = await provider.begin(); const token = await provider.poll(device.deviceCode)
  assert.equal(token.state, 'complete')
  assert.equal(new URLSearchParams(String(calls[1].init!.body)).get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code')
  const account = await provider.identify('secret')
  assert.equal(account.identity.email, '123+octocat@users.noreply.github.com')
  assert.equal((calls[2].init!.headers as Record<string, string>).Authorization, 'Bearer secret')
})


test('GitHub default app works without configuration and supports a trimmed override', async t => {
  const original = process.env.MEW_GITHUB_CLIENT_ID
  t.after(() => {
    if (original === undefined) delete process.env.MEW_GITHUB_CLIENT_ID
    else process.env.MEW_GITHUB_CLIENT_ID = original
  })
  const ids: (string | null)[] = []
  const request: typeof fetch = async (_input, init) => {
    ids.push(new URLSearchParams(String(init?.body)).get('client_id'))
    return Response.json({ device_code: 'device', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
  }
  for (const value of [undefined, '', '   ', '  custom-app  ']) {
    if (value === undefined) delete process.env.MEW_GITHUB_CLIENT_ID
    else process.env.MEW_GITHUB_CLIENT_ID = value
    const provider = githubProvider(request)
    assert.equal(provider.configured(), true)
    await provider.begin()
  }
  assert.deepEqual(ids, ['Ov23liKEjrduHJdXyo7m', 'Ov23liKEjrduHJdXyo7m', 'Ov23liKEjrduHJdXyo7m', 'custom-app'])
})

test('expired OAuth connections rotate encrypted tokens once and preserve the connection ID', async t => {
  const f = fixture(t)
  const old = f.connections.set('alice', { provider: 'github', host: 'github.com', login: 'octocat', identity: { name: 'Octocat', email: '1+octocat@users.noreply.github.com' }, accessToken: 'private-old', expiresAt: Date.now() - 1, refreshToken: 'private-refresh', refreshExpiresAt: Date.now() + 60_000 })
  let calls = 0
  f.provider.refresh = async token => {
    assert.equal(token, 'private-refresh'); calls++; await delay(5)
    return { accessToken: 'private-new', expiresAt: Date.now() + 60_000, refreshToken: 'private-rotated', refreshExpiresAt: Date.now() + 120_000 }
  }
  const statuses = await Promise.all([f.store.status('alice'), f.store.status('alice')])
  assert.ok(statuses.every(status => status.login === 'octocat' && !JSON.stringify(status).includes('private')))
  assert.equal(calls, 1)
  const saved = new GitConnections(f.root).require('alice')
  assert.equal(saved.id, old.id)
  assert.equal(saved.accessToken, 'private-new')
  assert.equal(saved.refreshToken, 'private-rotated')
  assert.ok(fs.readdirSync(f.root).filter(file => file.endsWith('.json')).every(file => !fs.readFileSync(path.join(f.root, file), 'utf8').includes('private')))
})

test('refresh cannot restore a disconnected or replaced connection', async t => {
  const f = fixture(t)
  for (const replace of [false, true]) {
    f.connections.set('alice', { provider: 'github', host: 'github.com', login: 'old', identity: { name: 'old', email: 'old@example.test' }, accessToken: 'old', expiresAt: Date.now() - 1, refreshToken: 'refresh' })
    let release!: () => void
    f.provider.refresh = () => new Promise(resolve => { release = () => resolve({ accessToken: 'late', expiresAt: Date.now() + 60_000, refreshToken: 'late-refresh' }) })
    const pending = f.store.status('alice')
    f.store.disconnect('alice')
    if (replace) f.connections.set('alice', { provider: 'github', host: 'github.com', login: 'replacement', identity: { name: 'new', email: 'new@example.test' }, accessToken: 'replacement' })
    release()
    assert.equal((await pending).login, replace ? 'replacement' : null)
    assert.equal(f.connections.get('alice')?.accessToken ?? null, replace ? 'replacement' : null)
  }
})

test('refresh failures preserve credentials and distinguish retryable outages from reauthorization', async t => {
  const f = fixture(t)
  const record = { provider: 'github', host: 'github.com', login: 'octocat', identity: { name: 'Octocat', email: '1+octocat@users.noreply.github.com' }, accessToken: 'old', expiresAt: Date.now() - 1, refreshToken: 'refresh' }
  f.connections.set('alice', record)
  f.provider.refresh = githubProvider(async () => { throw new Error('offline') }).refresh
  await assert.rejects(f.store.status('alice'), { status: 503, code: 'git-provider-unavailable' })
  assert.equal(f.connections.get('alice')?.refreshToken, 'refresh')
  f.provider.refresh = githubProvider(async () => Response.json({ error: 'bad_refresh_token' })).refresh
  assert.equal((await f.store.status('alice')).login, null)
  f.connections.set('alice', { ...record, refreshExpiresAt: Date.now() - 1 })
  f.provider.refresh = async () => { assert.fail('expired refresh token must not be sent') }
  assert.equal((await f.store.status('alice')).login, null)
  f.connections.set('alice', { ...record, refreshToken: undefined })
  assert.equal((await f.store.status('alice')).login, null)
})

test('device flow retains refresh credentials and refresh uses the public client ID without a secret', async () => {
  const calls: URLSearchParams[] = []
  const provider = githubProvider(async (_input, init) => {
    calls.push(new URLSearchParams(String(init?.body)))
    return Response.json({ access_token: 'access', expires_in: 28800, refresh_token: 'refresh', refresh_token_expires_in: 15897600 })
  }, () => 'app')
  const issued = await provider.poll('device')
  assert.equal(issued.state, 'complete')
  if (issued.state !== 'complete') assert.fail()
  assert.equal(issued.refreshToken, 'refresh')
  assert.ok(issued.refreshExpiresAt! > Date.now())
  const refreshed = await provider.refresh!('refresh')
  assert.equal(refreshed.refreshToken, 'refresh')
  assert.equal(calls[1].get('client_id'), 'app')
  assert.equal(calls[1].get('grant_type'), 'refresh_token')
  assert.equal(calls[1].get('refresh_token'), 'refresh')
  assert.equal(calls[1].has('client_secret'), false)
})
