import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { taskChanges } from '../shared/task-list.ts'

test('legacy hierarchies flatten without losing identity or visible ranges; every date becomes editable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-flat-schedule-'))
  process.env.MEW_DATA_DIR = directory
  const { changeTaskList, readTaskList, taskListFile, readTaskTags } = await import('./task-list.ts')
  const p = { id: 'p', text: 'parent', done: false, startDate: '2026-09-01', date: '2026-09-03' }
  const c = { id: 'c', text: 'child', done: true, parentId: 'p', startDate: '2026-09-13', date: '2026-09-17' }
  const g = { id: 'g', text: 'grandchild', done: false, parentId: 'c', date: '2026-09-19' }
  try {
    fs.writeFileSync(taskListFile('/root'), JSON.stringify({ version: 1, tasks: [p, c, g] }))
    const flattened = readTaskList('/root')
    assert.deepEqual(flattened.map(task => task.id), ['p', 'c', 'g'])
    assert.ok(flattened.every(task => !task.parentId))
    assert.equal(flattened[0].date, '2026-09-19')
    assert.equal(flattened[1].done, true)
    const edited = flattened.map(task => task.id === 'p' ? { ...task, startDate: '2026-10-01', date: '2026-10-03', tags: ['abc'] } : task)
    changeTaskList('/root', taskChanges(flattened, edited))
    assert.deepEqual(readTaskList('/root'), edited)
    assert.equal(JSON.parse(fs.readFileSync(taskListFile('/root'), 'utf8')).version, 2)
    assert.deepEqual(readTaskTags('/root'), ['abc'])
    changeTaskList('/root', taskChanges(edited, edited.slice(1)))
    assert.deepEqual(readTaskList('/root'), edited.slice(1), 'deleting a former parent leaves other rows intact')
    assert.deepEqual(readTaskTags('/root'), ['abc'], 'used tags remain available after deleting the last tagged row')
    assert.throws(() => changeTaskList('/root', taskChanges(edited.slice(1), [c, g])), /잘못된/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
