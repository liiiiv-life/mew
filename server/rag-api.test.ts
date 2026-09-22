import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { once } from 'node:events'
import { DATA_DIR } from './dataDir.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { createApiApp } from './api.ts'
import type { RagStatus } from './rag/types.ts'
import type { RagDocument } from '../shared/rag.ts'
import { RagIndex } from './rag/index.ts'
import { LocalE5Embeddings } from './rag/embeddings.ts'

test('RAG API protects settings, hides stale files and rejects requests for another workspace', async () => {
  const previous = WORKSPACE_ROOT, workspace = path.join(DATA_DIR, 'workspace')
  fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true })
  setWorkspaceRoot(workspace)
  const app = express()
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'] === 'owner' ? 'owner' : req.headers['x-test-role'] === 'member' ? 'member' : 'guest'
    req.auth = { role, email: role === 'guest' ? null : `${role}@test.local`, mustChangePassword: false }; next()
  })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const request = (route: string, role = 'owner', method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api${route}`, {
    method, headers: { 'x-test-role': role, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  try {
    for (const route of ['/rag/settings', '/rag/status?project=docs', '/rag/documents?project=docs']) assert.equal((await request(route, 'guest')).status, 403)
    assert.equal((await request('/rag/settings', 'member', 'PUT', { enabled: false, agentGuidance: true })).status, 403)
    assert.equal((await request('/rag/settings', 'owner', 'PUT', { enabled: 'false' })).status, 400)
    assert.equal((await request('/rag/settings', 'owner', 'PUT', { enabled: false, agentGuidance: true })).status, 200)
    const status = await (await request('/rag/status?project=docs')).json() as RagStatus
    assert.equal(status.enabled, false); assert.equal(status.engine, 'LanceDB'); assert.equal(status.ready, false)
    assert.equal((await request('/rag/reindex', 'owner', 'POST', { project: 'docs' })).status, 503)
    assert.equal((await request('/rag/documents?project=docs&workspace=/different')).status, 409)
    assert.equal((await request('/rag/reindex', 'owner', 'POST', { project: 'docs', workspace: '/different' })).status, 409)
    fs.writeFileSync(path.join(workspace, 'docs/current.md'), '# Current\nVisible text')
    fs.writeFileSync(path.join(workspace, 'docs/deleted.md'), '# Old\nDeleted text')
    const embedding = { id: new LocalE5Embeddings().id, dimensions: 3, embedPassages: async (texts: string[]) => texts.map(() => [1, 0, 0]), embedQuery: async () => [1, 0, 0] }
    await new RagIndex(workspace, embedding).ensureProject('docs', ['current.md', 'deleted.md'])
    fs.unlinkSync(path.join(workspace, 'docs/deleted.md'))
    const response = await request('/rag/documents?project=docs')
    assert.equal(response.status, 200)
    assert.deepEqual(((await response.json()) as { documents: RagDocument[] }).documents.map((file: { path: string }) => file.path), ['current.md'])
    assert.equal((await request('/rag/reindex', 'member', 'POST', { project: 'docs' })).status, 403)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); setWorkspaceRoot(previous) }
})
