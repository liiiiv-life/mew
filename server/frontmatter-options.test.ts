import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApiApp } from './api.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { readFrontmatterOptions, updateFrontmatterOptions } from './frontmatter-options.ts'
import { setFileRule } from './access-policy.ts'

test('project options persist, merge deltas, isolate projects and enforce project file access', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-frontmatter-options-'))
  const original = WORKSPACE_ROOT
  for (const project of ['one', 'two']) fs.mkdirSync(path.join(root, project, '.mew'), { recursive: true })
  setWorkspaceRoot(root)
  let role = 'member'
  const email = 'options@example.test'
  const app = express()
  app.use((req, _res, next) => { Object.assign(req, { auth: { role, email, mustChangePassword: false } }); next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/frontmatter-options`
  const add = (body: unknown) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.deepEqual(await (await fetch(`${base}?project=one&field=status`)).json(), { options: null })
    const responses = await Promise.all([
      add({ project: 'one', field: 'status', seed: ['Draft'], add: ['Review'] }),
      add({ project: 'one', field: 'status', seed: ['Stale'], add: ['Published'] }),
    ])
    assert.ok(responses.every(response => response.status === 200))
    assert.deepEqual(new Set(readFrontmatterOptions('one', 'status')), new Set(['Draft', 'Review', 'Published']))
    assert.equal(readFrontmatterOptions('two', 'status'), null)
    assert.equal(readFrontmatterOptions('one', 'category'), null)
    assert.equal((await add({ project: 'one', field: 'status', remove: ['Review'] })).status, 200)
    assert.deepEqual(updateFrontmatterOptions('one', 'status', { seed: ['Review'], add: ['Draft'] }), ['Draft', 'Published'])
    assert.deepEqual(updateFrontmatterOptions('one', '__proto__', { add: ['Safe'] }), ['Safe'])
    assert.deepEqual(readFrontmatterOptions('one', '__proto__'), ['Safe'])
    assert.equal((await add({ project: 'one', field: 'status', add: [123] })).status, 400)
    assert.equal((await add({ project: 'one', field: '', add: ['Bad'] })).status, 400)
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'one/.mew/frontmatter-options.json'), 'utf8')).version, 1)
    role = 'guest'
    assert.equal((await fetch(`${base}?project=one&field=status`)).status, 403)
    assert.equal((await add({ project: 'one', field: 'status', add: ['Bad'] })).status, 403)
    role = 'member'
    setFileRule(email, 'one', 'private', 'deny')
    assert.equal((await fetch(`${base}?project=one&field=status`)).status, 403)
    assert.equal((await add({ project: 'one', field: 'status', add: ['Bad'] })).status, 403)
    setFileRule(email, 'one', 'private', 'inherit')
    const file = path.join(root, 'one/.mew/frontmatter-options.json')
    fs.writeFileSync(file, '{broken')
    assert.throws(() => updateFrontmatterOptions('one', 'status', { add: ['Lost'] }))
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken', 'corrupt storage is preserved')
    fs.rmSync(file)
    fs.symlinkSync(path.join(root, 'two/.mew'), file)
    assert.throws(() => readFrontmatterOptions('one', 'status'), /심볼릭/)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    setWorkspaceRoot(original)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
