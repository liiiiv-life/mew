import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyTaskChanges, taskChanges, TaskConflict, type TaskItem } from '../shared/task-list.ts'
import { validAssignees } from '../shared/task-assignees.ts'

const a = 'one@example.test', b = 'two@example.test'
const original: TaskItem = { id: 'task', text: 'Assign work', done: false }

test('assignees merge with unrelated fields and reject same-field and deletion conflicts atomically', () => {
  const assigned = { ...original, assignees: [a] }
  const changes = taskChanges([original], [assigned])
  assert.equal(changes.length, 1)
  assert.deepEqual(applyTaskChanges([{ ...original, text: 'Remote', done: true, tags: ['work'] }], changes), [{ ...assigned, text: 'Remote', done: true, tags: ['work'] }])
  assert.deepEqual(applyTaskChanges([assigned], changes), [assigned])
  assert.throws(() => applyTaskChanges([{ ...original, assignees: [b] }], changes), TaskConflict)
  assert.throws(() => applyTaskChanges([assigned], taskChanges([original], [])), TaskConflict)
  assert.throws(() => applyTaskChanges([assigned], taskChanges([], [{ ...original, assignees: [b] }])), TaskConflict)
  assert.deepEqual(applyTaskChanges([assigned], taskChanges([assigned], [original])), [{ ...original, assignees: [] }])
  assert.equal(taskChanges([original], [{ ...original, assignees: [] }]).length, 0)
  for (const value of [[a, a], ['ONE@example.test'], ['bad'], [null], Array(101).fill(a)]) assert.equal(validAssignees(value), false)
})

test('Markdown persists assignees, preserves body/custom properties and accepts external edits', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-assignees-'))
  process.env.MEW_DATA_DIR = path.join(directory, 'data')
  const workspace = path.join(directory, 'workspace')
  const { changeTaskList, readTaskList } = await import('./task-list.ts')
  try {
    const created = changeTaskList(workspace, taskChanges([], [{ ...original, assignees: [a, b] }]))
    const file = path.join(workspace, created[0].path!)
    let raw = fs.readFileSync(file, 'utf8')
    assert.match(raw, /assignees:\n  - one@example.test\n  - two@example.test/)
    raw = raw.replace('done: false', 'priority: urgent\ndone: false') + '\nBody stays here.\n'
    fs.writeFileSync(file, raw)
    const baseline = readTaskList(workspace)
    const changed = changeTaskList(workspace, taskChanges(baseline, [{ ...baseline[0], assignees: [b], done: true }]))
    assert.deepEqual(changed[0].assignees, [b])
    assert.match(fs.readFileSync(file, 'utf8'), /priority: urgent/)
    assert.match(fs.readFileSync(file, 'utf8'), /Body stays here/)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('assignees:\n  - two@example.test', 'assignees: one@example.test'))
    assert.deepEqual(readTaskList(workspace)[0].assignees, [a])
    const external = readTaskList(workspace)
    changeTaskList(workspace, taskChanges(external, [{ ...external[0], assignees: [] }]))
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /assignees:/)
    assert.equal(readTaskList(workspace)[0].assignees, undefined)
    const beforeInvalid = fs.readFileSync(file, 'utf8')
    assert.throws(() => changeTaskList(workspace, taskChanges(readTaskList(workspace), [{ ...external[0], assignees: ['bad'] }])), /잘못된/)
    assert.equal(fs.readFileSync(file, 'utf8'), beforeInvalid)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
