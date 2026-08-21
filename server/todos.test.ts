import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-todos-'))
process.env.MEW_DATA_DIR = dir

const { createTodo, deleteTodo, listTodos, TodoError, updateTodo } = await import('./todos.ts')

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

test('createTodo/listTodos: 로그인 사용자별로 저장한다', () => {
  const a = createTodo('A@EXAMPLE.COM', { text: ' 첫째  항목 ', type: 'dated', due: '2026-08-20', time: '09:05', projects: ['mew', 'docs'] })
  const b = createTodo('b@example.com', { text: '남의 항목', due: null })

  assert.equal(a.text, '첫째 항목')
  assert.equal(a.type, 'dated')
  assert.equal(a.status, 'open')
  assert.equal(a.due, '2026-08-20')
  assert.equal(a.time, '09:05')
  assert.deepEqual(a.projects, ['mew', 'docs'])
  assert.equal(a.done, false)
  assert.equal(listTodos('a@example.com').length, 1)
  assert.equal(listTodos('a@example.com')[0].id, a.id)
  assert.equal(listTodos('b@example.com')[0].id, b.id)
})

test('updateTodo: 본문·상태·기한·시간·프로젝트를 바꾼다', () => {
  const item = createTodo('edit@example.com', { text: '고칠 항목' })
  const done = updateTodo('edit@example.com', item.id, { type: 'dated', status: 'done', due: '2026-09-01', time: '23:59', projects: ['mew'] })

  assert.equal(done.type, 'dated')
  assert.equal(done.status, 'done')
  assert.equal(done.done, true)
  assert.equal(done.due, '2026-09-01')
  assert.equal(done.time, '23:59')
  assert.deepEqual(done.projects, ['mew'])

  const renamed = updateTodo('edit@example.com', item.id, { text: '바꾼 항목', type: 'recurring', due: null, time: null })
  assert.equal(renamed.text, '바꾼 항목')
  assert.equal(renamed.type, 'recurring')
  assert.equal(renamed.due, null)
  assert.equal(renamed.time, null)
})

test('deleteTodo: 자기 항목만 지운다', () => {
  const item = createTodo('delete@example.com', { text: '지울 항목' })
  assert.throws(() => deleteTodo('other@example.com', item.id), TodoError)
  deleteTodo('delete@example.com', item.id)
  assert.equal(listTodos('delete@example.com').length, 0)
})

test('validation: 빈 본문과 잘못된 기한·시간은 거부한다', () => {
  assert.throws(() => createTodo('bad@example.com', { text: '' }), TodoError)
  assert.throws(() => createTodo('bad@example.com', { text: '날짜', due: '내일' }), TodoError)
  assert.throws(() => createTodo('bad@example.com', { text: '기한 없음', type: 'dated' }), TodoError)
  assert.throws(() => createTodo('bad@example.com', { text: '시간', time: '9:00' }), TodoError)
  assert.throws(() => createTodo('bad@example.com', { text: '시간', time: '24:00' }), TodoError)
  assert.throws(() => createTodo('bad@example.com', { text: '시간', time: '12:60' }), TodoError)
  assert.throws(() => createTodo('bad@example.com', { text: '프로젝트', projects: ['../bad'] }), TodoError)
  const item = createTodo('bad@example.com', { text: '정상' })
  assert.throws(() => updateTodo('bad@example.com', item.id, { done: 'yes' as unknown as boolean }), TodoError)
})

test('listTodos: 예전 done/due 항목을 새 타입과 상태로 읽는다', () => {
  const file = path.join(dir, 'todos.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      'legacy@example.com': [
        {
          id: 'legacy-open',
          text: '오늘 항목',
          done: false,
          due: null,
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
        {
          id: 'legacy-done',
          text: '기한 항목',
          done: true,
          due: '2026-08-21',
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt: '2026-08-20T00:00:00.000Z',
        },
      ],
    }),
  )

  const items = listTodos('legacy@example.com')
  assert.equal(items[0].type, 'today')
  assert.equal(items[0].status, 'open')
  assert.equal(items[0].time, null)
  assert.equal(items[1].type, 'dated')
  assert.equal(items[1].status, 'done')
  assert.equal(items[1].time, null)
  assert.deepEqual(items[1].projects, [])
})
