// 순수 단위 테스트 — DB 불필요. 식별자 검증/쿼팅이 SQL 인젝션을 막는지 확인한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertIdent,
  quoteIdent,
  quoteVerifiedIdent,
  projectSchema,
  newTableName,
  newColumnName,
  InvalidIdentifierError,
} from './identifiers.ts'

test('assertIdent은 올바른 식별자를 통과시킨다', () => {
  assert.equal(assertIdent('abc'), 'abc')
  assert.equal(assertIdent('_x1'), '_x1')
  assert.equal(assertIdent('mew_docs'), 'mew_docs')
})

test('assertIdent은 인젝션/부적절한 식별자를 거부한다', () => {
  const bad = ['a b', 'a;b', '1abc', 'ABC', 'a"b', 'a-b', 'a.b', '', 'a'.repeat(64), 'drop table', '"; DROP TABLE x; --']
  for (const name of bad) {
    assert.throws(() => assertIdent(name), InvalidIdentifierError, `거부해야 함: ${name}`)
  }
})

test('quoteIdent은 검증 후 큰따옴표로 감싼다', () => {
  assert.equal(quoteIdent('foo'), '"foo"')
  assert.throws(() => quoteIdent('foo bar'), InvalidIdentifierError)
})

test('quoteVerifiedIdent은 큰따옴표를 이스케이프한다', () => {
  assert.equal(quoteVerifiedIdent('Foo'), '"Foo"')
  assert.equal(quoteVerifiedIdent('weird"name'), '"weird""name"')
  assert.throws(() => quoteVerifiedIdent('has space'), InvalidIdentifierError)
})

test('projectSchema는 프로젝트명을 안전한 스키마명으로 변환한다', () => {
  assert.equal(projectSchema('docs'), 'mew_docs')
  assert.equal(projectSchema('My.Proj-1'), 'mew_my_proj_1')
})

test('newTableName/newColumnName은 규칙에 맞는 식별자를 만든다', () => {
  assert.match(newTableName(), /^db_[0-9a-f]{32}$/)
  assert.match(newColumnName(), /^c_[0-9a-f]{16}$/)
  assert.doesNotThrow(() => assertIdent(newTableName()))
  assert.doesNotThrow(() => assertIdent(newColumnName()))
})
