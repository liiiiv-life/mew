import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApiApp } from './api.ts'
import { setFileRule, setFeature } from './access-policy.ts'
import { setWorkspaceRoot, WORKSPACE_ROOT } from './paths.ts'
import { writeRootProjects } from './userUiState.ts'
import { resetTreeWatchers } from './watcher.ts'
import type { Role } from './reqAuth.ts'
import type { DocumentBacklinks } from './document-backlinks.ts'

test('backlink API includes registered projects, excludes parents and enforces source/target rights', async t => {
  const previous = WORKSPACE_ROOT, root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-backlink-api-'))
  const active = path.join(root, 'active'), registered = path.join(root, 'registered'), unknown = path.join(root, 'unknown')
  for (const folder of [active, registered, unknown]) fs.mkdirSync(path.join(folder, 'docs'), { recursive: true })
  setWorkspaceRoot(active)
  const target = path.join(active, 'docs/target.md'), source = path.join(active, 'docs/source.md'), external = path.join(registered, 'docs/ref.md')
  fs.writeFileSync(target, '---\ntitle: Target\n상위파일: MOC.md\n---\n')
  fs.writeFileSync(path.join(active, 'docs/MOC.md'), '[target](target.md)')
  fs.writeFileSync(source, '---\ntitle: Source\n---\n[target](target.md)')
  fs.writeFileSync(external, '---\ntitle: Registered source\n---\n[target](../../active/docs/target.md)')
  fs.writeFileSync(path.join(unknown, 'docs/ref.md'), '[target](../../active/docs/target.md)')
  const email = 'backlinks-api@example.test'
  writeRootProjects(email, { paths: [active, registered], icons: {} })
  let role: Role = 'owner'
  const app = express()
  app.use((req, _res, next) => { req.auth = { role, email: role === 'guest' ? null : email, mustChangePassword: false }; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    resetTreeWatchers(); setWorkspaceRoot(previous); fs.rmSync(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/docs/backlinks`
  const get = (file = 'target.md', project = 'docs') => fetch(`${base}?path=${encodeURIComponent(file)}&project=${project}`)
  const response = await get()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(((await response.json()) as DocumentBacklinks).documents.map(doc => doc.path).sort(), [source, external].sort())
  assert.equal((await get(target)).status, 200, 'absolute target can be opened through server-files access')
  setFileRule(email, 'docs', 'source.md', 'deny')
  assert.deepEqual(((await (await get()).json()) as DocumentBacklinks).documents.map(doc => doc.path), [external])
  setFileRule(email, 'docs', 'target.md', 'deny')
  assert.equal((await get()).status, 403)
  assert.equal((await get(target)).status, 403, 'absolute paths do not bypass known project ACLs')
  role = 'guest'
  setFileRule('guest', 'docs', 'target.md', 'view')
  setFileRule('guest', 'docs', 'source.md', 'view')
  assert.deepEqual(((await (await get()).json()) as DocumentBacklinks).documents.map(doc => doc.path), [source])
  assert.equal((await get(target)).status, 403, 'guest cannot use external file paths')
  setFeature('guest', 'filesRead', false)
  assert.equal((await get()).status, 403)
  role = 'owner'
  assert.equal((await get('../escape.md')).status, 400)
  assert.equal((await get('absent.md')).status, 404)
})
