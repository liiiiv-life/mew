import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import express from 'express'
import test from 'node:test'
import type { RequestAuth } from './reqAuth.ts'

test('account deletion revokes credentials and permissions while preserving personal files', { timeout: 30_000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-admin-users-'))
  process.env.MEW_DATA_DIR = path.join(temporary, 'data')
  process.env.MEW_WORKSPACE = path.join(temporary, 'workspace')
  fs.mkdirSync(path.join(process.env.MEW_WORKSPACE, 'docs'), { recursive: true })
  const auth = await import('./auth.ts')
  const policy = await import('./access-policy.ts')
  const paths = await import('./paths.ts')
  const identities = await import('./mewlink-identities.ts')
  const { createRemoteAuthentication } = await import('./remote-authentication.ts')
  const { createApiApp } = await import('./api.ts')
  const { resetTreeWatchers } = await import('./watcher.ts')
  const owner = 'owner@example.test', member = 'member@example.test', otherOwner = 'second-owner@example.test'
  const record = { hash: 'unused', role: 'member' as const, mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 }
  auth.upsertUser(owner, { ...record, role: 'owner' })
  auth.upsertUser(member, record)
  let requester: RequestAuth = { email: owner, role: 'owner', mustChangePassword: false }
  const app = express()
  app.use((req, _res, next) => { req.auth = requester; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    resetTreeWatchers()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(temporary, { recursive: true, force: true })
  })
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const remove = (id: string) => fetch(`http://127.0.0.1:${address.port}/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })

  await t.test('only an owner can delete an existing account, with self and last-owner protection', async () => {
    for (const role of ['guest', 'member', 'manager'] as const) {
      requester = { email: role === 'guest' ? null : member, role, mustChangePassword: false }
      assert.equal((await remove(member)).status, 403)
      assert.ok(auth.getUser(member))
    }
    requester = { email: owner, role: 'owner', mustChangePassword: false }
    assert.equal((await remove('missing@example.test')).status, 404)
    assert.equal((await remove('constructor')).status, 404)
    const lastOwner = await remove(owner)
    assert.equal(lastOwner.status, 400)
    assert.match((await lastOwner.json() as { error: string }).error, /마지막 owner/)
    auth.upsertUser(otherOwner, { ...record, role: 'owner' })
    const self = await remove(owner)
    assert.equal(self.status, 400)
    assert.match((await self.json() as { error: string }).error, /현재 로그인한 계정/)
    assert.ok(auth.getUser(owner))
    assert.equal((await remove(otherOwner)).status, 200)
    assert.equal(auth.getUser(otherOwner), null)
  })

  await t.test('all login methods and every workspace ACL are removed without deleting files', async () => {
    const identity = { issuer: 'https://mew.example.test', subject: 'deleted_account_identity', displayName: 'Deleted Member', username: 'member', provider: 'email' as const }
    const link = identities.linkMewlinkToAccount(identity, member, null)
    const remote = createRemoteAuthentication(identity)
    assert.equal(remote.current()?.email, member)
    const browserKey = 'a'.repeat(43), passwordToken = auth.createSession(member), ownerToken = auth.createSession(owner)
    const trustedPassword = auth.createTrustedDeviceSession({ email: member, user: auth.getUser(member)! }, browserKey, 'Password browser')
    const trustedIdentity = auth.createTrustedDeviceSession(identities.resolveMewlinkSession(identity)!, browserKey, 'Mewlink browser')
    const workspace = paths.WORKSPACE_ROOT
    policy.setFeature(member, 'terminal', true)
    policy.setFileRule(member, 'docs', '', 'deny')
    const otherWorkspace = path.join(temporary, 'second-workspace')
    fs.mkdirSync(path.join(otherWorkspace, 'docs'), { recursive: true })
    paths.setWorkspaceRoot(otherWorkspace)
    policy.setFileRule(member, 'docs', '', 'view')
    paths.setWorkspaceRoot(workspace)
    const personalFile = path.join(workspace, 'docs', 'member-notes.md')
    const personalSetting = path.join(process.env.MEW_DATA_DIR!, 'agent-accounts', 'member-history.txt')
    fs.mkdirSync(path.dirname(personalSetting), { recursive: true })
    fs.writeFileSync(personalFile, 'Preserve this document')
    fs.writeFileSync(personalSetting, 'Preserve this history')
    let accessChanged = false
    const changed = () => { accessChanged = true }
    policy.accessChanges.on('change', changed)
    try { assert.equal((await remove(member.toUpperCase())).status, 200) }
    finally { policy.accessChanges.off('change', changed) }
    assert.equal(accessChanged, true)
    assert.equal(auth.getUser(member), null)
    for (const token of [passwordToken, trustedPassword, trustedIdentity]) assert.equal(auth.getSession(token, browserKey), null)
    assert.equal(auth.getSession(ownerToken)?.email, owner)
    assert.equal(remote.current(), null)
    assert.equal(identities.resolveMewlinkSession(identity), null)
    const directory = auth.readAccountDirectory()
    assert.equal(Object.hasOwn(directory.passwordCredentials, member), false)
    assert.equal(Object.hasOwn(directory.mewlinkIdentities, link.id), false)
    assert.ok(Object.values(directory.mewlinkRequests).every(request => request.accountId !== member))
    const sessions = JSON.parse(fs.readFileSync(path.join(process.env.MEW_DATA_DIR!, 'sessions.json'), 'utf8')) as Record<string, { email: string }>
    assert.ok(Object.values(sessions).every(session => session.email !== member))
    const access = JSON.parse(fs.readFileSync(path.join(process.env.MEW_DATA_DIR!, 'access-policy.json'), 'utf8')) as { features: Record<string, unknown>; workspaces: Record<string, Record<string, unknown>> }
    assert.equal(Object.hasOwn(access.features, member), false)
    assert.ok(Object.values(access.workspaces).every(subjects => !Object.hasOwn(subjects, member)))
    assert.equal(fs.readFileSync(personalFile, 'utf8'), 'Preserve this document')
    assert.equal(fs.readFileSync(personalSetting, 'utf8'), 'Preserve this history')
    auth.upsertUser(member, record)
    assert.equal(auth.getSession(passwordToken), null, 'recreating the same account ID cannot restore a deleted session')
    assert.equal(policy.canUse({ email: member, role: 'member', mustChangePassword: false }, 'terminal'), false)
    assert.deepEqual(policy.fileRules(member), [])
    assert.equal(remote.current(), null)
    const nextLink = identities.linkMewlinkToAccount(identity, member, null)
    assert.notEqual(nextLink.id, link.id)
    assert.equal(auth.getSession(trustedIdentity, browserKey), null)
    assert.equal(remote.current(), null, 'an existing external connection cannot adopt a new approval')
  })

  await t.test('identity-only account IDs and their approval records can be deleted', async () => {
    const identity = { issuer: 'https://mew.example.test', subject: 'identity_only_account_deleted', displayName: 'External Member', username: 'external', provider: 'email' as const }
    const request = identities.requestMewlinkAccess(identity)
    const link = identities.approveMewlinkRequest(request.id, { role: 'member' })
    assert.match(link.accountId, /^account_/)
    assert.equal(auth.getUser(link.accountId)?.hasPassword, false)
    const remote = createRemoteAuthentication(identity)
    assert.equal(remote.current()?.email, link.accountId)
    assert.equal((await remove(link.accountId)).status, 200)
    assert.equal(auth.getUser(link.accountId), null)
    assert.equal(remote.current(), null)
    assert.equal(Object.hasOwn(auth.readAccountDirectory().mewlinkRequests, request.id), false)
    assert.equal((await remove(link.accountId)).status, 404)
  })
})
