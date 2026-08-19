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
  const a = createTodo('A@EXAMPLE.COM', { text: ' 첫째  항목 ', due: '2026-08-20' })
  const b = createTodo('b@example.com', { text: '남의 항목', due: null })

  assert.equal(a.text, '첫째 항목')
  assert.equal(a.due, '2026-08-20')
  assert.equal(a.done, false)
  assert.equal(listTodos('a@example.com').length, 1)
  assert.equal(listTodos('a@example.com')[0].id, a.id)
  assert.equal(listTodos('b@example.com')[0].id, b.id)
})

test('updateTodo: 본문·완료·기한을 바꾼다', () => {
  const item = createTodo('edit@example.com', { text: '고칠 항목' })
  const done = updateTodo('edit@example.com', item.id, { done: true, due: '2026-09-01' })

  assert.equal(done.done, true)
  assert.equal(done.due, '2026-09-01')

  const renamed = updateTodo('edit@example.com', item.id, { text: '바꾼 항목', due: null })
  assert.equal(renamed.text, '바꾼 항목')
  assert.equal(renamed.due, null)
})

test('deleteTodo: 자기 항목만 지운다', () => {
  const item = createTodo('delete@example.com', { text: '지울 항목' })
  assert.throws(() => deleteTodo('other@example.com', item.id), TodoError)
  deleteTodo('delete@example.com', item.id)
  assert.equal(listTodos('delete@example.com').length, 0)
})

test('validation: 빈 본문과 잘못된 기한은 거부한다', () => {
  assert.throws(() => createTodo('bad@example.com', { text: '' }), TodoError)
  assert.throws(() => createTodo('bad@example.com', { text: '날짜', due: '내일' }), TodoError)
  const item = createTodo('bad@example.com', { text: '정상' })
  assert.throws(() => updateTodo('bad@example.com', item.id, { done: 'yes' as unknown as boolean }), TodoError)
})
