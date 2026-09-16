import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApiApp, tmuxManager } from './api.ts'
import { setFileRule } from './access-policy.ts'
import { commandSessionName, readCmdButtons, writeCmdButtons } from './cmdButtons.ts'
import { listCatalogChildren, readyFileCatalog } from './fileCatalog.ts'
import { WORKSPACE_PROJECT as project, WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { createSubproject, hasProjectMarker, projectDirectory } from './subprojects.ts'
import { buildTree, buildTreeAsync, listTreeDirAsync } from './tree.ts'
import { resetTreeWatchers } from './watcher.ts'

// Exercise real filesystem, catalog and HTTP authorization together in an isolated workspace.
test('nested subprojects preserve hierarchy, command targets and permissions', async () => {
  const original = WORKSPACE_ROOT
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-subprojects-')))
  for (const dir of ['abc/def/child', 'other/def', 'docs/notes', 'file-marker', 'link-marker', 'restricted', 'view-only']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
  fs.writeFileSync(path.join(root, 'file-marker/.mew'), 'keep this')
  fs.symlinkSync(path.join(root, 'abc'), path.join(root, 'link-marker/.mew'))
  fs.symlinkSync(path.join(root, 'abc'), path.join(root, 'linked'))
  setWorkspaceRoot(root)
  const app = express()
  let role: 'owner' | 'member' | 'guest' = 'owner'
  const email = 'subproject-test@example.com'
  app.use((req, _res, next) => {
    ;(req as express.Request & { auth?: unknown }).auth = { role, email: role === 'guest' ? null : email, mustChangePassword: false }
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const post = (target: unknown, scope = project) => fetch(`http://127.0.0.1:${address.port}/api/subprojects?project=${encodeURIComponent(scope)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: target }),
  })
  try {
    await readyFileCatalog(project)
    for (const target of ['abc', 'abc/def', 'abc/def/child', 'other/def']) {
      const response = await post(target)
      assert.equal(response.status, 200, await response.text())
      assert.equal(hasProjectMarker(path.join(root, target)), true)
      const parent = path.posix.dirname(target)
      const listing = await listCatalogChildren(project, parent === '.' ? '' : parent, { showAll: true })
      assert.equal(listing.entries.find(node => node.path === target)?.project, true, 'cached folder row updates immediately')
    }
    assert.equal(hasProjectMarker(path.join(root, 'other')), false, 'intermediate folders are not promoted')
    fs.writeFileSync(path.join(root, 'abc/def/.mew/settings.json'), '{"keep":true}')
    assert.equal((await post('abc/def')).status, 200)
    assert.equal(fs.readFileSync(path.join(root, 'abc/def/.mew/settings.json'), 'utf8'), '{"keep":true}')
    const synchronous = buildTree(project, { showAll: true })
    assert.deepEqual(await buildTreeAsync(project, { showAll: true }), synchronous)
    const abc = synchronous.find(node => node.path === 'abc')!
    assert.equal(abc.children!.find(node => node.path === 'abc/def')?.project, true)
    assert.equal((await listTreeDirAsync(project, 'abc/def', { showAll: true })).find(node => node.name === 'child')?.project, true)
    for (const dir of ['file-marker', 'link-marker']) {
      assert.equal(synchronous.find(node => node.name === dir)?.project, false)
      assert.equal((await post(dir)).status, 400)
    }
    for (const invalid of ['', '.', '..', '../outside', '/tmp', 'abc/.mew', 'linked/def', 3, null]) {
      assert.ok([400, 403].includes((await post(invalid)).status), String(invalid))
    }
    assert.equal(fs.readFileSync(path.join(root, 'file-marker/.mew'), 'utf8'), 'keep this')
    assert.equal((await post('notes', 'docs')).status, 200)
    const first = [{ name: 'Run', command: 'echo first' }]
    const second = [{ name: 'Run', command: 'echo second' }]
    writeCmdButtons(project, first, 'abc/def')
    writeCmdButtons(project, second, 'other/def')
    assert.equal(readCmdButtons(project, 'abc/def')[0].command, 'echo first')
    assert.equal(readCmdButtons(project, 'other/def')[0].command, 'echo second')
    assert.notEqual(commandSessionName(project, 'Run', 'abc/def'), commandSessionName(project, 'Run', 'other/def'))
    assert.equal(projectDirectory(project, 'abc/def'), path.join(root, 'abc/def'))
    const listMock = test.mock.method(tmuxManager, 'list', async () => [])
    const runMock = test.mock.method(tmuxManager, 'runCommand', async () => undefined)
    try {
      const url = `http://127.0.0.1:${address.port}/api/cmd-buttons`
      const listing = await fetch(`${url}?project=${project}&path=abc%2Fdef`)
      assert.equal((await listing.json() as { buttons: Array<{ command: string }> }).buttons[0].command, 'echo first')
      const run = await fetch(`${url}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, path: 'other/def', name: 'Run' }) })
      assert.equal(run.status, 200)
      assert.deepEqual(runMock.mock.calls[0].arguments.slice(1), ['echo second', path.join(root, 'other/def')])
    } finally { listMock.mock.restore(); runMock.mock.restore() }
    assert.throws(() => createSubproject(project, 'missing'))
    assert.equal(fs.existsSync(path.join(root, 'missing')), false)
    role = 'member'
    setFileRule(email, project, 'view-only', 'view')
    setFileRule(email, project, 'restricted/.mew', 'view')
    assert.equal((await post('view-only')).status, 403)
    assert.equal((await post('restricted')).status, 403)
    assert.equal(fs.existsSync(path.join(root, 'restricted/.mew')), false)
    role = 'guest'
    assert.equal((await post('restricted')).status, 403)
    setWorkspaceRoot(path.join(root, 'abc'))
    assert.equal((await listTreeDirAsync(project, '', { showAll: true })).find(node => node.path === 'def')?.project, true, 'changing the root makes def a direct project')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    resetTreeWatchers()
    setWorkspaceRoot(original)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
