import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { taskChanges } from '../shared/task-list.ts'

test('task objects persist, merge unrelated edits, reject conflicts and protect corrupt files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-task-list-'))
  process.env.MEW_DATA_DIR = directory
  const { changeTaskList, readTaskList, taskListFile } = await import('./task-list.ts')
  const { createTaskListRouter } = await import('./task-list-routes.ts')
  const { WORKSPACE_ROOT } = await import('./paths.ts')
  const { setFeature, setFileRule } = await import('./access-policy.ts')
  const a = { id: 'a', text: 'first', done: false }, b = { id: 'b', text: 'second', done: false }
  let role: 'owner' | 'member' | 'guest' = 'owner'
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.auth = { role, email: role === 'guest' ? null : 'one@example.test', mustChangePassword: false }; next() })
  app.use('/tasks', createTaskListRouter())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/tasks`
  const headers = { 'Content-Type': 'application/json', 'X-Mew-Task-Owner': encodeURIComponent('one@example.test') }
  try {
    assert.deepEqual(changeTaskList('/project-a', taskChanges([], [a, b])), [a, b])
    const dated = { ...a, date: '2028-02-29' }
    assert.deepEqual(changeTaskList('/dated', taskChanges([], [dated])), [dated])
    assert.deepEqual(readTaskList('/dated'), [dated])
    assert.throws(() => changeTaskList('/dated', taskChanges([dated], [{ ...a, date: '2026-02-29' }])), /잘못된/)
    assert.equal(readTaskList('/dated')[0].date, '2028-02-29')
    assert.equal(changeTaskList('/dated', taskChanges([dated], [{ ...a, date: null }]))[0].date, null)
    assert.deepEqual(readTaskList('/dated'), [a])
    const nested = [a, { ...b, parentId: a.id }]
    assert.deepEqual(changeTaskList('/nested', taskChanges([], nested)), nested)
    assert.deepEqual(readTaskList('/nested'), nested)
    assert.throws(() => changeTaskList('/nested', taskChanges(nested, [a, { ...b, parentId: 'missing' }])), /다른 창/)
    assert.deepEqual(readTaskList('/nested'), nested)
    assert.deepEqual(readTaskList('/project-b'), [], 'root projects are isolated')
    assert.deepEqual(readTaskList('/project-a'), [a, b])
    changeTaskList('/project-a', taskChanges([a, b], [{ ...a, done: true }, b]))
    const merged = changeTaskList('/project-a', taskChanges([a, b], [{ ...a, text: 'edited' }, b]))
    assert.deepEqual(merged[0], { ...a, text: 'edited', done: true }, 'different fields merge')
    assert.throws(() => changeTaskList('/project-a', taskChanges([a, b], [{ ...a, text: 'conflict' }, b])), /다른 창/)
    assert.deepEqual(readTaskList('/project-a'), merged, 'conflicting batch is atomic')
    fs.mkdirSync(`${taskListFile('/project-a')}.tmp-${process.pid}`)
    assert.throws(() => changeTaskList('/project-a', taskChanges(merged, [merged[0]])))
    assert.deepEqual(readTaskList('/project-a'), merged, 'failed atomic write preserves all objects')
    fs.rmdirSync(`${taskListFile('/project-a')}.tmp-${process.pid}`)
    assert.throws(() => changeTaskList('/project-a', [{ id: 'b', before: b, after: { ...b, text: 'x'.repeat(8001) }, afterId: null }]), /잘못된/)
    assert.throws(() => changeTaskList('/project-a', [{ id: 'b', after: b }]), /잘못된/)
    assert.deepEqual(changeTaskList('/project-c', taskChanges([], [a])), [a])
    assert.deepEqual(changeTaskList('/project-c', taskChanges([], [a])), [a], 'lost-response retries are idempotent')
    changeTaskList('/order', taskChanges([], [a, b]))
    changeTaskList('/order', taskChanges([a, b], [b, a]))
    assert.deepEqual(readTaskList('/order'), [b, a], 'object order persists without changing completion')
    assert.throws(() => changeTaskList('/order', [{ id: 'a', before: a, after: a, afterId: 'missing', move: true }]), /다른 창/)
    assert.deepEqual(readTaskList('/order'), [b, a])
    fs.writeFileSync(taskListFile('/broken'), '{bad')
    assert.throws(() => changeTaskList('/broken', taskChanges([], [a])))
    assert.equal(fs.readFileSync(taskListFile('/broken'), 'utf8'), '{bad')
    fs.writeFileSync(taskListFile('/null'), 'null')
    assert.throws(() => changeTaskList('/null', taskChanges([], [a])))
    assert.equal(fs.readFileSync(taskListFile('/null'), 'utf8'), 'null')

    const periodTask = { ...a, startDate: '2026-10-03', date: '2026-10-07' }
    changeTaskList('/period', taskChanges([], [periodTask]))
    assert.deepEqual(readTaskList('/period'), [periodTask])
    changeTaskList('/period', taskChanges([periodTask], [{ ...periodTask, startDate: '2026-10-04' }]))
    assert.equal(readTaskList('/period')[0].startDate, '2026-10-04')
    assert.throws(() => changeTaskList('/period', [{ id: a.id, before: periodTask, after: { ...periodTask, startDate: '2026-10-10' }, afterId: null }]), /잘못된/)
    assert.throws(() => changeTaskList('/period', [{ id: a.id, before: periodTask, after: { ...periodTask, startDate: 42 }, afterId: null }]), /잘못된/)
    assert.deepEqual(readTaskList('/period'), [{ ...periodTask, startDate: '2026-10-04' }])

    let response = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ workspace: WORKSPACE_ROOT, changes: taskChanges([], [a, b]) }) })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json() as { tasks: unknown }).tasks, [a, b])
    response = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { canEdit: boolean }).canEdit, true)
    response = await fetch(`${url}?workspace=/wrong`, { headers }); assert.equal(response.status, 409)
    response = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers: { ...headers, 'X-Mew-Task-Owner': 'other' } }); assert.equal(response.status, 409)
    role = 'guest'
    response = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers }); assert.equal(response.status, 403)
    role = 'member'
    setFeature('one@example.test', 'filesRead', true)
    setFeature('one@example.test', 'filesWrite', false)
    setFileRule('one@example.test', '.workspace', '', 'view')
    response = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers })
    assert.equal(response.status, 200); assert.equal((await response.json() as { canEdit: boolean }).canEdit, false)
    response = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ workspace: WORKSPACE_ROOT, changes: taskChanges([a, b], [b]) }) }); assert.equal(response.status, 403)
    setFeature('one@example.test', 'filesRead', false)
    response = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers }); assert.equal(response.status, 403)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }) }
})
