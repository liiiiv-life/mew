import assert from 'node:assert/strict'
import test from 'node:test'
import { prefixMatch } from './fuzzy.ts'

test('prefixMatch — 대소문자를 무시하고 문자열 시작만 자동완성 후보로 삼는다', () => {
  assert.equal(prefixMatch('m', 'med-app'), true)
  assert.equal(prefixMatch('MED', 'med-app'), true)
  assert.equal(prefixMatch('m', 'alaaaarm'), false)
  assert.equal(prefixMatch('abc', 'gantt-abc-maker'), false)
})
