import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApiApp } from './api.ts'
import { setFileRule, setFeature } from './access-policy.ts'
import { DOCS_ROOT, setWorkspaceRoot, WORKSPACE_ROOT } from './paths.ts'
import { resetTreeWatchers } from './watcher.ts'
import type { Role } from './reqAuth.ts'
import type { DocumentPageMutation } from '../shared/document-pages.ts'

test('page API promotes safely and enforces login, write features and recursive file permissions', async t => {
  const previous = WORKSPACE_ROOT, root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-pages-api-'))
  setWorkspaceRoot(root)
  fs.mkdirSync(DOCS_ROOT, { recursive: true })
  fs.writeFileSync(path.join(DOCS_ROOT, 'dev.md'), 'Development')
  fs.writeFileSync(path.join(DOCS_ROOT, 'MOC.md'), '[dev](dev.md)')
  let role: Role = 'guest'
  const email = 'pages@example.test'
  const app = express()
  app.use((req, _res, next) => { req.auth = { role, email: role === 'guest' ? null : email, mustChangePassword: false }; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    resetTreeWatchers(); setWorkspaceRoot(previous); fs.rmSync(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/docs/pages/`
  const request = (action: string, body: object) => fetch(base + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await request('create', { path: 'dev.md', name: 'child' })).status, 403)
  role = 'member'
  setFeature(email, 'filesWrite', false)
  assert.equal((await request('create', { path: 'dev.md', name: 'child' })).status, 403)
  setFeature(email, 'filesWrite', true)
  setFileRule(email, 'docs', 'dev/child.md', 'deny')
  assert.equal((await request('create', { path: 'dev.md', name: 'child' })).status, 403)
  assert.equal(fs.existsSync(path.join(DOCS_ROOT, 'dev.md')), true)
  setFileRule(email, 'docs', 'dev/child.md', 'inherit')
  const response = await request('create', { path: 'dev.md', name: 'child' })
  assert.equal(response.status, 200)
  const created = await response.json() as DocumentPageMutation
  assert.equal(created.path, 'dev/child.md')
  assert.equal(fs.readFileSync(path.join(DOCS_ROOT, 'MOC.md'), 'utf8'), '[dev](dev/_dev.md)')
  setFileRule(email, 'docs', 'dev/child.md', 'view')
  assert.equal((await request('rename', { path: 'dev', name: 'renamed' })).status, 403)
  assert.equal((await request('delete', { path: 'dev' })).status, 403)
  assert.equal((await request('copy', { path: 'dev', destination: '' })).status, 403)
  assert.equal(fs.existsSync(path.join(DOCS_ROOT, 'dev/_dev.md')), true)
  setFileRule(email, 'docs', 'dev/child.md', 'inherit')
  assert.equal((await request('create', { path: 'dev', name: 'child' })).status, 409)
  assert.equal((await request('create', { path: '../dev', name: 'bad' })).status, 400)
  assert.equal((await request('unknown', {})).status, 400)
  const deleted = await request('delete', { path: 'dev/child.md' })
  assert.equal(deleted.status, 200)
  assert.equal(fs.existsSync(path.join(DOCS_ROOT, 'dev')), false)
  assert.equal(fs.readFileSync(path.join(DOCS_ROOT, 'dev.md'), 'utf8'), 'Development')
})
