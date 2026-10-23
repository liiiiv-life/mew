import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import {
  parseMewlinkIdentity, type MewlinkIdentity, type MewlinkAccessStatus,
  type MewlinkAccessRequest, type MewlinkAccessOverview,
} from '../shared/mewlink-identity.ts'
import type { RequestAuth } from './reqAuth.ts'

const identity: MewlinkIdentity = {
  issuer: 'https://mew.example.test', subject: 'central_account_subject_1',
  displayName: 'OAuth Member', provider: 'google', username: 'oauth-member',
}

test('identity proof has a strict issuer/subject namespace and bounded public fields', () => {
  assert.deepEqual(parseMewlinkIdentity(identity, identity.issuer), identity)
  for (const invalid of [
    { ...identity, issuer: 'http://mew.example.test' },
    { ...identity, issuer: 'https://mew.example.test/' },
    { ...identity, issuer: 'https://user@mew.example.test' },
    { ...identity, subject: 'short' },
    { ...identity, subject: 'a'.repeat(65) },
    { ...identity, provider: 'unknown' },
    { ...identity, displayName: 'name\n' },
    { ...identity, username: undefined },
  ]) assert.equal(parseMewlinkIdentity(invalid), null)
  assert.equal(parseMewlinkIdentity(identity, 'https://other.example.test'), null)
})

