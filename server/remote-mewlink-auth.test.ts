import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { WebSocketServer } from 'ws'
import type { RemoteFrame } from '../shared/remote-access.ts'
import type { MewlinkIdentity } from '../shared/mewlink-identity.ts'

test('owner-approved external identity uses local permissions without creating a password session', { timeout: 30_000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-remote-identity-'))
  process.env.MEW_DATA_DIR = path.join(temporary, 'data')
  const auth = await import('./auth.ts')
  const identities = await import('./mewlink-identities.ts')
  const { createRemoteAuthentication, REMOTE_LOGIN_TIMEOUT } = await import('./remote-authentication.ts')
  const { createAuthRouter, checkOrigin } = await import('./authRoutes.ts')
  const { createMewlinkAdminRouter } = await import('./mewlink-auth-routes.ts')
  const { attachAuthContext, resolveAuth } = await import('./reqAuth.ts')
  const { remoteDispatcher } = await import('./remote-access-dispatch.ts')
  const { accessRevision } = await import('./access-policy.ts')
  const password = 'local-owner-password-2026'
  auth.upsertUser('owner@example.test', { hash: auth.hashPassword(password), role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 })
  auth.upsertUser('temporary@example.test', { hash: auth.hashPassword(password), role: 'member', mustChangePassword: true, createdAt: 1, passwordChangedAt: 0 })
  const identity: MewlinkIdentity = { issuer: 'https://mew.saens.kr', subject: 'external_account_abcdefghijklmnop', displayName: '외부 사용자', provider: 'google', username: 'external-user' }
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

  function harness(identity: MewlinkIdentity | null = null, initial: string | null = null) {
    const authentication = createRemoteAuthentication(identity)
    authentication.resume(initial)
    let closed = false, sequence = 0
    const app = express(), server = http.createServer(app), frames: RemoteFrame[] = []
    app.use(checkOrigin)
    app.use('/api/auth', createAuthRouter())
    app.use('/api', attachAuthContext)
    app.use('/api/admin/mewlink', createMewlinkAdminRouter())
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
    }, authentication.current, identity?.issuer ?? 'https://mew.saens.kr', {
      alive: () => !closed && authentication.ready(), ...authentication, clientIp: '198.51.100.9', accessRevision,
    })
    const until = async (predicate: () => boolean) => {
      const deadline = performance.now() + 4000
      while (!predicate()) { if (performance.now() > deadline) throw new Error('External login request timed out'); await new Promise(resolve => setTimeout(resolve, 5)) }
    }
    const request = async (url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
      const id = String(++sequence)
      await dispatcher.receive(JSON.stringify({ type: 'request', id, method, path: url, headers: { 'content-type': 'application/json', ...headers } }))
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

  const owner = harness(null, auth.createSession('owner@example.test'))
  const visitor = harness(identity)
  let accountId = '', linkId = ''

  await t.test('central identities and browser-supplied emails cannot grant local rights', async () => {
    assert.equal((await visitor.request('/api/auth/me')).json().authenticated, false)
    assert.equal((await visitor.request('/api/work')).status, 401)
    assert.equal((await visitor.request('/api/admin/mewlink')).status, 401)
    assert.equal((await visitor.request('/api/auth/mewlink/login', 'POST')).status, 403)
    const anonymous = harness()
    assert.equal((await anonymous.request('/api/auth/mewlink')).json().state, 'unavailable')
    assert.equal((await anonymous.request('/api/auth/mewlink/request', 'POST', { identity, email: 'owner@example.test' }, { 'x-mew-identity': identity.subject })).status, 401)
    const requested = await visitor.request('/api/auth/mewlink/request', 'POST', { identity: { ...identity, subject: 'owner@example.test' }, role: 'owner' })
    assert.equal(requested.status, 200)
    assert.equal(requested.json().state, 'pending')
    assert.deepEqual(requested.json().identity, identity)
    assert.equal(auth.listUsers().length, 2)
    const again = await visitor.request('/api/auth/mewlink/request', 'POST')
    assert.equal(again.json().request.id, requested.json().request.id)
  })

  await t.test('owner approval creates a passwordless member atomically and pending connections activate explicitly', async () => {
    const pending = (await owner.request('/api/admin/mewlink')).json().requests[0]
    assert.equal((await owner.request(`/api/admin/mewlink/requests/${pending.id}/approve`, 'POST', { role: 'owner' })).status, 400)
    assert.equal(auth.listUsers().length, 2)
    const approved = await owner.request(`/api/admin/mewlink/requests/${pending.id}/approve`, 'POST', { displayName: '동료' })
    assert.equal(approved.status, 200)
    accountId = approved.json().link.accountId; linkId = approved.json().link.id
    assert.match(accountId, /^account_[a-f0-9]+$/)
    assert.equal(auth.getUser(accountId)!.hash, '')
    assert.equal(auth.getUser(accountId)!.role, 'member')
    assert.equal(visitor.authentication.current(), null, 'approval cannot silently change authority of an existing connection')
    const entered = await visitor.request('/api/auth/mewlink/login', 'POST')
    assert.equal(entered.status, 200)
    assert.equal(entered.headers['x-mew-session'], '')
    assert.equal(visitor.authentication.sessionToken(), null)
    const status = (await visitor.request('/api/auth/me')).json()
    assert.equal(status.email, accountId)
    assert.equal(status.authenticationMethod, 'mewlink')
    assert.equal(status.hasPassword, false)
    assert.equal(status.capabilities.filesRead, true)
    assert.equal(status.capabilities.terminal, false)
    assert.equal((await visitor.request('/api/work')).json().email, accountId)
    assert.equal((await visitor.request('/api/admin/mewlink')).status, 403)
    assert.equal((await visitor.request('/api/auth/profile', 'PUT', { displayName: '새 이름', avatarDataUrl: null })).status, 200)
    assert.equal(auth.getUser(accountId)!.displayName, '새 이름')
    assert.equal(auth.getUser(accountId)!.hasPassword, false)
    assert.equal((await visitor.request('/api/auth/change-password', 'POST', { currentPassword: '', newPassword: password })).status, 403)
    assert.equal((await owner.request(`/api/admin/mewlink/requests/${pending.id}/approve`, 'POST', {})).status, 409)
  })

  await t.test('unlink closes existing work and reapproval cannot revive a pinned grant', async () => {
    await visitor.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'external-work', path: '/api/presence' }))
    await visitor.until(() => visitor.frames.some(frame => frame.id === 'external-work' && frame.type === 'open'))
    assert.equal((await owner.request(`/api/admin/mewlink/links/${linkId}`, 'DELETE')).status, 200)
    visitor.dispatcher.revalidate()
    assert.ok(visitor.frames.some(frame => frame.id === 'external-work' && frame.type === 'error' && frame.code === 'permission-revoked'))
    assert.equal((await visitor.request('/api/work')).status, 401)
    const request = await visitor.request('/api/auth/mewlink/request', 'POST')
    const approval = await owner.request(`/api/admin/mewlink/requests/${request.json().request.id}/approve`, 'POST', { accountId })
    assert.equal(approval.status, 200)
    assert.notEqual(approval.json().link.id, linkId)
    assert.equal(visitor.authentication.current(), null)
    assert.equal((await visitor.request('/api/auth/mewlink/login', 'POST')).status, 200)
    assert.equal((await harness(identity).request('/api/auth/me')).json().email, accountId, 'fresh approved connections sign in without a local password')
  })

  await t.test('logout and revoked password sessions never fall back to a central account', async () => {
    assert.equal((await visitor.request('/api/auth/logout', 'POST')).status, 200)
    assert.equal((await visitor.request('/api/auth/me')).json().authenticated, false)
    assert.equal((await visitor.request('/api/work')).status, 401)
    assert.equal((await visitor.request('/api/auth/mewlink/login', 'POST')).status, 200)
    const token = auth.createSession('owner@example.test'), resumed = harness(identity, token)
    assert.equal(resumed.authentication.current()?.email, 'owner@example.test')
    auth.destroySession(token)
    assert.equal(resumed.authentication.current(), null)
    assert.equal((await resumed.request('/api/work')).status, 401)
  })

  await t.test('external profile edits cannot clear a linked password credential’s temporary-password requirement', async () => {
    const temporaryIdentity = { ...identity, subject: 'temporary_external_abcdefghijklmnop' }
    const request = identities.requestMewlinkAccess(temporaryIdentity)
    identities.approveMewlinkRequest(request.id, { accountId: 'temporary@example.test' })
    const temporary = harness(temporaryIdentity)
    assert.equal((await temporary.request('/api/auth/me')).json().mustChangePassword, false)
    assert.equal((await temporary.request('/api/auth/profile', 'PUT', { displayName: '임시 계정', avatarDataUrl: null })).status, 200)
    assert.equal(auth.getUser('temporary@example.test')!.mustChangePassword, true)
    const local = harness(null, auth.createSession('temporary@example.test'))
    assert.equal((await local.request('/api/work')).status, 403)
  })

  await t.test('stale login operations cannot switch an account after another authentication transition', async () => {
    const h = harness(identity)
    await h.dispatcher.receive(JSON.stringify({ type: 'request', id: 'delayed-external-login', method: 'POST', path: '/api/auth/mewlink/login', headers: { 'content-type': 'application/json' } }))
    await h.dispatcher.receive(JSON.stringify({ type: 'chunk', id: 'delayed-external-login', data: Buffer.from('{}').toString('base64') }))
    await new Promise(resolve => setImmediate(resolve))
    const passwordLogin = await h.request('/api/auth/login', 'POST', { email: 'owner@example.test', password })
    assert.equal(passwordLogin.status, 200)
    assert.ok(h.frames.some(frame => frame.id === 'delayed-external-login' && frame.type === 'error' && frame.code === 'permission-revoked'))
    await h.dispatcher.receive(JSON.stringify({ type: 'end', id: 'delayed-external-login' }))
    assert.equal((await h.request('/api/auth/me')).json().email, 'owner@example.test')
  })

  await t.test('self-link requires a live verified identity and a completed password login', async () => {
    const selfIdentity = { ...identity, subject: 'self_link_unapproved_abcdefghijklmnop' }
    const anonymous = harness(selfIdentity)
    assert.equal((await anonymous.request('/api/auth/mewlink/link', 'POST', { previousAccountId: null })).status, 401)
    const external = harness(identity)
    assert.equal((await external.request('/api/auth/mewlink/link', 'POST', { previousAccountId: null })).status, 403)
    const localOnly = harness(null, auth.createSession('owner@example.test'))
    assert.equal((await localOnly.request('/api/auth/mewlink/link', 'POST', { identity: selfIdentity, previousAccountId: null }, { 'x-mew-identity': selfIdentity.subject })).status, 401)
    const temporary = harness(selfIdentity, auth.createSession('temporary@example.test'))
    assert.equal((await temporary.request('/api/auth/mewlink/link', 'POST', { previousAccountId: null })).status, 403)
    assert.equal(identities.resolveMewlinkSession(selfIdentity), null)

    auth.upsertUser('self@example.test', { hash: auth.hashPassword(password), role: 'member', displayName: '기존 이메일 사용자', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 })
    const pending = identities.requestMewlinkAccess(selfIdentity)
    const before = auth.listUsers().length
    const loggedIn = await anonymous.request('/api/auth/login', 'POST', { email: 'self@example.test', password })
    assert.equal(loggedIn.status, 200)
    assert.equal((await anonymous.request('/api/auth/mewlink/link', 'POST', {})).status, 400)
    assert.equal((await anonymous.request('/api/auth/mewlink/link', 'POST', { previousAccountId: 'changed@example.test' })).status, 409)
    const linked = await anonymous.request('/api/auth/mewlink/link', 'POST', {
      previousAccountId: null, accountId: 'owner@example.test', identity: { ...identity, subject: 'forged' }, role: 'owner',
    })
    assert.equal(linked.status, 200)
    assert.equal(linked.json().link.accountId, 'self@example.test')
    assert.deepEqual(linked.json().link.identity, selfIdentity)
    assert.equal(auth.listUsers().length, before)
    assert.equal(identities.listMewlinkAccess().requests.some(request => request.id === pending.id), false)
    assert.equal((await anonymous.request('/api/auth/me')).json().authenticationMethod, 'password')
    const fresh = harness(selfIdentity)
    assert.equal(fresh.authentication.current()?.email, 'self@example.test')
    assert.equal(fresh.authentication.current()?.user.role, 'member')
    assert.equal(fresh.authentication.current()?.user.displayName, '기존 이메일 사용자')
    assert.equal((await anonymous.request('/api/auth/mewlink/link', 'POST', { previousAccountId: null })).json().link.id, linked.json().link.id)
    auth.destroySession(anonymous.authentication.sessionToken())
    assert.equal((await anonymous.request('/api/auth/mewlink/link', 'POST', { previousAccountId: 'self@example.test' })).status, 401)
  })

  await t.test('a self-link removes the merged external account and revokes its grants while preserving files', async subtest => {
    const selfIdentity = { ...identity, subject: 'self_link_approved_abcdefghijklmnop' }
    const pending = identities.requestMewlinkAccess(selfIdentity)
    const original = identities.approveMewlinkRequest(pending.id, { displayName: '별도 Mewlink 사용자' })
    auth.upsertUser(original.accountId, { ...auth.getUser(original.accountId)!, role: 'owner' })
    const before = auth.listUsers().length
    const browserKey = 'b'.repeat(43)
    const trusted = auth.createTrustedDeviceSession(identities.resolveMewlinkSession(selfIdentity)!, browserKey, 'Old external browser')
    const personalFile = path.join(temporary, 'preserved-history.txt')
    fs.writeFileSync(personalFile, 'Previous work history')
    const policyFile = path.join(process.env.MEW_DATA_DIR!, 'access-policy.json')
    fs.writeFileSync(policyFile, JSON.stringify({ version: 1,
      features: { [original.accountId]: { terminal: true }, 'owner@example.test': { browser: false } },
      workspaces: { first: { [original.accountId]: [{ path: '', access: 'edit' }] }, second: { [original.accountId]: [] } },
    }))
    const { gitConnections } = await import('./git-connections.ts')
    gitConnections.set(original.accountId, { provider: 'github', host: 'github.com', login: 'old-user', accessToken: 'test-token', identity: { email: 'old@example.test', name: 'Old user' } })
    const old = harness(selfIdentity)
    await old.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'old-self-work', path: '/api/presence' }))
    await old.until(() => old.frames.some(frame => frame.id === 'old-self-work' && frame.type === 'open'))
    const linking = harness(selfIdentity)
    assert.equal((await linking.request('/api/auth/login', 'POST', { email: 'owner@example.test', password })).status, 200)
    const { accessChanges } = await import('./access-policy.ts')
    const revalidate = () => { old.dispatcher.revalidate(); linking.dispatcher.revalidate() }
    accessChanges.on('change', revalidate)
    subtest.after(() => accessChanges.off('change', revalidate))
    const targetAccount = auth.getUser('owner@example.test')
    const stale = await linking.request('/api/auth/mewlink/link', 'POST', { previousAccountId: null })
    assert.equal(stale.status, 409)
    assert.equal(identities.resolveMewlinkSession(selfIdentity)?.credentialId, original.id)
    assert.ok(auth.getUser(original.accountId), 'a stale merge must not delete its source')
    const result = await linking.request('/api/auth/mewlink/link', 'POST', { previousAccountId: original.accountId })
    assert.equal(result.status, 200)
    assert.notEqual(result.json().link.id, original.id)
    assert.equal(auth.getUser(original.accountId), null)
    assert.equal(auth.listUsers().length, before - 1)
    assert.equal(auth.listUsers().some(user => user.email === original.accountId), false)
    const storedSessions = JSON.parse(fs.readFileSync(path.join(process.env.MEW_DATA_DIR!, 'sessions.json'), 'utf8')) as Record<string, { email: string }>
    assert.ok(Object.values(storedSessions).every(session => session.email !== original.accountId))
    assert.equal(auth.getSession(trusted, browserKey), null)
    assert.equal(gitConnections.get(original.accountId, 'github', 'github.com'), null)
    assert.equal(fs.readFileSync(personalFile, 'utf8'), 'Previous work history')
    const access = JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    assert.equal(Object.hasOwn(access.features, original.accountId), false)
    assert.deepEqual(access.features['owner@example.test'], { browser: false })
    assert.ok(Object.values(access.workspaces).every(subjects => !Object.hasOwn(subjects as object, original.accountId)))
    assert.deepEqual(auth.getUser('owner@example.test'), targetAccount)
    assert.equal(old.authentication.current(), null, 'old sessions cannot inherit the target owner role')
    old.dispatcher.revalidate()
    assert.ok(old.frames.some(frame => frame.id === 'old-self-work' && frame.type === 'error' && frame.code === 'permission-revoked'))
    assert.equal((await old.request('/api/work')).status, 401)
    assert.equal((await linking.request('/api/auth/me')).json().email, 'owner@example.test')
    assert.equal(harness(selfIdentity).authentication.current()?.email, 'owner@example.test')
    assert.equal(identities.listMewlinkAccess().links.filter(link => link.identity.subject === selfIdentity.subject).length, 1)
    const again = await linking.request('/api/auth/mewlink/link', 'POST', { previousAccountId: original.accountId })
    assert.equal(again.status, 200)
    assert.equal(again.json().link.id, result.json().link.id)
    assert.equal(auth.listUsers().length, before - 1)
  })

  await t.test('moving one identity preserves accounts with a password or another identity', async () => {
    const passwordIdentity = { ...identity, subject: 'self_link_password_source_12345678' }
    auth.upsertUser('source@example.test', { hash: auth.hashPassword(password), role: 'member', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 })
    identities.linkMewlinkToAccount(passwordIdentity, 'source@example.test', null)
    identities.linkMewlinkToAccount(passwordIdentity, 'owner@example.test', 'source@example.test')
    assert.ok(auth.getUser('source@example.test')?.hasPassword)

    const firstIdentity = { ...identity, subject: 'self_link_multiple_source_12345678' }
    const secondIdentity = { ...identity, subject: 'self_link_multiple_other_123456789' }
    const source = identities.approveMewlinkRequest(identities.requestMewlinkAccess(firstIdentity).id, {})
    identities.approveMewlinkRequest(identities.requestMewlinkAccess(secondIdentity).id, { accountId: source.accountId })
    identities.linkMewlinkToAccount(firstIdentity, 'owner@example.test', source.accountId)
    assert.ok(auth.getUser(source.accountId))
    assert.equal(identities.resolveMewlinkSession(secondIdentity)?.email, source.accountId)
    identities.linkMewlinkToAccount(secondIdentity, 'owner@example.test', source.accountId)
    assert.equal(auth.getUser(source.accountId), null, 'the source is removed once its final identity is merged')
  })

  await t.test('merging cannot delete the last owner or upgrade the destination role', () => {
    const selfIdentity = { ...identity, subject: 'self_link_last_owner_123456789012' }
    const source = identities.approveMewlinkRequest(identities.requestMewlinkAccess(selfIdentity).id, {})
    const previousOwner = auth.getUser('owner@example.test')!
    auth.upsertUser('owner@example.test', { ...previousOwner, role: 'member' })
    auth.upsertUser(source.accountId, { ...auth.getUser(source.accountId)!, role: 'owner' })
    try {
      assert.throws(() => identities.linkMewlinkToAccount(selfIdentity, 'self@example.test', source.accountId), { status: 409 })
      assert.equal(identities.resolveMewlinkSession(selfIdentity)?.credentialId, source.id)
      assert.equal(auth.getUser(source.accountId)?.role, 'owner')
      assert.equal(auth.getUser('self@example.test')?.role, 'member')
    } finally { auth.upsertUser('owner@example.test', previousOwner) }
  })

  await t.test('a delayed self-link cannot run after a password session transition', async () => {
    const selfIdentity = { ...identity, subject: 'self_link_delayed_abcdefghijklmnop' }
    const h = harness(selfIdentity, auth.createSession('owner@example.test'))
    await h.dispatcher.receive(JSON.stringify({ type: 'request', id: 'delayed-self-link', method: 'POST', path: '/api/auth/mewlink/link', headers: { 'content-type': 'application/json' } }))
    await h.dispatcher.receive(JSON.stringify({ type: 'chunk', id: 'delayed-self-link', data: Buffer.from('{"previousAccountId":null}').toString('base64') }))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await h.request('/api/auth/login', 'POST', { email: 'self@example.test', password })).status, 200)
    await h.dispatcher.receive(JSON.stringify({ type: 'end', id: 'delayed-self-link' }))
    assert.ok(h.frames.some(frame => frame.id === 'delayed-self-link' && frame.type === 'error' && frame.code === 'permission-revoked'))
    assert.equal(identities.resolveMewlinkSession(selfIdentity), null)
  })

  await t.test('anonymous login windows remain bounded when no local or approved identity authenticates', async subt => {
    const authentication = createRemoteAuthentication(null)
    const now = Date.now()
    assert.equal(authentication.ready(), true)
    subt.mock.timers.enable({ apis: ['Date'], now: now + REMOTE_LOGIN_TIMEOUT + 1 })
    assert.equal(authentication.ready(), false)
  })
})
