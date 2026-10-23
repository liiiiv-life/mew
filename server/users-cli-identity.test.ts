import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { MewlinkIdentity } from '../shared/mewlink-identity.ts'

test('account CLI manages stable OAuth-only IDs and retains email owner recovery', { timeout: 30_000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-users-cli-identity-'))
  process.env.MEW_DATA_DIR = temporary
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const auth = await import('./auth.ts')
  const identities = await import('./mewlink-identities.ts')
  const ownerEmail = 'owner@example.test', originalPassword = 'existing-owner-password'
  auth.upsertUser(ownerEmail, {
    role: 'owner', hash: auth.hashPassword(originalPassword), createdAt: 1,
    passwordChangedAt: 0, mustChangePassword: false, displayName: 'Local Owner',
  })
  const identity: MewlinkIdentity = {
    issuer: 'https://mew.example.test', subject: 'central_account_subject_cli',
    displayName: 'OAuth Member', provider: 'github', username: 'oauth-member',
  }
  const pending = identities.requestMewlinkAccess(identity)
  const link = identities.approveMewlinkRequest(pending.id, {})
  const file = path.join(temporary, 'users.json')
  const run = (...args: string[]) => spawnSync(process.execPath, ['server/usersCli.ts', ...args], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, MEW_DATA_DIR: temporary }, encoding: 'utf8', timeout: 10_000,
  })

  await t.test('list identifies passwordless accounts without printing credentials', () => {
    const result = run('list')
    assert.equal(result.status, 0)
    assert.ok(result.stdout.includes(link.accountId))
    assert.ok(result.stdout.includes('OAuth Member'))
    assert.ok(result.stdout.includes('[Mewlink 전용]'))
    assert.equal(result.stdout.includes(auth.getUser(ownerEmail)!.hash), false)
  })

  await t.test('role changes use existing account IDs and preserve external bindings without creating passwords', () => {
    const result = run('role', `  ${link.accountId.toUpperCase()}  `, 'manager')
    assert.equal(result.status, 0)
    assert.equal(auth.getUser(link.accountId)?.role, 'manager')
    assert.equal(auth.getUser(link.accountId)?.hasPassword, false)
    assert.equal(auth.readAccountDirectory().passwordCredentials[link.accountId], undefined)
    assert.equal(identities.resolveMewlinkSession(identity)?.credentialId, link.id)
    const original = fs.readFileSync(file, 'utf8')
    assert.equal(run('role', 'constructor', 'owner').status, 1)
    assert.equal(run('role', link.accountId, 'unknown').status, 1)
    assert.equal(run('remove', 'missing-account-id').status, 1)
    assert.equal(fs.readFileSync(file, 'utf8'), original)
  })

  await t.test('OAuth-only reset and non-email add fail without enabling a credential', () => {
    const original = fs.readFileSync(file, 'utf8'), reset = run('reset', link.accountId)
    assert.equal(reset.status, 1)
    assert.ok(reset.stderr.includes('Mewlink 전용 계정은 비밀번호를 재발급할 수 없습니다'))
    assert.equal(run('add', 'opaque-new-account', 'member').status, 1)
    assert.equal(fs.readFileSync(file, 'utf8'), original)
    assert.equal(auth.readAccountDirectory().passwordCredentials[link.accountId], undefined)
  })

  await t.test('email owner password reset still invalidates sessions and supports local recovery', () => {
    const token = auth.createSession(ownerEmail), result = run('reset', 'OWNER@example.test')
    assert.equal(result.status, 0)
    const resetPassword = result.stdout.match(/임시 비밀번호: (\S+)/)?.[1]
    assert.ok(resetPassword)
    assert.equal(auth.verifyPassword(resetPassword, auth.getUser(ownerEmail)!.hash), true)
    assert.equal(auth.getUser(ownerEmail)?.role, 'owner')
    assert.equal(auth.getUser(ownerEmail)?.mustChangePassword, true)
    assert.equal(auth.getSession(token), null)
  })

  await t.test('removing the stable account ID revokes external access and removes its bindings', () => {
    assert.equal(run('remove', link.accountId).status, 0)
    assert.equal(auth.getUser(link.accountId), null)
    assert.equal(identities.resolveMewlinkSession(identity), null)
    assert.equal(identities.listMewlinkAccess().links.some(candidate => candidate.id === link.id), false)
    assert.equal(auth.readAccountDirectory().passwordCredentials[link.accountId], undefined)
    assert.equal(auth.getUser(ownerEmail)?.role, 'owner')
  })
})
