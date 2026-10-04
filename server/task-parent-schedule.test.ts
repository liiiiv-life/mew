import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { taskChanges } from '../shared/task-list.ts'
import { taskRollups } from '../shared/task-rollup.ts'

test('parent dates are read-only on writes, including a concurrently added child, while leaf edits persist', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-parent-schedule-'))
  process.env.MEW_DATA_DIR = directory
  const { changeTaskList, readTaskList } = await import('./task-list.ts')
  const p = { id: 'p', text: 'parent', done: false, startDate: '2026-09-01', date: '2026-09-03' }
  const c = { id: 'c', text: 'child', done: false, parentId: 'p', startDate: '2026-09-13', date: '2026-09-17' }
  try {
    changeTaskList('/root', taskChanges([], [p]))
    changeTaskList('/root', taskChanges([p], [p, c]))
    assert.throws(() => changeTaskList('/root', taskChanges([p], [{ ...p, date: '2026-09-20' }])), /자동 계산/)
    assert.deepEqual(readTaskList('/root'), [p, c], 'rejected parent edits leave the file untouched')
    assert.throws(() => changeTaskList('/root', taskChanges([p, c], [{ ...p, startDate: null, date: null }, c])), /자동 계산/)
    const edited = [{ ...p, text: 'updated', done: true }, { ...c, date: '2026-09-19' }]
    changeTaskList('/root', taskChanges([p, c], edited))
    assert.deepEqual(readTaskList('/root'), edited)
    assert.deepEqual(taskRollups(readTaskList('/root')).ranges.get('p'), { start: '2026-09-13', end: '2026-09-19' })
    changeTaskList('/root', taskChanges(edited, [edited[0]]))
    changeTaskList('/root', taskChanges([edited[0]], [{ ...edited[0], date: '2026-09-08' }]))
    assert.equal(readTaskList('/root')[0].date, '2026-09-08', 'dates become editable after the last child is removed')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
