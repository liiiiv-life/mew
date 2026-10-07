import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApiApp } from './api.ts'
import { DEFAULT_PROJECT, setWorkspaceRoot, WORKSPACE_PROJECT, WORKSPACE_ROOT } from './paths.ts'
import { resetTreeWatchers } from './watcher.ts'
import { waitForSearchIndex } from './searchCatalog.ts'
import { setFileRule } from './access-policy.ts'

test('Ctrl+P와 정확 내용 검색은 전체 tree 응답 없이 통합 catalog를 사용한다', async () => {
  const original = WORKSPACE_ROOT
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-search-api-')))
  fs.mkdirSync(path.join(root, 'app', '.mew'), { recursive: true })
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'app', 'SearchPanel.tsx'), 'export const uniqueNeedle = "workspace phrase"\n')
  fs.writeFileSync(path.join(root, 'app', 'public.md'), 'shared permission phrase\n')
  fs.writeFileSync(path.join(root, 'app', 'private.md'), 'shared permission phrase\n')
  fs.writeFileSync(path.join(root, 'app', '.env'), 'SECRET=shared permission phrase\n')
  fs.writeFileSync(path.join(root, 'docs', 'performance.md'), '# 검색 성능\n문서 고유 구절\n')
  setWorkspaceRoot(root)

  const app = express()
  app.use(express.json())
  let role: 'owner' | 'guest' = 'owner'
  app.use((req, _res, next) => {
    ;(req as express.Request & { auth?: unknown }).auth = { role, email: role === 'guest' ? null : 'owner@example.com', mustChangePassword: false }
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''

  try {
    for (const [method, route] of [
      ['GET', '/search/semantic?q=needle'], ['GET', '/rag/status'],
      ['GET', '/rag/documents'], ['GET', '/rag/settings'],
      ['PUT', '/rag/settings'], ['POST', '/rag/reindex'],
    ]) {
      const response = await fetch(`${base}/api${route}`, { method })
      assert.equal(response.status, 404, `${method} ${route} was removed`)
    }
    const filesResponse = await fetch(`${base}/api/search/files?q=SearchPanel`)
    assert.equal(filesResponse.status, 200)
    const files = await filesResponse.json() as { results: Array<{ path: string; project: string }>; state: string }
    assert.deepEqual(files.results.map((row) => [row.project, row.path]), [[WORKSPACE_PROJECT, 'app/SearchPanel.tsx']])

    const wildcardResponse = await fetch(`${base}/api/search/files?${new URLSearchParams({ q: '*.tsx', scopes: 'subproject:app' })}`)
    assert.equal(wildcardResponse.status, 200)
    const wildcard = await wildcardResponse.json() as { results: Array<{ path: string; project: string }> }
    assert.deepEqual(wildcard.results.map(row => [row.project, row.path]), [[WORKSPACE_PROJECT, 'app/SearchPanel.tsx']])

    await waitForSearchIndex(WORKSPACE_PROJECT)
    await waitForSearchIndex(DEFAULT_PROJECT)
    const contentResponse = await fetch(`${base}/api/search?q=uniqueNeedle&project=${encodeURIComponent(WORKSPACE_PROJECT)}`)
    assert.equal(contentResponse.status, 200)
    const content = await contentResponse.json() as { results: Array<{ path: string }>; state: string; version: number }
    assert.deepEqual(content.results.map((row) => row.path), ['app/SearchPanel.tsx'])
    assert.equal(content.state, 'ready')
    assert.ok(content.version >= 1)

    for (const route of ['/search', '/search/stream']) {
      const response = await fetch(`${base}/api${route}?${new URLSearchParams({ q: 'unique*workspace phrase', project: WORKSPACE_PROJECT, scopes: 'subproject:app' })}`)
      assert.equal(response.status, 200)
      if (route.endsWith('/stream')) {
        const stream = await response.text()
        assert.match(stream, /event: result/)
        assert.match(stream, /app\/SearchPanel.tsx/)
        assert.match(stream, /event: done/)
      } else {
        const result = await response.json() as { results: Array<{ path: string }> }
        assert.deepEqual(result.results.map(row => row.path), ['app/SearchPanel.tsx'])
      }
    }
    const regexFiles = await fetch(`${base}/api/search/files?${new URLSearchParams({ q: '^SearchPanel\\.tsx$', regex: '1', scopes: 'subproject:app' })}`)
    assert.equal(regexFiles.status, 200)
    const regexResult = await regexFiles.json() as { results: Array<{ path: string }> }
    assert.deepEqual(regexResult.results.map(row => row.path), ['app/SearchPanel.tsx'])
    const invalidRegex = await fetch(`${base}/api/search/files?${new URLSearchParams({ q: '(', regex: '1' })}`)
    assert.equal(invalidRegex.status, 400)

    setFileRule('guest', WORKSPACE_PROJECT, 'app/public.md', 'view')
    setFileRule('guest', WORKSPACE_PROJECT, 'app/private.md', 'inherit')
    role = 'guest'
    const guestResponse = await fetch(`${base}/api/search?q=${encodeURIComponent('shared permission')}&project=${encodeURIComponent(WORKSPACE_PROJECT)}`)
    assert.equal(guestResponse.status, 200)
    const guest = await guestResponse.json() as { results: Array<{ path: string }> }
    assert.deepEqual(guest.results.map((row) => row.path), ['app/public.md'])

    const longQuery = await fetch(`${base}/api/search?q=${'x'.repeat(2_001)}&project=${encodeURIComponent(WORKSPACE_PROJECT)}`)
    assert.equal(longQuery.status, 400)
  } finally {
    setFileRule('guest', WORKSPACE_PROJECT, 'app/public.md', 'inherit')
    await new Promise<void>((resolve) => server.close(() => resolve()))
    resetTreeWatchers()
    setWorkspaceRoot(original)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
