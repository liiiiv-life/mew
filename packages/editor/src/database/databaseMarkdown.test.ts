import test from 'node:test'
import assert from 'node:assert/strict'
import { isDbId, databaseMarkdown, parseDbId, parseReadonly } from './databaseMarkdown.ts'

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

test('isDbId는 uuid만 통과시킨다', () => {
  assert.equal(isDbId(UUID), true)
  assert.equal(isDbId('not-a-uuid'), false)
  assert.equal(isDbId(''), false)
  assert.equal(isDbId(null), false)
  assert.equal(isDbId(123), false)
})

test('databaseMarkdown ↔ parseDbId 라운드트립', () => {
  const md = databaseMarkdown(UUID)
  assert.equal(md, `<div data-mew-db="${UUID}"></div>`)
  const attr = /data-mew-db="([^"]*)"/.exec(md)?.[1]
  assert.equal(parseDbId(attr), UUID)
})

test('parseDbId는 잘못된 값에 null', () => {
  assert.equal(parseDbId(null), null)
  assert.equal(parseDbId(undefined), null)
  assert.equal(parseDbId('drop table'), null)
})

test('readonly 참조 마크다운 라운드트립', () => {
  const md = databaseMarkdown(UUID, true)
  assert.equal(md, `<div data-mew-db="${UUID}" data-mew-db-readonly="true"></div>`)
  const ro = /data-mew-db-readonly="([^"]*)"/.exec(md)?.[1]
  assert.equal(parseReadonly(ro), true)
  // 일반(편집형) 노드에는 속성이 없다
  assert.equal(databaseMarkdown(UUID), `<div data-mew-db="${UUID}"></div>`)
  assert.equal(parseReadonly(null), false)
})
