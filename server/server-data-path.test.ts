import './config.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import express from 'express'
import type { RequestAuth } from './reqAuth.ts'
import { disableTestPty } from './test-disabled-pty.ts'

test('configured server data stays private inside a workspace and through symlink aliases', async t => {
  const moduleHooks = disableTestPty()
  t.after(() => moduleHooks.deregister())
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-private-state-'))
  const workspace = path.join(temp, 'workspace'), data = path.join(workspace, 'state')
  process.env.MEW_WORKSPACE = workspace
  process.env.MEW_DATA_DIR = data
  fs.mkdirSync(data, { recursive: true })
  fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(workspace, 'state-public'), { recursive: true })
  const privateFile = path.join(data, 'users.json'), original = '{"fixture":"private account state"}'
  fs.writeFileSync(privateFile, original)
  fs.writeFileSync(path.join(workspace, 'state-public', 'note.json'), '{"public":true}')
  fs.symlinkSync(data, path.join(workspace, 'alias'), 'dir')
  fs.symlinkSync(privateFile, path.join(workspace, 'alias.json'), 'file')
  const paths = await import('./paths.ts')
  const policy = await import('./access-policy.ts')
  const tree = await import('./tree.ts')
  const catalog = await import('./fileCatalog.ts')
  const { createApiApp } = await import('./api.ts')
  const { resetTreeWatchers } = await import('./watcher.ts')
  const member: RequestAuth = { email: 'member@example.test', role: 'member', mustChangePassword: false }
  const owner: RequestAuth = { email: 'owner@example.test', role: 'owner', mustChangePassword: false }
  const app = express()
  app.use((req, _res, next) => { req.auth = req.headers['x-test-account'] === 'owner' ? owner : member; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api`
  t.after(async () => {
    resetTreeWatchers(); catalog.resetFileCatalogs()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(temp, { recursive: true, force: true })
  })
  for (const relative of ['state/users.json', 'state/new.json', 'alias/users.json', 'alias/new.json', 'alias.json']) {
    assert.throws(() => paths.resolveProjectPath('.workspace', relative), paths.UnsafePathError, relative)
    assert.deepEqual(policy.fileAccess(member, '.workspace', relative), { view: false, edit: false }, relative)
    assert.throws(() => policy.setFileRule(member.email!, '.workspace', relative, 'edit'), paths.UnsafePathError)
    const response = await fetch(`${base}/file?project=.workspace&path=${encodeURIComponent(relative)}`)
    assert.equal(response.status, 403, relative)
    const write = await fetch(`${base}/file?project=.workspace`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: relative, content: 'changed', commit: false }) })
    assert.equal(write.status, 403, relative)
  }
  assert.equal(fs.readFileSync(privateFile, 'utf8'), original)
  assert.equal(fs.existsSync(path.join(data, 'new.json')), false)
  assert.deepEqual(policy.fileAccess(member, '.workspace', 'state-public/note.json'), { view: true, edit: true })
  assert.equal(policy.unrestrictedFiles(member, '.workspace'), false, 'whole-project APIs cannot include server state')
  assert.equal(policy.unrestrictedWorkspaceFiles(member, workspace), false)
  assert.equal(policy.unrestrictedFiles(owner, '.workspace'), true, 'server-file access must retain ordinary project operations')
  assert.equal(policy.unrestrictedWorkspaceFiles(owner, workspace, true), true)
  for (const route of [
    '/git/repository?project=.workspace',
    '/frontmatter-options?project=.workspace&field=tags',
    `/task-list?workspace=${encodeURIComponent(workspace)}`,
    `/features?workspace=${encodeURIComponent(workspace)}`,
  ]) {
    const response = await fetch(base + route, { headers: { 'x-test-account': 'owner', 'x-mew-task-owner': encodeURIComponent(owner.email!) } })
    assert.equal(response.status, 200, route)
    assert.equal((await response.text()).includes('private account state'), false, route)
  }
  policy.setFeature(owner.email!, 'serverFiles', false)
  assert.equal(policy.unrestrictedFiles(owner, '.workspace'), false, 'role alone cannot bypass server-file access')
  assert.equal(policy.unrestrictedWorkspaceFiles(owner, workspace), false)
  policy.setFeature(owner.email!, 'serverFiles', null)
  assert.equal((await fetch(`${base}/file?project=.workspace&path=state/users.json`, { headers: { 'x-test-account': 'owner' } })).status, 403)
  policy.setFeature(member.email!, 'serverFiles', true)
  assert.equal(policy.unrestrictedFiles(member, '.workspace'), true, 'explicit OS file access grants the same project operation scope')
  policy.setFeature(member.email!, 'serverFiles', null)
  policy.setFileRule(owner.email!, '.workspace', 'state-public', 'view')
  assert.equal(policy.unrestrictedFiles(owner, '.workspace', true), false, 'file rules still constrain server-file users')
  assert.equal(policy.unrestrictedWorkspaceFiles(owner, workspace, true), false)
  policy.setFileRule(owner.email!, '.workspace', 'state-public', 'inherit')
  assert.equal(policy.unrestrictedFiles(member, 'state-public'), true)
  assert.equal((await fetch(`${base}/file?project=.workspace&path=state-public/note.json`)).status, 200)
  assert.ok(!paths.listProjects().includes('state'))
  assert.throws(() => paths.projectRoot('state'), paths.UnsafePathError)
  for (const entries of [tree.buildTree('.workspace', { showAll: true }), await tree.buildTreeAsync('.workspace', { showAll: true }), await tree.listTreeDirAsync('.workspace', '', { showAll: true }), (await catalog.listCatalogChildren('.workspace', '', { showAll: true })).entries]) {
    assert.ok(entries.some(entry => entry.name === 'state-public'))
    assert.ok(entries.every(entry => !['state', 'alias', 'alias.json'].includes(entry.name)))
  }
  const files = await catalog.listCatalogFiles('.workspace', { showAll: true })
  assert.deepEqual(files.map(file => file.path), ['state-public/note.json'])
  assert.equal(tree.isPathVisible('.workspace', 'state/users.json', { showAll: true }), false)
  assert.equal(tree.isPathVisible('.workspace', 'alias/users.json', { showAll: true }), false)
  assert.equal(policy.fileAccess({ ...member, role: 'owner' }, '.workspace', 'state/users.json').view, false)
  const nestedRoot = paths.pathsForWorkspace(data, member.email)
  paths.workspaceContext.run(nestedRoot, () => assert.throws(() => paths.resolveProjectPath('.workspace', 'users.json'), paths.UnsafePathError))
  const relocated = path.join(temp, 'relocated-state')
  fs.renameSync(data, relocated)
  fs.symlinkSync(relocated, data, 'dir')
  assert.throws(() => paths.resolveProjectPath('.workspace', 'state/users.json'), paths.UnsafePathError, 'the data directory itself may be a symlink')
  assert.throws(() => paths.resolveProjectPath('.workspace', 'alias/users.json'), paths.UnsafePathError)
})
