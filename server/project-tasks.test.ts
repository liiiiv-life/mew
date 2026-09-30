import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { ProjectTaskStore, TaskBoardError, validateTaskBoard } from './project-tasks.ts'
import { createProjectTaskRouter } from './project-task-routes.ts'
import { WORKSPACE_ROOT } from './paths.ts'

const board = { revision: 0, milestones: [{ id: 'm1', title: 'Release', due: '2026-10-01' }], tasks: [{ id: 't1', title: 'Review', due: null, milestoneId: 'm1', status: 'doing' as const }] }
test('project boards persist, isolate roots, reject stale writes and preserve corrupt files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-tasks-'))
  try {
    const store = new ProjectTaskStore(dir)
    assert.equal(store.save('/one', board).revision, 1)
    assert.equal(new ProjectTaskStore(dir).read('/one').tasks[0].title, 'Review')
    assert.equal(store.read('/two').tasks.length, 0)
    assert.throws(() => store.save('/one', board), (e: unknown) => e instanceof TaskBoardError && e.status === 409)
    assert.equal(store.read('/one').revision, 1)
    fs.writeFileSync(store.file('/one'), '{broken')
    assert.throws(() => store.save('/one', board))
    assert.equal(fs.readFileSync(store.file('/one'), 'utf8'), '{broken')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('validation rejects invalid dates, duplicate ids, dangling milestones and malformed input', () => {
  assert.equal(validateTaskBoard(board).tasks.length, 1)
  for (const value of [null, {}, { ...board, revision: -1 }, { ...board, tasks: [...board.tasks, board.tasks[0]] }, { ...board, milestones: [] }, { ...board, tasks: [{ ...board.tasks[0], status: 'other' }] }, { ...board, tasks: [{ ...board.tasks[0], due: '2026-02-30' }] }, { ...board, milestones: [null] }]) assert.throws(() => validateTaskBoard(value))
})
test('task API enforces role, workspace identity and revision conflict', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-task-api-'))
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role: req.headers['x-role'] === 'owner' ? 'owner' : 'guest', email: 'test@example.test', mustChangePassword: false }; next() })
  app.use('/tasks', createProjectTaskRouter(new ProjectTaskStore(dir)))
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/tasks`
  try {
    assert.equal((await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`)).status, 403)
    assert.equal((await fetch(`${url}?workspace=/wrong`, { headers: { 'x-role': 'owner' } })).status, 409)
    const put = () => fetch(url, { method: 'PUT', headers: { 'x-role': 'owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: WORKSPACE_ROOT, board }) })
    assert.equal((await put()).status, 200)
    assert.equal((await put()).status, 409)
    const result = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers: { 'x-role': 'owner' } })
    assert.equal(((await result.json()) as { tasks: { title: string }[] }).tasks[0].title, 'Review')
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('hierarchy validates parents and cycles, optional priority and time, and legacy defaults', () => {
  const legacy = validateTaskBoard(board).tasks[0]
  assert.equal(legacy.parentId, null)
  assert.equal(legacy.priority, null)
  assert.equal(legacy.time, null)
  const child = { ...board.tasks[0], id: 'child', parentId: 't1', priority: 'high', time: '23:59' }
  assert.equal(validateTaskBoard({ ...board, tasks: [...board.tasks, child] }).tasks[1].parentId, 't1')
  for (const patch of [{ parentId: 'missing' }, { parentId: 't1' }, { priority: 'urgent' }, { time: '24:00' }, { time: '12:60' }]) {
    assert.throws(() => validateTaskBoard({ ...board, tasks: [{ ...board.tasks[0], ...patch }] }))
  }
  assert.throws(() => validateTaskBoard({ ...board, tasks: [{ ...board.tasks[0], parentId: 'child' }, child] }))
})
