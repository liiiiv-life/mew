import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseDocument } from 'yaml'
import { taskChanges } from '../shared/task-list.ts'

test('Markdown is authoritative; edits preserve body and custom properties, renames and deletion synchronize safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-task-md-'))
  process.env.MEW_DATA_DIR = path.join(root, 'data')
  const { readTaskList, changeTaskList, taskListFile } = await import('./task-list.ts')
  const workspace = path.join(root, 'workspace')
  const a = { id: 'a', text: '제목 #literal @literal', tags: ['작업'], done: false, startDate: '2026-10-01', date: '2026-10-06' }
  try {
    let tasks = changeTaskList(workspace, taskChanges([], [a]))
    const file = path.join(workspace, tasks[0].path!)
    const parse = () => parseDocument(fs.readFileSync(file, 'utf8').split('---')[1]).toJS()
    assert.equal(parse().title, a.text)
    assert.deepEqual(parse().tags, a.tags)
    assert.equal(parse().startDate, a.startDate)
    assert.equal(parse().date, a.date)
    fs.appendFileSync(file, '# 본문\n\n내용을 유지합니다.\n')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('done: false', 'done: true\ncustom: preserved # comment'))
    tasks = readTaskList(workspace)
    assert.equal(tasks[0].done, true)
    const next = [{ ...tasks[0], text: '새 제목', date: null, tags: ['새태그'] }]
    changeTaskList(workspace, taskChanges(tasks, next))
    assert.equal(parse().title, '새 제목')
    assert.equal(parse().date, undefined)
    assert.equal(parse().custom, 'preserved')
    assert.ok(fs.readFileSync(file, 'utf8').endsWith('# 본문\n\n내용을 유지합니다.\n'))
    const renamed = path.join(workspace, 'tasks/이름 변경.md')
    fs.renameSync(file, renamed)
    tasks = readTaskList(workspace)
    assert.equal(tasks[0].path, 'tasks/이름 변경.md')
    const external = '---\nid: external\ntitle: 직접 추가\ndone: false\n---\n'
    fs.writeFileSync(path.join(workspace, 'tasks/external.md'), external)
    assert.equal(readTaskList(workspace).length, 2)
    const before = readTaskList(workspace)
    changeTaskList(workspace, taskChanges(before, before.map(task => task.id === 'a' ? { ...task, done: false } : task)))
    assert.equal(fs.readFileSync(path.join(workspace, 'tasks/external.md'), 'utf8'), external, 'unrelated documents remain unchanged')
    const raw = fs.readFileSync(renamed, 'utf8')
    fs.writeFileSync(renamed, raw.replace('title: 새 제목', 'title: 외부 제목'))
    assert.throws(() => changeTaskList(workspace, taskChanges(before, before.filter(task => task.id !== 'a'))), /다른 창/)
    tasks = readTaskList(workspace)
    fs.mkdirSync(`${taskListFile(workspace)}.tmp-${process.pid}`)
    assert.throws(() => changeTaskList(workspace, taskChanges(tasks, [])))
    assert.deepEqual(readTaskList(workspace), tasks, 'all files roll back if metadata cannot commit')
    fs.rmdirSync(`${taskListFile(workspace)}.tmp-${process.pid}`)
    fs.writeFileSync(renamed, '---\ninvalid: [\n---\n')
    assert.throws(() => changeTaskList(workspace, []))
    assert.equal(fs.readFileSync(renamed, 'utf8'), '---\ninvalid: [\n---\n')
    fs.writeFileSync(renamed, raw)
    tasks = readTaskList(workspace)
    changeTaskList(workspace, taskChanges(tasks, tasks.filter(task => task.id !== 'a')))
    assert.equal(fs.existsSync(renamed), false)
    fs.unlinkSync(path.join(workspace, 'tasks/external.md'))
    assert.deepEqual(readTaskList(workspace), [], 'external deletion removes the panel item')
    const legacyRoot = path.join(root, 'legacy')
    fs.mkdirSync(path.join(legacyRoot, 'tasks'), { recursive: true })
    fs.writeFileSync(taskListFile(legacyRoot), JSON.stringify({ version: 2, tasks: [a] }))
    fs.writeFileSync(path.join(legacyRoot, 'tasks/user.md'), external)
    assert.throws(() => changeTaskList(legacyRoot, []), /중복/)
    assert.equal(fs.readFileSync(path.join(legacyRoot, 'tasks/user.md'), 'utf8'), external, 'migration does not remove preexisting documents')
    fs.symlinkSync(taskListFile(workspace), path.join(workspace, 'tasks/link.md'))
    assert.throws(() => readTaskList(workspace), /Invalid task file/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
