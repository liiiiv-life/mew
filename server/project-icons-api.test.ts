import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { createApiApp } from './api.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { readRootProjects, writeRootProjects } from './userUiState.ts'

test('shared icon API enforces owner access, persists project data and excludes icons from account saves', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-icon-api-'))
  const child = path.join(root, 'child')
  fs.mkdirSync(path.join(child, '.mew'), { recursive: true })
  const original = WORKSPACE_ROOT
  setWorkspaceRoot(root)
  const email = 'icons@example.com'
  writeRootProjects(email, { paths: [child], icons: { [child]: 'i:book' } })
  let role = 'owner'
  const app = express()
  app.use((req, _res, next) => {
    Object.assign(req, { auth: { role, email, mustChangePassword: false } })
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
  const request = (route: string, body: unknown, method = 'PUT') => fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  try {
    const restored = await (await fetch(base + '/user-ui/root-projects')).json() as { state: { icons: Record<string, string> } }
    assert.equal(restored.state.icons[child], 'i:book')
    for (const denied of ['manager', 'member', 'guest']) {
      role = denied
      assert.equal((await request('/project-icons', { path: child, icon: '🌱' })).status, 403)
      assert.equal((await request('/project-icons/read', { paths: [child] }, 'POST')).status, 403)
    }
    role = 'owner'
    assert.equal((await request('/project-icons', { path: child, icon: '🌱' })).status, 200)
    const icons = await (await request('/project-icons/read', { paths: [child] }, 'POST')).json() as { icons: Record<string, string> }
    assert.equal(icons.icons[child], '🌱')
    const projects = await (await fetch(base + '/projects')).json() as { name: string; icon: string }[]
    assert.equal(projects.find((project: { name: string }) => project.name === 'child')?.icon, '🌱')
    await request('/user-ui/root-projects', { paths: [child], icons: { [child]: 'i:stale' } })
    assert.deepEqual(readRootProjects(email)?.icons, {})
    assert.equal(JSON.parse(fs.readFileSync(path.join(child, '.mew/project-icon.json'), 'utf8')).icon, '🌱')
    assert.equal((await request('/project-icons', { path: child, icon: 'svg:<svg><script/></svg>' })).status, 400)
    assert.equal((await request('/project-icons', { path: child, icon: null })).status, 200)
    assert.deepEqual(await (await request('/project-icons/read', { paths: [child] }, 'POST')).json(), { icons: {} })
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    setWorkspaceRoot(original)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
