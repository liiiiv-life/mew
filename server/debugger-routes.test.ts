import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import type { DebugConfig, DebugSnapshot } from '../shared/debugger.ts'
import { defaultDebugConfig } from '../shared/debugger.ts'

test('debugger endpoints enforce OS tool permission and isolate accounts and workspaces', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-debugger-routes-'))
  process.env.MEW_DATA_DIR = temp; process.env.MEW_WORKSPACE = temp
  const { createDebuggerRouter } = await import('./debugger-routes.ts')
  const { workspaceContext, pathsForWorkspace, WORKSPACE_PROJECT } = await import('./paths.ts')
  const { upsertUser } = await import('./auth.ts')
  upsertUser('one@example.test', { hash: 'fixture', role: 'manager', mustChangePassword: false, createdAt: 0, passwordChangedAt: 0 })
  const { debugSession } = await import('./debugger.ts')
  const { setFeature, setFileRule } = await import('./access-policy.ts')
  let role: 'owner' | 'manager' | 'member' | 'guest' = 'owner', email = 'one@example.test', root = temp
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role, email: role === 'guest' ? null : email, mustChangePassword: false }; workspaceContext.run(pathsForWorkspace(root, email), next) })
  app.use('/debugger', createDebuggerRouter())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(temp, { recursive: true, force: true }) })
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/debugger`
  const request = (endpoint = '', body?: unknown, method = body ? 'POST' : 'GET', workspace = root) => fetch(url + endpoint, { method, headers: { 'Content-Type': 'application/json', 'X-Mew-Debug-Workspace': encodeURIComponent(workspace) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  for (const blocked of ['member', 'guest'] as const) { role = blocked; assert.equal((await request()).status, 403); assert.equal((await request('/start', {})).status, 403) }
  role = 'owner'
  assert.equal((await request('', undefined, 'GET', '/stale')).status, 409)
  setFeature(email, 'terminal', false)
  assert.equal((await request('/test', {})).status, 403)
  setFeature(email, 'terminal', true)
  setFileRule(email, WORKSPACE_PROJECT, 'private', 'deny')
  assert.equal((await request('/start', {})).status, 403)
  setFileRule(email, WORKSPACE_PROJECT, 'private', 'inherit')
  const config = { ...defaultDebugConfig('custom', temp), command: process.execPath, args: [new URL('./fixtures/debug-adapter.cjs', import.meta.url).pathname], breakpoints: [{ file: 'main.js', line: 3, enabled: true }] }
  assert.equal((await request('/config', config, 'PUT')).status, 200)
  email = 'two@example.test'
  assert.equal(((await (await request()).json()) as { config: DebugConfig }).config.breakpoints.length, 0)
  email = 'one@example.test'; root = path.join(temp, 'other'); await fs.mkdir(root)
  assert.equal(((await (await request()).json()) as { config: DebugConfig }).config.breakpoints.length, 0)
  root = temp; role = 'manager'
  assert.equal((await request('/test', {})).status, 200)
  const started = await request('/start', {}); assert.equal(started.status, 200)
  const snapshot = await started.json() as DebugSnapshot
  assert.equal((await request('/start', {})).status, 400)
  assert.equal((await request('/config', { ...config, request: 'attach' }, 'PUT')).status, 400)
  assert.equal((await request('/command', { sessionId: 'stale', command: 'continue' })).status, 409)
  assert.equal((await request('/stop', { sessionId: 'stale' })).status, 409)
  assert.equal((await request('/stop', { sessionId: snapshot.id })).status, 200)
  assert.equal((await request('/config', { ...config, port: -1 }, 'PUT')).status, 400)
  assert.equal(((await (await request()).json()) as { config: DebugConfig }).config.breakpoints.length, 1)
  assert.equal((await request('/start', {})).status, 200)
  setFeature(email, 'terminal', false)
  const end = Date.now() + 3000
  while (debugSession(email, root)?.snapshot.state !== 'terminated') { assert.ok(Date.now() < end); await new Promise(resolve => setTimeout(resolve, 20)) }
})
