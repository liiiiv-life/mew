import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import express from 'express'
import { WebSocketServer } from 'ws'
import type { RemoteFrame } from '../shared/remote-access.ts'
import type { MewlinkIdentity } from '../shared/mewlink-identity.ts'

test('trusted browsers retain only key-bound, revocable remote authority', { timeout: 30_000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-trusted-device-'))
  process.env.MEW_DATA_DIR = path.join(temporary, 'data')
  const auth = await import('./auth.ts')
  const identities = await import('./mewlink-identities.ts')
  const { createRemoteAuthentication } = await import('./remote-authentication.ts')
  const { createAuthRouter, checkOrigin } = await import('./authRoutes.ts')
  const { remoteDispatcher } = await import('./remote-access-dispatch.ts')
  const { attachAuthContext, resolveAuth } = await import('./reqAuth.ts')
  const browserId = 'a'.repeat(43), otherBrowser = 'b'.repeat(43), password = 'trusted-browser-password-2026'
  for (const [email, temporaryPassword] of [['owner@example.test', false], ['member@example.test', false], ['temporary@example.test', true]] as const) {
    auth.upsertUser(email, { hash: auth.hashPassword(password), role: 'owner', mustChangePassword: temporaryPassword, createdAt: 1, passwordChangedAt: 0 })
  }
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  function harness(initial: string | null = null, identity: MewlinkIdentity | null = null, key = browserId) {
    const authentication = createRemoteAuthentication(identity, key)
    authentication.resume(initial)
    let closed = false, sequence = 0
    const app = express(), server = http.createServer(app), frames: RemoteFrame[] = []
    app.use(checkOrigin)
    app.use('/api/auth', createAuthRouter())
    app.use('/api', attachAuthContext)
    app.get('/api/work', (req, res) => res.json(resolveAuth(req)))
    app.get('/api/pending', (_req, res) => res.write('private'))
    app.use((error: Error & { type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (error.type === 'request.aborted') { res.end(); return }
      next(error)
    })
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => ws.send(resolveAuth(req).email ?? 'guest')))
    let dispatcher: ReturnType<typeof remoteDispatcher>
    dispatcher = remoteDispatcher(server, {
      send: async raw => {
        const frame = JSON.parse(raw) as RemoteFrame
        frames.push(frame)
        if (frame.type === 'response' || frame.type === 'chunk') setImmediate(() => { void dispatcher.receive(JSON.stringify({ type: 'credit', id: frame.id })) })
      }, close: () => { closed = true },
    }, authentication.current, 'https://mew.run', { ...authentication, alive: () => !closed && authentication.ready(), clientIp: '198.51.100.10' })
    const until = async (predicate: () => boolean) => {
      const deadline = performance.now() + 4000
      while (!predicate()) { if (performance.now() > deadline) throw new Error('Trusted browser request timed out'); await new Promise(resolve => setTimeout(resolve, 5)) }
    }
    const request = async (url: string, method = 'GET', body?: unknown) => {
      const id = String(++sequence)
      await dispatcher.receive(JSON.stringify({ type: 'request', id, method, path: url, headers: { 'content-type': 'application/json' } }))
      if (body !== undefined) await dispatcher.receive(JSON.stringify({ type: 'chunk', id, data: Buffer.from(JSON.stringify(body)).toString('base64') }))
      if (method !== 'GET' && method !== 'HEAD') await dispatcher.receive(JSON.stringify({ type: 'end', id }))
      await until(() => frames.some(frame => frame.id === id && frame.type === 'end'))
      const response = frames.find((frame): frame is Extract<RemoteFrame, { type: 'response' }> => frame.id === id && frame.type === 'response')!
      const bytes = frames.filter((frame): frame is Extract<RemoteFrame, { type: 'chunk' }> => frame.id === id && frame.type === 'chunk').map(frame => Buffer.from(frame.data, 'base64'))
      return { ...response, json: () => JSON.parse(Buffer.concat(bytes).toString()) }
    }
    t.after(() => { dispatcher.close(); wss.close(); server.closeAllConnections() })
    return { authentication, dispatcher, server, frames, until, request, closed: () => closed }
  }

  await t.test('trust replaces the password bearer and persists only a hashed, key-bound token', async () => {
    const bearer = auth.createSession('owner@example.test'), h = harness(bearer)
    const trust = await h.request('/api/auth/remote-device', 'POST', { label: ' 내 노트북 ' })
    assert.equal(trust.status, 200)
    assert.deepEqual(trust.json(), { ok: true })
    assert.equal(trust.headers['set-cookie'], undefined)
    const token = trust.headers['x-mew-session']
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(h.authentication.sessionToken(), token)
    assert.equal(auth.getSession(bearer), null)
    assert.equal(auth.getSession(token), null)
    assert.equal(auth.getSession(token, otherBrowser), null)
    assert.equal(auth.getSession(token, browserId)?.email, 'owner@example.test')
    const stored = fs.readFileSync(path.join(process.env.MEW_DATA_DIR!, 'sessions.json'), 'utf8')
    assert.equal(stored.includes(token), false)
    assert.equal(stored.includes(bearer), false)
    const restored = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import { getSession } from './server/auth.ts'
      const session = getSession(process.env.TEST_DEVICE_TOKEN, process.env.TEST_DEVICE_KEY)
      process.stdout.write(JSON.stringify({ email: session?.email, trusted: !!session?.trustedDevice }))
    `], { cwd: process.cwd(), env: { ...process.env, TEST_DEVICE_TOKEN: token, TEST_DEVICE_KEY: browserId }, encoding: 'utf8' })
    assert.equal(restored.status, 0, restored.stderr)
    assert.deepEqual(JSON.parse(restored.stdout), { email: 'owner@example.test', trusted: true })
    const resumed = harness(token)
    const me = (await resumed.request('/api/auth/me')).json()
    assert.equal(me.authenticated, true)
    assert.equal(me.trustedDevice, true)
    assert.equal(me.deviceId, browserId)
    assert.equal(me.authenticationMethod, 'password')
    assert.equal((await harness(token, null, otherBrowser).request('/api/work')).status, 401)
    assert.equal((await resumed.request('/api/auth/logout', 'POST')).status, 200)
    assert.equal(h.authentication.current(), null)
    assert.equal(auth.getSession(token, browserId), null)
  })

  await t.test('trust requires completed authentication and rejects invalid labels or ordinary HTTP', async () => {
    assert.equal((await harness().request('/api/auth/remote-device', 'POST', { label: '기기' })).status, 401)
    assert.equal((await harness(auth.createSession('temporary@example.test')).request('/api/auth/remote-device', 'POST', { label: '기기' })).status, 403)
    const bearer = auth.createSession('owner@example.test'), h = harness(bearer)
    for (const label of ['', 'x'.repeat(121), '기기\n이름', '\u0085', null, 123]) {
      assert.equal((await h.request('/api/auth/remote-device', 'POST', { label })).status, 400)
    }
    assert.equal(h.authentication.sessionToken(), bearer)
    await new Promise<void>(resolve => h.server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise<void>(resolve => { h.server.closeAllConnections(); h.server.close(() => resolve()) }))
    const origin = `http://127.0.0.1:${(h.server.address() as { port: number }).port}`
    const response = await fetch(origin + '/api/auth/remote-device', { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: `mew_session=${bearer}` }, body: JSON.stringify({ label: '기기' }) })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('x-mew-session'), null)
    assert.ok(auth.getSession(bearer))
  })

  await t.test('matching-key activity renews at most daily and successful resumes reset inactivity', async subt => {
    const now = Date.now(), authentication = createRemoteAuthentication(null, browserId)
    authentication.resume(auth.createSession('member@example.test'))
    const token = await authentication.trustDevice('태블릿')
    const file = path.join(process.env.MEW_DATA_DIR!, 'sessions.json'), before = fs.readFileSync(file, 'utf8')
    subt.mock.timers.enable({ apis: ['Date'], now: now + 12 * 60 * 60 * 1000 })
    assert.equal(createRemoteAuthentication(null, otherBrowser).resume(token), null)
    assert.ok(authentication.current())
    assert.ok(auth.getSession(token, browserId))
    assert.equal(fs.readFileSync(file, 'utf8'), before)
    assert.equal(createRemoteAuthentication(null, browserId).resume(token)?.label, '태블릿')
    const after = fs.readFileSync(file, 'utf8')
    assert.notEqual(after, before)
    subt.mock.timers.setTime(now + 24 * 60 * 60 * 1000)
    assert.ok(auth.getSession(token, browserId))
    assert.equal(fs.readFileSync(file, 'utf8'), after)
    subt.mock.timers.setTime(now + 36 * 60 * 60 * 1000)
    assert.ok(authentication.current())
    const active = fs.readFileSync(file, 'utf8')
    assert.notEqual(active, after)
    subt.mock.timers.setTime(now + 37 * 60 * 60 * 1000)
    assert.ok(authentication.current())
    assert.equal(fs.readFileSync(file, 'utf8'), active)
    subt.mock.timers.setTime(now + 92 * 24 * 60 * 60 * 1000)
    assert.equal(auth.getSession(token, browserId), null)
  })

  await t.test('external trust resumes without a central identity but cannot survive link revocation or reapproval', async () => {
    const identity: MewlinkIdentity = { issuer: 'https://mew.run', subject: 'trusted_external_abcdefghijklmnop', displayName: '외부 사용자', provider: 'google', username: null }
    const request = identities.requestMewlinkAccess(identity), link = identities.approveMewlinkRequest(request.id, { accountId: 'member@example.test' })
    const authentication = createRemoteAuthentication(identity, browserId), token = await authentication.trustDevice('휴대폰')
    const resumed = harness(token)
    const me = (await resumed.request('/api/auth/me')).json()
    assert.equal(me.email, 'member@example.test')
    assert.equal(me.authenticationMethod, 'mewlink')
    assert.equal(me.trustedDevice, true)
    await resumed.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'external-socket', path: '/api/presence' }))
    await resumed.until(() => resumed.frames.some(frame => frame.id === 'external-socket' && frame.type === 'open'))
    identities.unlinkMewlinkIdentity(link.id)
    resumed.dispatcher.revalidate()
    assert.ok(resumed.frames.some(frame => frame.id === 'external-socket' && frame.type === 'error' && frame.code === 'permission-revoked'))
    const again = identities.requestMewlinkAccess(identity)
    identities.approveMewlinkRequest(again.id, { accountId: 'owner@example.test' })
    assert.equal(resumed.authentication.current(), null)
    assert.equal(auth.getSession(token, browserId), null)
    assert.equal((await resumed.request('/api/work')).status, 401)
    const fresh = createRemoteAuthentication(identity, browserId)
    const next = await fresh.trustDevice('휴대폰')
    assert.equal(auth.getSession(next, browserId)?.email, 'owner@example.test')
    auth.upsertUser('owner@example.test', { ...auth.getUser('owner@example.test')!, passwordChangedAt: Date.now() + 1 })
    assert.equal(fresh.current(), null)
    assert.equal(auth.getSession(next, browserId), null)
    auth.upsertUser('owner@example.test', { ...auth.getUser('owner@example.test')!, passwordChangedAt: 0 })
  })

  await t.test('trust transitions close prior work and delayed trust requests cannot change the next account', async () => {
    const h = harness(auth.createSession('owner@example.test'))
    await h.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'old-work', path: '/api/presence' }))
    await h.until(() => h.frames.some(frame => frame.id === 'old-work' && frame.type === 'open'))
    const trusted = await h.request('/api/auth/remote-device', 'POST', { label: '데스크톱' })
    assert.equal(trusted.status, 200)
    assert.ok(h.frames.some(frame => frame.id === 'old-work' && frame.type === 'error' && frame.code === 'permission-revoked'))
    await h.dispatcher.receive(JSON.stringify({ type: 'request', id: 'stale-trust', method: 'POST', path: '/api/auth/remote-device', headers: { 'content-type': 'application/json' } }))
    await h.dispatcher.receive(JSON.stringify({ type: 'chunk', id: 'stale-trust', data: Buffer.from('{"label":"이전 계정"}').toString('base64') }))
    await new Promise(resolve => setImmediate(resolve))
    const login = await h.request('/api/auth/login', 'POST', { email: 'member@example.test', password })
    assert.equal(login.status, 200)
    await h.dispatcher.receive(JSON.stringify({ type: 'end', id: 'stale-trust' }))
    assert.ok(h.frames.some(frame => frame.id === 'stale-trust' && frame.type === 'error' && frame.code === 'permission-revoked'))
    const me = (await h.request('/api/auth/me')).json()
    assert.equal(me.email, 'member@example.test')
    assert.equal(me.trustedDevice, false)
    assert.equal(h.closed(), false)
  })
})
