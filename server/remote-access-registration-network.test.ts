import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import express from 'express'
import type { RemoteNetworkStatus, RemoteStatus } from '../shared/remote-access.ts'

test('Mewlink prepares direct access only on an owner action and preserves registration cancellation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-register-network-'))
  process.env.MEW_DATA_DIR = directory
  process.env.MEW_REMOTE_ORIGIN = 'https://central.example.test'
  const { createRemoteAgent } = await import('./remote-access-agent.ts')
  const { saveRemoteRegistration, readRemoteRegistration } = await import('./remote-access-state.ts')
  const { remoteKeyPair } = await import('../shared/remote-access-crypto.ts')
  const realFetch = globalThis.fetch
  let registrations = 0
  t.mock.method(globalThis, 'fetch', async () => {
    registrations++
    return Response.json({ code: 'r'.repeat(32), challenge: 'challenge', expires: Date.now() + 300_000, registrationUrl: 'https://central.example.test/register/' + 'r'.repeat(32) })
  })
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  async function fixture(network: NonNullable<Parameters<typeof createRemoteAgent>[1]>['network']) {
    const app = express(), server = http.createServer(app)
    const agent = createRemoteAgent(server, { network })
    app.use((req, _res, next) => { req.auth = { role: req.headers['x-fixture-role'] === 'member' ? 'member' : 'owner', email: 'owner@example.test', mustChangePassword: false }; next() })
    app.use('/api/remote-access', agent.router)
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    return {
      agent,
      call: (method: string, suffix = '', role = 'owner') => realFetch(origin + '/api/remote-access' + suffix, { method, headers: { 'x-fixture-role': role } }),
      close: async () => { agent.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
    }
  }
  const until = async (done: () => boolean) => {
    const deadline = performance.now() + 2000
    while (!done() && performance.now() < deadline) await new Promise(resolve => setImmediate(resolve))
    assert.ok(done(), 'registration settled')
  }
  const ready: RemoteNetworkStatus = { state: 'ready', reason: 'wsl-udp-rule' }

  await t.test('inspection and non-owner requests never prompt; registration waits for one preparation', async () => {
    let complete!: (value: RemoteNetworkStatus) => void, preparations = 0
    const barrier = new Promise<RemoteNetworkStatus>(resolve => { complete = resolve })
    const f = await fixture({ check: async () => ({ state: 'blocked', reason: 'approval-required' }), prepare: () => { preparations++; return barrier } })
    try {
      assert.equal(((await (await f.call('GET')).json()) as RemoteStatus).network?.state, 'blocked')
      assert.equal((await f.call('POST', '/prepare-network', 'member')).status, 403)
      assert.equal(preparations, 0)
      const response = await f.call('POST', '/register')
      assert.equal(response.status, 202)
      assert.equal(((await response.json()) as RemoteStatus).network?.state, 'preparing')
      assert.equal((await f.call('POST', '/register')).status, 409)
      assert.equal(registrations, 0)
      complete(ready)
      await until(() => !!f.agent.status().registrationUrl)
      assert.equal(preparations, 1); assert.equal(registrations, 1)
    } finally { await f.close() }
  })
  await t.test('denied approval never creates a central registration', async () => {
    const previous = registrations
    const f = await fixture({ check: async () => ready, prepare: async () => ({ state: 'blocked', reason: 'approval-cancelled', error: 'Windows 승인을 취소했습니다.' }) })
    try {
      await f.call('POST', '/register')
      await until(() => f.agent.status().state === 'error')
      assert.match(f.agent.status().error!, /Windows/)
      assert.equal(registrations, previous)
      assert.equal(readRemoteRegistration(), null)
    } finally { await f.close() }
  })
  await t.test('unsupported policy inspection preserves registration and reports uncertainty', async () => {
    const unknown: RemoteNetworkStatus = { state: 'unknown', reason: 'hyperv-unavailable', error: '이 환경의 정책을 확인하지 못했습니다.' }
    const previous = registrations
    const f = await fixture({ check: async () => unknown, prepare: async () => unknown })
    try {
      await f.call('POST', '/register')
      await until(() => !!f.agent.status().registrationUrl)
      assert.deepEqual(f.agent.status().network, unknown)
      assert.equal(registrations, previous + 1)
    } finally { await f.close() }
  })
  await t.test('deleting while approval is pending prevents a late registration', async () => {
    let complete!: (value: RemoteNetworkStatus) => void
    const previous = registrations, barrier = new Promise<RemoteNetworkStatus>(resolve => { complete = resolve })
    const f = await fixture({ check: async () => ready, prepare: () => barrier })
    try {
      await f.call('POST', '/register'); await f.call('DELETE')
      complete(ready)
      await until(() => f.agent.status().network?.state !== 'preparing')
      assert.equal(f.agent.status().state, 'disabled')
      assert.equal(f.agent.status().registrationUrl, undefined)
      assert.equal(registrations, previous)
    } finally { await f.close() }
  })
  await t.test('repair of an existing device preserves its registration and keys', async () => {
    const keys = await remoteKeyPair(), central = await remoteKeyPair()
    const registration = { origin: 'https://127.0.0.1:1', instance: 'i'.repeat(32), owner: 'o'.repeat(32), name: 'home', ...keys, centralKey: central.publicKey, accounts: {} }
    saveRemoteRegistration(registration)
    const previous = registrations
    const f = await fixture({ check: async () => ready, prepare: async () => ready })
    try {
      assert.equal((await f.call('POST', '/prepare-network')).status, 202)
      await until(() => f.agent.status().network?.state === 'ready')
      assert.deepEqual(readRemoteRegistration(), registration)
      assert.equal(registrations, previous)
    } finally { await f.close(); saveRemoteRegistration(null) }
  })
  await t.test('status resolves the public account, caches it, retries explicitly, and keeps keys unchanged', async t => {
    const keys = await remoteKeyPair(), central = await remoteKeyPair()
    const registration = { origin: 'https://127.0.0.1:1', instance: 'i'.repeat(32), owner: 'o'.repeat(32), name: 'home', ...keys, centralKey: central.publicKey, accounts: {} }
    saveRemoteRegistration(registration)
    let lookups = 0, fail = false
    t.mock.method(globalThis, 'fetch', async () => {
      lookups++
      if (fail) throw new Error('network-unavailable')
      return new Response(null, { status: 307, headers: { location: 'https://127.0.0.1:1/alice/home' } })
    })
    const f = await fixture({ check: async () => ready, prepare: async () => ready })
    try {
      const initial = await (await f.call('GET')).json() as RemoteStatus
      assert.equal(initial.username, 'alice')
      assert.equal(initial.url, 'https://127.0.0.1:1/alice/home')
      assert.equal(initial.deviceName, 'home')
      assert.equal(initial.dashboardUrl, 'https://127.0.0.1:1/alice')
      assert.equal(JSON.stringify(initial).includes(registration.owner), false)
      assert.equal(JSON.stringify(initial).includes(keys.privateKey.d!), false)
      await f.call('GET')
      assert.equal(lookups, 1)
      fail = true
      const failed = await (await f.call('GET', '?refresh=1')).json() as RemoteStatus
      assert.equal(failed.url, undefined)
      assert.ok(failed.addressError)
      fail = false
      const recovered = await (await f.call('GET', '?refresh=1')).json() as RemoteStatus
      assert.equal(recovered.username, 'alice')
      assert.equal(recovered.addressError, undefined)
      assert.deepEqual(readRemoteRegistration(), registration)
      const deleted = await (await f.call('DELETE')).json() as RemoteStatus
      assert.equal(deleted.username, undefined)
      assert.equal(deleted.deviceName, undefined)
    } finally { await f.close(); saveRemoteRegistration(null) }
  })
})
