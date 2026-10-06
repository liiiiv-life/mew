import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApiApp, tmuxManager } from './api.ts'
import { writeActiveWorkspace } from './userUiState.ts'
import { configFiles } from './config.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { resetTreeWatchers } from './watcher.ts'

test('opening subprojects validates scope, role and source workspace before switching', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-project-tabs-')))
  const original = WORKSPACE_ROOT
  const originalCwd = tmuxManager.cwd
  const configHome = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = path.join(root, 'config')
  // The legacy fallback .env belongs to the app, not this test.
  const fallbackConfigs = new Set(configFiles().slice(1))
  const write = fs.writeFileSync
  const writing = test.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
    if (!fallbackConfigs.has(String(args[0]))) write(...args)
  })
  for (const dir of ['alpha/.mew', 'plain/nested/.mew', 'docs/reference/.mew', 'plain/regular']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
  fs.symlinkSync(path.join(root, 'alpha'), path.join(root, 'linked'))
  fs.mkdirSync(path.join(root, 'fake'))
  fs.writeFileSync(path.join(root, 'fake/.mew'), '')
  setWorkspaceRoot(root)
  let role: 'owner' | 'manager' | 'member' | 'guest' = 'owner'
  const app = express()
  app.use((req, _res, next) => {
    ;(req as express.Request & { auth?: unknown }).auth = { role, email: 'tabs-owner@example.com', mustChangePassword: false }
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const open = (target: unknown, scope = '.workspace', workspace = root) => fetch(`http://127.0.0.1:${port}/api/subprojects/open?project=${encodeURIComponent(scope)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: target, workspace }),
  })
  try {
    for (const denied of ['manager', 'member', 'guest'] as const) {
      role = denied
      assert.equal((await open('alpha')).status, 403)
      assert.equal(WORKSPACE_ROOT, root)
    }
    role = 'owner'
    assert.equal((await open('alpha', '.workspace', '/old-workspace')).status, 409)
    for (const target of ['', '.', '..', '../alpha', '/tmp', 'linked', 'fake', 'plain/regular', 42, null]) {
      const response = await open(target)
      assert.equal(response.status, 400, JSON.stringify(target))
      assert.equal(WORKSPACE_ROOT, root)
    }
    for (const [target, scope, expected] of [
      ['alpha', '.workspace', 'alpha'],
      ['plain/nested', '.workspace', 'plain/nested'],
      ['reference', 'docs', 'docs/reference'],
    ]) {
      writeActiveWorkspace('tabs-owner@example.com', root)
      const response = await open(target, scope)
      assert.equal(response.status, 200, await response.clone().text())
      const info = await response.json() as { path: string; docsPath: string }
      assert.equal(info.path, path.join(root, expected))
      assert.equal(WORKSPACE_ROOT, root, 'switching keeps the server default root')
      assert.equal(tmuxManager.cwd, originalCwd, 'switching keeps the shared terminal default')
      assert.ok(info.docsPath.startsWith(info.path + path.sep))
      assert.equal((await open(target, scope)).status, 409, 'a repeated old-root request cannot open a different folder')
      resetTreeWatchers()
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    resetTreeWatchers()
    setWorkspaceRoot(original)
    tmuxManager.cwd = originalCwd
    writing.mock.restore()
    if (configHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = configHome
    fs.rmSync(root, { recursive: true, force: true })
  }
})
