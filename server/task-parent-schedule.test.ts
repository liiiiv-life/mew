import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { taskChanges } from '../shared/task-list.ts'

test('legacy hierarchies flatten without losing identity or visible ranges; every date becomes editable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-flat-schedule-'))
  process.env.MEW_DATA_DIR = directory
  process.env.MEW_WORKSPACE = path.join(directory, 'workspace')
  fs.mkdirSync(process.env.MEW_WORKSPACE)
  const { changeTaskList: change, readTaskList: read, taskListFile, readTaskTags } = await import('./task-list.ts')
  const readTaskList = (workspace: string) => read(workspace).map(({ path: _path, ...task }) => task)
  const changeTaskList = (workspace: string, changes: unknown) => change(workspace, changes).map(({ path: _path, ...task }) => task)
  const p = { id: 'p', text: 'parent', done: false, startDate: '2026-09-01', date: '2026-09-03' }
  const c = { id: 'c', text: 'child', done: true, parentId: 'p', startDate: '2026-09-13', date: '2026-09-17' }
  const g = { id: 'g', text: 'grandchild', done: false, parentId: 'c', date: '2026-09-19' }
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(taskListFile(path.join(directory, 'root')), JSON.stringify({ version: 1, tasks: [p, c, g] }))
    const flattened = readTaskList(path.join(directory, 'root'))
    assert.deepEqual(flattened.map(task => task.id), ['p', 'c', 'g'])
    assert.ok(flattened.every(task => !task.parentId))
    assert.equal(flattened[0].date, '2026-09-19')
    assert.equal(flattened[1].done, true)
    const edited = flattened.map(task => task.id === 'p' ? { ...task, startDate: '2026-10-01', date: '2026-10-03', tags: ['abc'] } : task)
    changeTaskList(path.join(directory, 'root'), taskChanges(flattened, edited))
    assert.deepEqual(readTaskList(path.join(directory, 'root')), edited)
    assert.equal(JSON.parse(fs.readFileSync(taskListFile(path.join(directory, 'root')), 'utf8')).version, 5)
    assert.deepEqual(readTaskTags(path.join(directory, 'root')), ['abc'])
    changeTaskList(path.join(directory, 'root'), taskChanges(edited, edited.slice(1)))
    assert.deepEqual(readTaskList(path.join(directory, 'root')), edited.slice(1), 'deleting a former parent leaves other rows intact')
    assert.deepEqual(readTaskTags(path.join(directory, 'root')), ['abc'], 'used tags remain available after deleting the last tagged row')
    assert.throws(() => changeTaskList(path.join(directory, 'root'), taskChanges(edited.slice(1), [c, g])), /잘못된/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
