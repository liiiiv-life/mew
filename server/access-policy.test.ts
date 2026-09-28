import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import type { RequestAuth } from './reqAuth.ts'

test('account capabilities and canonical file rules are enforced across HTTP and live collaboration', { timeout: 30_000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-access-'))
  process.env.MEW_DATA_DIR = path.join(temp, 'data')
  process.env.MEW_WORKSPACE = path.join(temp, 'workspace')
  fs.mkdirSync(process.env.MEW_DATA_DIR, { recursive: true })
  for (const folder of ['docs/public', 'docs/private', 'other', 'dest']) fs.mkdirSync(path.join(process.env.MEW_WORKSPACE, folder), { recursive: true })
  fs.writeFileSync(path.join(process.env.MEW_DATA_DIR, 'guest-access.json'), JSON.stringify({ version: 1, projects: { docs: [{ path: 'public', view: true, edit: true }] } }))
  const { DATA_DIR } = await import('./dataDir.ts')
  assert.equal(DATA_DIR, process.env.MEW_DATA_DIR)
  const paths = await import('./paths.ts')
  const policy = await import('./access-policy.ts')
  const auth = await import('./auth.ts')
  const { createApiApp } = await import('./api.ts')
  const { attachCollabWebSocket } = await import('./collab.ts')
  const { resetTreeWatchers } = await import('./watcher.ts')
  const owner: RequestAuth = { role: 'owner', email: 'owner@example.test', mustChangePassword: false }
  const member: RequestAuth = { role: 'member', email: 'member@example.test', mustChangePassword: false }
  const guest: RequestAuth = { role: 'guest', email: null, mustChangePassword: false }
  for (const person of [owner, member]) auth.upsertUser(person.email!, { hash: 'unused', role: person.role as 'owner' | 'member', createdAt: 0, passwordChangedAt: 0, mustChangePassword: false })
  for (const [file, content] of Object.entries({ 'public/readme.md': 'visible needle', 'public/hidden.md': 'hidden needle', 'private/secret.md': 'secret needle', '.env': 'SECRET=true' })) fs.writeFileSync(path.join(paths.DOCS_ROOT, file), content)
  fs.symlinkSync(path.join(paths.DOCS_ROOT, 'private'), path.join(paths.DOCS_ROOT, 'alias'), 'dir')
  fs.symlinkSync(os.tmpdir(), path.join(paths.DOCS_ROOT, 'escape'), 'dir')
  const app = express()
  app.use((req, _res, next) => { req.auth = req.headers['x-test-account'] === 'owner' ? owner : req.headers['x-test-account'] === 'guest' ? guest : member; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api`
  async function request(route: string, method = 'GET', body?: unknown, account = 'member') {
    return fetch(base + route, { method, headers: { 'x-test-account': account, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  }
  const sockets: WebSocket[] = []
  try {
    assert.equal(policy.canUse(member, 'agent'), false)
    assert.equal(policy.canUse(owner, 'terminal'), true)
    for (const account of ['member', 'guest']) {
      assert.equal((await request('/agent-runtimes/codex/models', 'GET', undefined, account)).status, 403)
      assert.equal((await request('/git/github-auth', 'GET', undefined, account)).status, 403)
      assert.equal((await request('/git/remote', 'POST', { action: 'push', workspace: paths.WORKSPACE_ROOT }, account)).status, 403)
      assert.equal((await request('/git/github-auth', 'POST', undefined, account)).status, 403)
      assert.equal((await request('/git/github-auth/unknown/stop', 'POST', undefined, account)).status, 403)
      assert.equal((await request('/git/github-auth/unknown/browser', 'POST', undefined, account)).status, 403)
    }
    policy.setFeature(member.email!, 'git', true)
    assert.equal((await request('/git/remote', 'POST', { action: 'pull', workspace: '/stale' }, 'owner')).status, 409)
    assert.equal((await request('/git/github-auth', 'POST')).status, 403, 'Git alone cannot open login browsers')
    policy.setFeature(member.email!, 'git', null)
    assert.equal((await request('/fs/agent-guidance')).status, 403)
    assert.equal((await request('/fs/agent-guidance', 'PUT', { key: 'language', value: 'ko', revision: '' })).status, 403)
    assert.equal((await request('/fs/agent-guidance', 'PUT', {}, 'guest')).status, 403)
    assert.equal((await request('/fs/agent-guidance', 'GET', undefined, 'guest')).status, 403)
    const guidance = await request('/fs/agent-guidance', 'GET', undefined, 'owner')
    assert.equal(guidance.status, 200)
    const guidancePath = (await guidance.json() as { path: string }).path
    assert.equal(guidancePath, path.join(DATA_DIR, 'agent-guidance.md'))
    assert.equal((await request('/fs/file', 'PUT', { path: guidancePath, content: 'denied' })).status, 403)
    assert.equal((await request('/fs/file', 'PUT', { path: guidancePath, content: 'Shared instructions' }, 'owner')).status, 200)
    assert.equal(fs.readFileSync(guidancePath, 'utf8'), 'Shared instructions')
    const settings = await (await request('/fs/agent-guidance', 'GET', undefined, 'owner')).json() as { revision: string }
    const settingChange = { key: 'language', value: 'ko', revision: settings.revision }
    assert.equal((await request('/fs/agent-guidance', 'PUT', settingChange, 'owner')).status, 200)
    assert.equal((await request('/fs/agent-guidance', 'PUT', settingChange, 'owner')).status, 409)
    assert.equal((await request('/fs/agent-guidance', 'PUT', { ...settingChange, key: 'invalid' }, 'owner')).status, 400)
    assert.equal((await request('/fs/file', 'PUT', { path: guidancePath, content: 'stale', expectedContent: 'Shared instructions' }, 'owner')).status, 409)

    assert.deepEqual(policy.fileAccess(guest, 'docs', 'public/readme.md'), { view: true, edit: true })
    assert.equal(policy.fileAccess(guest, 'docs', '.env').view, false)
    assert.equal((await request('/fs/cloud-storage')).status, 403)
    assert.equal((await request('/fs/cloud-storage', 'GET', undefined, 'guest')).status, 403)
    const cloudResponse = await request('/fs/cloud-storage', 'GET', undefined, 'owner')
    assert.equal(cloudResponse.status, 200)
    assert.ok(Array.isArray((await cloudResponse.json() as { folders: unknown }).folders))
    assert.equal((await request('/fs/favorites')).status, 403)
    const missingPath = path.join(temp, 'new-parent', 'new-project')
    for (const account of ['member', 'guest']) {
      assert.equal((await request('/fs/directory', 'POST', { path: missingPath }, account)).status, 403)
    }
    const missingResponse = await request(`/fs/entries?path=${encodeURIComponent(missingPath)}`, 'GET', undefined, 'owner')
    assert.equal(missingResponse.status, 404)
    assert.deepEqual((await missingResponse.json() as { missing: unknown }).missing, { path: missingPath, existingPath: temp, missingName: 'new-parent' })
    assert.equal(fs.existsSync(missingPath), false)
    assert.equal((await request('/fs/directory', 'POST', { path: missingPath }, 'owner')).status, 200)
    assert.equal(fs.statSync(missingPath).isDirectory(), true)
    assert.equal((await request('/fs/directory', 'POST', { path: '' }, 'owner')).status, 400)
    assert.equal((await request('/fs/favorites', 'GET', undefined, 'guest')).status, 403)
    assert.equal((await request('/fs/favorites', 'PUT', { path: temp, favorite: true })).status, 403)
    assert.equal((await request('/fs/favorites', 'PUT', { path: temp, favorite: true }, 'guest')).status, 403)
    assert.equal((await request('/fs/favorites', 'PUT', { path: 'relative', favorite: true }, 'owner')).status, 400)
    assert.equal((await request('/fs/favorites', 'PUT', { path: temp, favorite: true }, 'owner')).status, 200)
    const ownerFavorites = await (await request('/fs/favorites', 'GET', undefined, 'owner')).json() as { folders: { path: string }[] }
    assert.ok(ownerFavorites.folders.some(folder => folder.path === fs.realpathSync(temp)))
    policy.setFeature(member.email!, 'serverFiles', true)
    const memberResponse = await request('/fs/favorites')
    assert.equal(memberResponse.status, 200)
    const memberFavorites = await memberResponse.json() as { folders: { path: string }[] }
    assert.equal(memberFavorites.folders.some(folder => folder.path === fs.realpathSync(temp)), false)
    assert.equal((await request('/fs/favorites', 'PUT', { path: temp, favorite: true })).status, 200)
    assert.equal((await request('/fs/favorites', 'PUT', { path: temp, favorite: false })).status, 200)
    const ownerAgain = await (await request('/fs/favorites', 'GET', undefined, 'owner')).json() as { folders: { path: string }[] }
    assert.ok(ownerAgain.folders.some(folder => folder.path === fs.realpathSync(temp)))
    policy.setFeature(member.email!, 'serverFiles', null)
    assert.equal((await request('/admin/access')).status, 403)
    assert.equal((await request('/admin/access/feature', 'PUT', { subject: member.email, feature: 'agent', enabled: true }, 'owner')).status, 200)
    assert.equal(policy.canUse(member, 'agent'), true)
    assert.equal(policy.canUse(member, 'terminal'), false)
    assert.equal((await request('/agent-sets')).status, 200)
    assert.equal((await request('/agent-runtimes/unknown/models')).status, 400)
    assert.equal((await request('/agent-runtimes/tmux/models')).status, 400)
    assert.equal((await request('/tmux/sessions')).status, 403)
    assert.equal((await request('/browser-dom/tabs')).status, 403)
    assert.equal((await request('/remote-desktop/status')).status, 403)
    assert.equal((await request('/admin/access/feature', 'PUT', { subject: 'guest', feature: 'terminal', enabled: true }, 'owner')).status, 400)
    assert.equal((await request('/admin/users/owner%40example.test/role', 'PUT', { role: 'member' }, 'owner')).status, 400)
    policy.setFeature(member.email!, 'agent', null)
    assert.equal(policy.canUse(member, 'agent'), false)
    policy.setFileRule(member.email!, 'docs', '', 'deny')
    policy.setFileRule(member.email!, 'docs', 'public', 'edit')
    policy.setFileRule(member.email!, 'docs', 'public/hidden.md', 'deny')
    policy.setFeature(member.email!, 'git', true)
    assert.equal((await request('/git/github-auth?project=docs')).status, 403)
    assert.equal((await request('/git/github-auth?project=docs', 'POST')).status, 403)
    assert.equal((await request('/git/remote?project=docs', 'POST', { action: 'push', workspace: paths.WORKSPACE_ROOT })).status, 403)
    policy.setFeature(member.email!, 'git', null)
    assert.equal(policy.fileAccess(member, '.workspace', 'docs/private/secret.md').view, false)
    assert.equal(policy.fileAccess(member, 'docs', 'alias/secret.md').view, false)
    assert.equal(policy.fileAccess(owner, 'docs', 'escape/new.txt').edit, false)
    for (const route of ['file', 'raw', 'download', 'file-at-commit', 'file-history', 'table-layout', 'comments', 'pdf']) {
      assert.equal((await request(`/${route}?project=docs&path=private%2Fsecret.md`)).status, 403, route)
    }
    assert.equal((await request('/file?project=docs&path=public/readme.md')).status, 200)
    assert.equal((await request('/file', 'PUT', { project: 'docs', path: 'private/secret.md', content: 'tampered' })).status, 403)
    assert.equal(fs.readFileSync(path.join(paths.DOCS_ROOT, 'private/secret.md'), 'utf8'), 'secret needle')
    for (const [route, body] of [
      ['/rename', { oldPath: 'public', newPath: 'moved' }],
      ['/copy', { path: 'private/secret.md' }],
      ['/copy-into', { srcPath: 'public', destDir: '' }],
      ['/new-document', { relPath: 'private/new.md', title: 'No' }],
      ['/new-folder', { relPath: 'private/new' }],
      ['/search/replace', { path: 'private/secret.md', query: 'secret', replace: 'oops' }],
    ] as const) assert.equal((await request(route, 'POST', { project: 'docs', ...body })).status, 403, route)
    assert.equal((await request('/file?project=docs&path=public', 'DELETE')).status, 403)
    const tree = await (await request('/tree?project=docs&path=public&v=1')).json() as { entries: { path: string }[] }
    assert.deepEqual(tree.entries.map(item => item.path), ['public/readme.md'])
    const search = await (await request('/search?project=docs&q=needle')).json() as { results: { path: string }[] }
    assert.deepEqual(search.results.map(item => item.path), ['public/readme.md'])
    const fileSearch = await (await request('/search/files?q=secret')).json() as { results: { path: string }[] }
    assert.equal(fileSearch.results.length, 0)
    assert.equal((await request('/db?project=docs')).status, 403)
    assert.equal((await request('/db?project=.workspace')).status, 403)
    assert.equal((await request('/admin/access/path?project=docs&path=public')).status, 403)
    assert.equal((await request('/admin/access/feature', 'PUT', { subject: member.email, feature: 'terminal', enabled: true })).status, 403)
    fs.symlinkSync(path.join(paths.DOCS_ROOT, 'public'), path.join(paths.DOCS_ROOT, 'public/loop'), 'dir')
    assert.equal(policy.subtreeAccess(owner, 'docs', 'public', true), false)
    fs.unlinkSync(path.join(paths.DOCS_ROOT, 'public/loop'))
    assert.equal((await request('/file', 'PUT', { project: 'docs', path: 'public/readme.md', content: 'allowed', commit: false })).status, 200)
    policy.setFeature(member.email!, 'filesWrite', false)
    assert.equal((await request('/file', 'PUT', { project: 'docs', path: 'public/readme.md', content: 'no' })).status, 403)
    const readOnly = await (await request('/file?project=docs&path=public/readme.md')).json() as { editable: boolean }
    assert.equal(readOnly.editable, false)
    policy.setFeature(member.email!, 'filesWrite', true)
    attachCollabWebSocket(server, { authorize: req => {
      const room = new URL(req.url!, base).searchParams.get('room')!
      return policy.canUse(member, 'collaboration') && policy.fileAccess(member, 'docs', room.slice(5)).edit
    } })
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/collab?room=docs:public/readme.md`)
    sockets.push(ws); await once(ws, 'open')
    const closed = once(ws, 'close')
    policy.setFileRule(member.email!, 'docs', 'public/readme.md', 'view')
    await closed
    policy.setFileRule(member.email!, 'docs', 'public/readme.md', 'edit')
    const secondSocket = new WebSocket(`ws://127.0.0.1:${address.port}/api/collab?room=docs:public/readme.md`)
    sockets.push(secondSocket); await once(secondSocket, 'open')
    const featureClosed = once(secondSocket, 'close')
    policy.setFeature(member.email!, 'collaboration', false)
    await featureClosed
    policy.setFeature(member.email!, 'filesRead', false)
    assert.equal((await request('/file?project=docs&path=public/readme.md')).status, 403)
    policy.setFeature(member.email!, 'filesRead', true)
    const scope = policy.workspaceScope()
    const wrongWorkspace = await request('/admin/access/path', 'PUT', { subject: member.email, project: 'docs', path: '', access: 'edit', workspace: scope + '-wrong' }, 'owner')
    assert.equal(wrongWorkspace.status, 409)
    assert.equal((await request('/guest-access', 'PUT', { project: 'docs', path: '', view: true, edit: true })).status, 410)
    const migrated = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'access-policy.json'), 'utf8'))
    assert.ok(migrated.workspaces[scope].guest.some((rule: { path: string }) => rule.path === 'docs/public'))
    paths.setWorkspaceRoot(path.join(temp, 'second'))
    fs.mkdirSync(paths.WORKSPACE_ROOT, { recursive: true })
    assert.equal(policy.fileAccess(guest, 'docs', 'public/readme.md').view, false)
    assert.equal(policy.fileAccess(member, 'docs', 'public/readme.md').edit, true)
  } finally {
    sockets.forEach(ws => ws.terminate())
    resetTreeWatchers()
    await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
