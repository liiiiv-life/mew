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
