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
import type { DocumentGraphData } from '../shared/document-graph.ts'

test('graph API never exposes unreadable nodes/titles/edges, including after permission changes', async t => {
  const previous = WORKSPACE_ROOT, root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-graph-api-'))
  setWorkspaceRoot(root)
  fs.mkdirSync(DOCS_ROOT, { recursive: true })
  fs.writeFileSync(path.join(DOCS_ROOT, 'public.md'), '[next](next.md) [secret](secret.md)')
  fs.writeFileSync(path.join(DOCS_ROOT, 'next.md'), '---\ntitle: Next\n---\n')
  fs.writeFileSync(path.join(DOCS_ROOT, 'secret.md'), '---\ntitle: Secret\n---\n[public](public.md)')
  setFileRule('guest', 'docs', 'public.md', 'view')
  setFileRule('guest', 'docs', 'next.md', 'view')
  let role: Role = 'guest'
  const app = express()
  app.use((req, _res, next) => { req.auth = { role, email: role === 'guest' ? null : 'graph@example.test', mustChangePassword: false }; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    resetTreeWatchers(); setWorkspaceRoot(previous); fs.rmSync(root, { recursive: true, force: true })
  })
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/docs/graph`
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const publicGraph = await response.json() as DocumentGraphData
  assert.deepEqual(publicGraph.nodes.map(node => node.path), ['next.md', 'public.md'])
  assert.deepEqual(publicGraph.edges, [[1, 0]])
  role = 'owner'
  assert.equal(((await (await fetch(url)).json()) as DocumentGraphData).nodes.length, 3)
  role = 'guest'
  setFileRule('guest', 'docs', 'next.md', 'deny')
  const restricted = await (await fetch(url)).json() as DocumentGraphData
  assert.deepEqual(restricted.nodes.map(node => node.path), ['public.md'])
  assert.deepEqual(restricted.edges, [])
  setFeature('guest', 'filesRead', false)
  assert.equal((await fetch(url)).status, 403)
})
