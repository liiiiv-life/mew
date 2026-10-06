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
  process.env.MEW_WORKSPACE = path.join(directory, 'workspace')
  fs.mkdirSync(process.env.MEW_WORKSPACE)
  const { changeTaskList: change, readTaskList: read, taskListFile } = await import('./task-list.ts')
  const readTaskList = (workspace: string) => read(workspace).map(({ path: _path, ...task }) => task)
  const changeTaskList = (workspace: string, changes: unknown) => change(workspace, changes).map(({ path: _path, ...task }) => task)
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
    assert.deepEqual(changeTaskList(path.join(directory, 'project-a'), taskChanges([], [a, b])), [a, b])
    const dated = { ...a, date: '2028-02-29' }
    assert.deepEqual(changeTaskList(path.join(directory, 'dated'), taskChanges([], [dated])), [dated])
    assert.deepEqual(readTaskList(path.join(directory, 'dated')), [dated])
    assert.throws(() => changeTaskList(path.join(directory, 'dated'), taskChanges([dated], [{ ...a, date: '2026-02-29' }])), /잘못된/)
    assert.equal(readTaskList(path.join(directory, 'dated'))[0].date, '2028-02-29')
    assert.equal(changeTaskList(path.join(directory, 'dated'), taskChanges([dated], [{ ...a, date: null }]))[0].date, undefined)
    assert.deepEqual(readTaskList(path.join(directory, 'dated')), [a])
    const nested = [a, { ...b, parentId: a.id }]
    assert.throws(() => changeTaskList(path.join(directory, 'nested'), taskChanges([], nested)), /잘못된/)
    fs.writeFileSync(taskListFile(path.join(directory, 'nested')), JSON.stringify({ version: 1, tasks: nested }))
    assert.deepEqual(readTaskList(path.join(directory, 'nested')), [a, b], 'legacy hierarchy becomes independent rows')
    assert.deepEqual(readTaskList(path.join(directory, 'project-b')), [], 'root projects are isolated')
    assert.deepEqual(readTaskList(path.join(directory, 'project-a')), [a, b])
    changeTaskList(path.join(directory, 'project-a'), taskChanges([a, b], [{ ...a, done: true }, b]))
    const merged = changeTaskList(path.join(directory, 'project-a'), taskChanges([a, b], [{ ...a, text: 'edited' }, b]))
    assert.deepEqual(merged[0], { ...a, text: 'edited', done: true }, 'different fields merge')
    assert.throws(() => changeTaskList(path.join(directory, 'project-a'), taskChanges([a, b], [{ ...a, text: 'conflict' }, b])), /다른 창/)
    assert.deepEqual(readTaskList(path.join(directory, 'project-a')), merged, 'conflicting batch is atomic')
    fs.mkdirSync(`${taskListFile(path.join(directory, 'project-a'))}.tmp-${process.pid}`)
    assert.throws(() => changeTaskList(path.join(directory, 'project-a'), taskChanges(merged, [merged[0]])))
    assert.deepEqual(readTaskList(path.join(directory, 'project-a')), merged, 'failed atomic write preserves all objects')
    fs.rmdirSync(`${taskListFile(path.join(directory, 'project-a'))}.tmp-${process.pid}`)
    assert.throws(() => changeTaskList(path.join(directory, 'project-a'), [{ id: 'b', before: b, after: { ...b, text: 'x'.repeat(8001) }, afterId: null }]), /잘못된/)
    assert.throws(() => changeTaskList(path.join(directory, 'project-a'), [{ id: 'b', after: b }]), /잘못된/)
    assert.deepEqual(changeTaskList(path.join(directory, 'project-c'), taskChanges([], [a])), [a])
    assert.deepEqual(changeTaskList(path.join(directory, 'project-c'), taskChanges([], [a])), [a], 'lost-response retries are idempotent')
    changeTaskList(path.join(directory, 'order'), taskChanges([], [a, b]))
    changeTaskList(path.join(directory, 'order'), taskChanges([a, b], [b, a]))
    assert.deepEqual(readTaskList(path.join(directory, 'order')), [b, a], 'object order persists without changing completion')
    assert.throws(() => changeTaskList(path.join(directory, 'order'), [{ id: 'a', before: a, after: a, afterId: 'missing', move: true }]), /다른 창/)
    assert.deepEqual(readTaskList(path.join(directory, 'order')), [b, a])
    fs.writeFileSync(taskListFile(path.join(directory, 'broken')), '{bad')
    assert.throws(() => changeTaskList(path.join(directory, 'broken'), taskChanges([], [a])))
    assert.equal(fs.readFileSync(taskListFile(path.join(directory, 'broken')), 'utf8'), '{bad')
    fs.writeFileSync(taskListFile(path.join(directory, 'null')), 'null')
    assert.throws(() => changeTaskList(path.join(directory, 'null'), taskChanges([], [a])))
    assert.equal(fs.readFileSync(taskListFile(path.join(directory, 'null')), 'utf8'), 'null')

    const periodTask = { ...a, startDate: '2026-10-03', date: '2026-10-07' }
    changeTaskList(path.join(directory, 'period'), taskChanges([], [periodTask]))
    assert.deepEqual(readTaskList(path.join(directory, 'period')), [periodTask])
    changeTaskList(path.join(directory, 'period'), taskChanges([periodTask], [{ ...periodTask, startDate: '2026-10-04' }]))
    assert.equal(readTaskList(path.join(directory, 'period'))[0].startDate, '2026-10-04')
    assert.throws(() => changeTaskList(path.join(directory, 'period'), [{ id: a.id, before: periodTask, after: { ...periodTask, startDate: '2026-10-10' }, afterId: null }]), /잘못된/)
    assert.throws(() => changeTaskList(path.join(directory, 'period'), [{ id: a.id, before: periodTask, after: { ...periodTask, startDate: 42 }, afterId: null }]), /잘못된/)
    assert.deepEqual(readTaskList(path.join(directory, 'period')), [{ ...periodTask, startDate: '2026-10-04' }])

    fs.writeFileSync(taskListFile(WORKSPACE_ROOT), JSON.stringify({ version: 2, tasks: [a, b], tags: ['보존'] }))
    role = 'member'
    setFeature('one@example.test', 'filesRead', true)
    setFeature('one@example.test', 'filesWrite', false)
    setFileRule('one@example.test', '.workspace', '', 'view')
    const readonlyLegacy = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers })
    assert.equal(readonlyLegacy.status, 200)
    assert.equal(fs.existsSync(path.join(WORKSPACE_ROOT, 'tasks')), false, 'read-only access does not migrate files')
    role = 'owner'
    setFeature('one@example.test', 'filesWrite', true)
    setFileRule('one@example.test', '.workspace', '', 'edit')
    const migrated = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers })
    assert.equal(migrated.status, 200)
    assert.equal(fs.existsSync(path.join(WORKSPACE_ROOT, 'docs/tasks/first.md')), true, 'writable panel read migrates legacy tasks')
    assert.equal(JSON.parse(fs.readFileSync(taskListFile(WORKSPACE_ROOT), 'utf8')).version, 5)
    fs.mkdirSync(path.join(WORKSPACE_ROOT, 'tasks'))
    fs.renameSync(path.join(WORKSPACE_ROOT, 'docs/tasks/first.md'), path.join(WORKSPACE_ROOT, 'tasks/a.md'))
    fs.renameSync(path.join(WORKSPACE_ROOT, 'docs/tasks/second.md'), path.join(WORKSPACE_ROOT, 'tasks/b.md'))
    for (const id of ['a', 'b']) {
      const file = path.join(WORKSPACE_ROOT, `tasks/${id}.md`)
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('---\n', `---\nid: ${id}\n`))
    }
    fs.writeFileSync(taskListFile(WORKSPACE_ROOT), JSON.stringify({ version: 3, order: ['a', 'b'], tags: ['보존'] }))
    role = 'member'
    setFeature('one@example.test', 'filesWrite', false)
    setFileRule('one@example.test', '.workspace', '', 'view')
    const readonlyMarkdown = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers })
    assert.equal(readonlyMarkdown.status, 200)
    assert.equal(fs.existsSync(path.join(WORKSPACE_ROOT, 'tasks/a.md')), true, 'read-only legacy Markdown stays in place')
    role = 'owner'
    setFeature('one@example.test', 'filesWrite', true)
    setFileRule('one@example.test', '.workspace', '', 'edit')
    const movedMarkdown = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers })
    assert.equal(movedMarkdown.status, 200)
    assert.equal(fs.existsSync(path.join(WORKSPACE_ROOT, 'tasks/a.md')), false)
    assert.equal(read(WORKSPACE_ROOT)[0].path, 'docs/tasks/first.md')
    assert.deepEqual(read(WORKSPACE_ROOT).map(task => task.id), ['a', 'b'])
    const titleFile = path.join(WORKSPACE_ROOT, 'docs/tasks/first.md')
    fs.writeFileSync(titleFile, fs.readFileSync(titleFile, 'utf8').replace('title: first', 'title: changed outside'))
    const retitled = await fetch(`${url}?workspace=${encodeURIComponent(WORKSPACE_ROOT)}`, { headers })
    assert.equal(retitled.status, 200)
    assert.equal(read(WORKSPACE_ROOT)[0].path, 'docs/tasks/changed outside.md', 'external frontmatter title changes rename the file on writable refresh')
    changeTaskList(WORKSPACE_ROOT, taskChanges(read(WORKSPACE_ROOT), [a, b]))
    let response = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ workspace: WORKSPACE_ROOT, changes: taskChanges([], [a, b]) }) })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json() as { tasks: unknown }).tasks, read(WORKSPACE_ROOT))
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
