import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { createProjectSetupRouter } from './project-setup-routes.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { defaultAgentSettings } from './project-agent-settings.ts'

test('setup API enforces owner and project binding, previews without writes, rejects stale apply', async () => {
  const previous = WORKSPACE_ROOT
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-setup-api-'))
  fs.mkdirSync(path.join(root, 'docs'))
  setWorkspaceRoot(root)
  let role: 'owner' | 'manager' | 'member' | 'guest' = 'owner'
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as express.Request & { auth?: unknown }).auth = { role, email: role === 'guest' ? null : 'setup@example.test', mustChangePassword: false }
    next()
  })
  app.use('/setup', createProjectSetupRouter())
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/setup`
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const input = { projectRoot: root, settings: defaultAgentSettings(), initDocs: true }
    for (const denied of ['manager', 'member', 'guest'] as const) {
      role = denied
      assert.ok([401, 403].includes((await fetch(url)).status))
      assert.ok([401, 403].includes((await post({ ...input, action: 'apply' })).status))
    }
    role = 'owner'
    assert.equal((await fetch(url)).status, 200)
    assert.equal((await post({ ...input, projectRoot: `${root}/other`, action: 'preview' })).status, 409)
    const preview = await post({ ...input, action: 'preview' })
    assert.equal(preview.status, 200)
    const plan = await preview.json() as { revision: string }
    assert.equal(fs.existsSync(path.join(root, '.mew')), false)
    assert.equal((await post({ ...input, action: 'apply', revision: 'stale' })).status, 400)
    const applied = await post({ ...input, action: 'apply', revision: plan.revision })
    assert.equal(applied.status, 200, await applied.text())
    assert.ok(fs.existsSync(path.join(root, 'docs/AGENT.md')))
    assert.equal((await post({ ...input, settings: { ...input.settings, docsDir: '../escape' }, action: 'preview' })).status, 400)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    setWorkspaceRoot(previous)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