test('owner approvals separate local accounts from password and central identities', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-identity-test-'))
  process.env.MEW_DATA_DIR = temporary
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const auth = await import('./auth.ts')
  const links = await import('./mewlink-identities.ts')
  const { accessChanges } = await import('./access-policy.ts')
  const password = 'existing-local-password'
  const file = path.join(temporary, 'users.json')
  const legacy = {
    hash: auth.hashPassword(password), role: 'owner' as const, mustChangePassword: true,
    createdAt: 1, passwordChangedAt: 0, displayName: 'Legacy Owner',
  }
  fs.writeFileSync(file, JSON.stringify({ version: 1, users: { 'owner@example.test': legacy } }))

  await t.test('registration ownership and historical member maps are not local access approvals', () => {
    fs.writeFileSync(path.join(temporary, 'remote-access.json'), JSON.stringify({
      version: 1, registration: {
        origin: identity.issuer, instance: 'registered-instance', owner: identity.subject, name: 'my-device',
        publicKey: { kty: 'OKP' }, privateKey: { kty: 'OKP', d: 'test-key' }, centralKey: { kty: 'OKP' },
        accounts: { [identity.subject]: 'owner@example.test' },
      },
    }))
    assert.equal(links.resolveMewlinkSession(identity), null)
    assert.equal(links.getMewlinkAccessStatus(identity).state, 'unlinked')
    assert.equal(auth.listUsers().length, 1)
  })

  await t.test('legacy accounts keep their original IDs, credential and active sessions across atomic migration', () => {
    assert.equal(auth.getUser('OWNER@example.test')?.hash, legacy.hash)
    const token = auth.createSession('owner@example.test')
    const request = links.requestMewlinkAccess(identity)
    const document = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(document.version, 2)
    assert.equal(document.accounts['owner@example.test'].id, 'owner@example.test')
    assert.equal(document.accounts['owner@example.test'].hash, undefined)
    assert.equal(document.accounts['owner@example.test'].mustChangePassword, undefined)
    assert.equal(document.passwordCredentials['owner@example.test'].hash, legacy.hash)
    assert.equal(auth.getSession(token)?.email, 'owner@example.test')
    assert.equal(auth.getSession(token)?.user.mustChangePassword, true)
    assert.equal(request.status, 'pending')
    assert.equal(links.resolveMewlinkSession(identity), null)
    assert.equal(links.requestMewlinkAccess({ ...identity, displayName: 'Changed after request' }).id, request.id)
    assert.equal(links.listMewlinkAccess().requests[0].identity.displayName, identity.displayName)
  })

  let firstLinkId = ''
  await t.test('new OAuth approval creates a passwordless account and never infers local email identity', () => {
    const request = links.listMewlinkAccess().requests[0]
    assert.throws(() => links.approveMewlinkRequest(request.id, { accountId: 'missing@example.test' }), { status: 404 })
    assert.throws(() => links.approveMewlinkRequest(request.id, { accountId: 'constructor' }), { status: 404 })
    assert.equal(auth.getUser('constructor'), null)
    assert.throws(() => links.approveMewlinkRequest('constructor', {}), { status: 404 })
    assert.equal(auth.listUsers().length, 1, 'a failed approval leaves no account')
    assert.throws(() => links.approveMewlinkRequest(request.id, { role: 'owner' }), { status: 400 })
    const link = links.approveMewlinkRequest(request.id, {})
    firstLinkId = link.id
    assert.match(link.accountId, /^account_[a-f0-9]{32}$/)
    assert.equal(auth.isValidEmail(link.accountId), false)
    const user = auth.getUser(link.accountId)!
    assert.equal(user.role, 'member')
    assert.equal(user.hasPassword, false)
    assert.equal(user.hash, '')
    assert.equal(user.contactEmail, undefined)
    assert.equal(auth.readAccountDirectory().passwordCredentials[link.accountId], undefined)
    const session = links.resolveMewlinkSession(identity)!
    assert.equal(session.email, link.accountId)
    assert.equal(session.authenticationMethod, 'mewlink')
    assert.equal(session.credentialId, link.id)
    auth.upsertUser(link.accountId, { ...user, displayName: 'Updated Local Name', role: 'manager' })
    assert.equal(auth.readAccountDirectory().passwordCredentials[link.accountId], undefined)
    assert.equal(links.resolveMewlinkSession(identity)?.user.role, 'manager')
    assert.throws(() => links.approveMewlinkRequest(request.id, {}), { status: 409 }, 'processed approvals cannot be replayed')
  })

  await t.test('binding uses issuer and subject; local credentials remain independent even for an explicitly linked owner', () => {
    assert.equal(links.resolveMewlinkSession({ ...identity, issuer: 'https://other.example.test' }), null)
    assert.equal(links.resolveMewlinkSession({ ...identity, subject: 'central_account_subject_2' }), null)
    const other = { ...identity, subject: 'central_account_subject_2', displayName: 'owner@example.test' }
    assert.equal(links.resolveMewlinkSession(other), null, 'matching text is never an automatic account link')
    const request = links.requestMewlinkAccess(other)
    const link = links.approveMewlinkRequest(request.id, { accountId: 'owner@example.test' })
    assert.equal(link.accountId, 'owner@example.test')
    assert.equal(links.resolveMewlinkSession(other)?.user.mustChangePassword, false)
    assert.equal(auth.getUser('owner@example.test')?.mustChangePassword, true)
    assert.equal(auth.verifyPassword(password, auth.getUser('owner@example.test')!.hash), true)
    const original = auth.getUser('owner@example.test')!
    auth.upsertUser('owner@example.test', { ...original, hash: auth.hashPassword('reset-local-password'), passwordChangedAt: Date.now() + 1 })
    assert.equal(links.resolveMewlinkSession(other)?.credentialId, link.id)
  })

  await t.test('denial, pending expiry and unlink cannot be replayed or revive previous grants', () => {
    const deniedIdentity = { ...identity, subject: 'central_account_subject_3' }
    const denied = links.requestMewlinkAccess(deniedIdentity)
    links.denyMewlinkRequest(denied.id)
    assert.equal(links.getMewlinkAccessStatus(deniedIdentity).state, 'denied')
    assert.throws(() => links.approveMewlinkRequest(denied.id, {}), { status: 409 })
    assert.throws(() => links.requestMewlinkAccess(deniedIdentity), { status: 429 })
    const expiredIdentity = { ...identity, subject: 'central_account_subject_4' }
    const expired = links.requestMewlinkAccess(expiredIdentity)
    auth.mutateAccountDirectory(data => { data.mewlinkRequests[expired.id].expiresAt = Date.now() - 1 })
    assert.equal(links.getMewlinkAccessStatus(expiredIdentity).state, 'unlinked')
    assert.throws(() => links.approveMewlinkRequest(expired.id, {}), { status: 409 })
    assert.notEqual(links.requestMewlinkAccess(expiredIdentity).id, expired.id)
    let changes = 0
    const changed = () => { changes++ }
    accessChanges.on('change', changed)
    links.unlinkMewlinkIdentity(firstLinkId)
    accessChanges.off('change', changed)
    assert.equal(changes, 1)
    assert.equal(links.resolveMewlinkSession(identity), null)
    assert.equal(links.getMewlinkAccessStatus(identity).state, 'unlinked')
    assert.throws(() => links.unlinkMewlinkIdentity(firstLinkId), { status: 404 })
    const renewed = links.requestMewlinkAccess(identity)
    const link = links.approveMewlinkRequest(renewed.id, { role: 'manager' })
    assert.notEqual(link.id, firstLinkId)
    auth.removeUser(link.accountId)
    assert.equal(links.resolveMewlinkSession(identity), null)
    assert.equal(links.listMewlinkAccess().links.some(candidate => candidate.id === link.id), false)
  })

  await t.test('public request proof is transport-only and management routes are owner-only', async () => {
    const { createMewlinkAuthRouter, createMewlinkAdminRouter } = await import('./mewlink-auth-routes.ts')
    const { bindRemoteSocket } = await import('./remote-access-context.ts')
    const app = express(), server = http.createServer(app)
    let centralIdentity: MewlinkIdentity | null = null, verifiedTransport = false, activated = false
    let requester: RequestAuth = { role: 'guest', email: null, mustChangePassword: false }
    app.use((req, _res, next) => {
      req.auth = requester
      if (verifiedTransport) bindRemoteSocket(req.socket, {
        current: () => null, alive: () => true, identity: () => centralIdentity,
        activateMewlink: () => { activated = true },
      })
      next()
    })
    app.use('/api/auth/mewlink', createMewlinkAuthRouter())
    app.use('/api/admin/mewlink', createMewlinkAdminRouter())
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }, origin = `http://127.0.0.1:${address.port}`
    const request = (route: string, method = 'GET', body?: unknown) => fetch(origin + route, {
      method, headers: { 'content-type': 'application/json', 'connection': 'close' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    try {
      const before = links.listMewlinkAccess().requests.length
      assert.equal((await (await request('/api/auth/mewlink')).json() as MewlinkAccessStatus).state, 'unavailable')
      assert.equal((await request('/api/auth/mewlink/request', 'POST', { identity })).status, 401)
      assert.equal(links.listMewlinkAccess().requests.length, before)
      assert.equal((await request('/api/admin/mewlink')).status, 403)
      centralIdentity = { ...identity, subject: 'central_account_subject_5' }; verifiedTransport = true
      const requested = await (await request('/api/auth/mewlink/request', 'POST', { identity: { ...identity, subject: 'forged' } })).json() as { request: MewlinkAccessRequest }
      assert.equal(requested.request.identity.subject, centralIdentity.subject)
      assert.equal((await request('/api/auth/mewlink/login', 'POST')).status, 403)
      requester = { role: 'owner', email: 'owner@example.test', mustChangePassword: false }
      assert.equal((await request('/api/admin/mewlink/requests/' + requested.request.id + '/approve', 'POST', { role: 'member' })).status, 200)
      const login = await request('/api/auth/mewlink/login', 'POST')
      assert.equal(login.status, 200)
      assert.equal(activated, true)
      assert.equal(login.headers.get('x-mew-session'), '')
      assert.equal(login.headers.get('set-cookie'), null)
      assert.equal((await login.json() as { mustChangePassword: boolean }).mustChangePassword, false)
      const overview = await (await request('/api/admin/mewlink')).json() as MewlinkAccessOverview
      assert.equal(JSON.stringify(overview).includes(legacy.hash), false)
      const linked = overview.links.find((candidate: { identity: MewlinkIdentity }) => candidate.identity.subject === centralIdentity?.subject)
      assert.ok(linked)
      requester = { role: 'manager', email: 'owner@example.test', mustChangePassword: false }
      assert.equal((await request('/api/admin/mewlink/links/' + linked.id, 'DELETE')).status, 403)
      assert.ok(links.resolveMewlinkSession(centralIdentity!))
      requester = { role: 'owner', email: 'owner@example.test', mustChangePassword: false }
      assert.equal((await request('/api/admin/mewlink/links/' + linked.id, 'DELETE')).status, 200)
      assert.equal((await request('/api/auth/mewlink/login', 'POST')).status, 403)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  await t.test('pending quota excludes processed history and expiry, denial or approval frees a slot', () => {
    auth.mutateAccountDirectory(data => { data.mewlinkRequests = {} })
    for (let index = 0; index < 256; index++) {
      links.requestMewlinkAccess({ ...identity, subject: 'quota_subject_' + String(index).padStart(12, '0') })
    }
    const blocked = { ...identity, subject: 'quota_subject_after_capacity' }
    assert.throws(() => links.requestMewlinkAccess(blocked), { status: 429 })
    const existing = links.listMewlinkAccess().requests[0]
    const stamp = fs.statSync(file).mtimeMs
    assert.equal(links.requestMewlinkAccess(existing.identity).id, existing.id)
    assert.equal(fs.statSync(file).mtimeMs, stamp, 'deduplicated pending requests do not write')
    auth.mutateAccountDirectory(data => { data.mewlinkRequests[existing.id].expiresAt = Date.now() - 1 })
    assert.equal(links.requestMewlinkAccess(blocked).status, 'pending')
    assert.equal(links.listMewlinkAccess().requests.length, 256)
    const denied = links.listMewlinkAccess().requests.find(request => request.status === 'pending')!
    links.denyMewlinkRequest(denied.id)
    assert.equal(links.requestMewlinkAccess({ ...identity, subject: 'quota_subject_after_denial' }).status, 'pending')
    assert.throws(() => links.requestMewlinkAccess(denied.identity), { status: 429 }, 'recent denial remains throttled')
    const approved = links.listMewlinkAccess().requests.find(request => request.status === 'pending')!
    const link = links.approveMewlinkRequest(approved.id, { accountId: 'owner@example.test' })
    assert.equal(links.requestMewlinkAccess({ ...identity, subject: 'quota_subject_after_approval' }).status, 'pending')
    assert.equal(links.resolveMewlinkSession(approved.identity)?.credentialId, link.id)
    assert.throws(() => links.approveMewlinkRequest(approved.id, {}), { status: 409 })
    const requests = links.listMewlinkAccess().requests
    assert.equal(requests.filter(request => request.status === 'pending').length, 256)
    assert.equal(requests.filter(request => request.status !== 'pending').length, 2)
    assert.throws(() => links.requestMewlinkAccess({ ...identity, subject: 'quota_subject_over_pending' }), { status: 429 })
  })

  await t.test('decided history is bounded independently while newest approvals and denials remain usable', () => {
    auth.mutateAccountDirectory(data => { data.mewlinkRequests = {} })
    let oldestId = '', newestId = ''
    for (let index = 0; index < 257; index++) {
      const request = links.requestMewlinkAccess({ ...identity, subject: 'history_subject_' + String(index).padStart(12, '0') })
      if (!oldestId) oldestId = request.id
      newestId = request.id
      links.denyMewlinkRequest(request.id)
    }
    let requests = links.listMewlinkAccess().requests
    assert.equal(requests.filter(request => request.status !== 'pending').length, 256)
    assert.equal(requests.some(request => request.id === oldestId), false)
    const newest = requests.find(request => request.id === newestId)!
    assert.equal(newest.status, 'denied')
    assert.throws(() => links.requestMewlinkAccess(newest.identity), { status: 429 })
    const identityToApprove = { ...identity, subject: 'history_subject_approved_latest' }
    const approval = links.requestMewlinkAccess(identityToApprove)
    const link = links.approveMewlinkRequest(approval.id, { accountId: 'owner@example.test' })
    requests = links.listMewlinkAccess().requests
    assert.equal(requests.length, 256)
    assert.equal(requests.find(request => request.id === approval.id)?.status, 'approved')
    assert.throws(() => links.approveMewlinkRequest(approval.id, {}), { status: 409 })
    assert.equal(links.resolveMewlinkSession(identityToApprove)?.credentialId, link.id)
    for (let index = 0; index < 256; index++) {
      links.requestMewlinkAccess({ ...identity, subject: 'pending_with_history_' + String(index).padStart(8, '0') })
    }
    requests = links.listMewlinkAccess().requests
    assert.equal(requests.filter(request => request.status === 'pending').length, 256)
    assert.equal(requests.filter(request => request.status !== 'pending').length, 256)
    assert.throws(() => links.requestMewlinkAccess({ ...identity, subject: 'pending_with_history_blocked' }), { status: 429 })
  })

  await t.test('corrupt account state is preserved and cannot be overwritten by approval writes', () => {
    const original = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, '{invalid-json')
    assert.throws(() => auth.getUser('owner@example.test'), /깨졌습니다/)
    assert.throws(() => links.requestMewlinkAccess(identity), /깨졌습니다/)
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid-json')
    assert.ok(fs.readdirSync(temporary).some(name => name.startsWith('users.json.corrupt-')))
    fs.writeFileSync(file, JSON.stringify({ version: 2, accounts: [], passwordCredentials: {}, mewlinkIdentities: {}, mewlinkRequests: {} }))
    assert.throws(() => auth.getUser('owner@example.test'), /형식/)
    fs.writeFileSync(file, original)
    assert.equal(auth.getUser('owner@example.test')?.role, 'owner')
  })

  await t.test('legacy records without a role remain members after a profile write', () => {
    const original = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, JSON.stringify({ version: 1, users: { 'old@example.test': { ...legacy, role: undefined } } }))
    const user = auth.getUser('old@example.test')!
    assert.equal(user.role, 'member')
    auth.upsertUser('old@example.test', { ...user, displayName: 'Old User' })
    assert.equal(auth.getUser('old@example.test')?.role, 'member')
    assert.equal(auth.verifyPassword(password, auth.getUser('old@example.test')!.hash), true)
    fs.writeFileSync(file, original)
  })
})
