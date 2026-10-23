import assert from 'node:assert/strict'
import test from 'node:test'
import { needsMewUpdate, parseAheadBehind } from './mewUpdate.ts'

test('Git left-right count를 로컬 ahead와 origin/main behind로 읽는다', () => {
  assert.deepEqual(parseAheadBehind('2\t5\n'), { ahead: 2, behind: 5 })
})

test('잘못된 Git 비교 결과는 업데이트 가능으로 오인하지 않는다', () => {
  assert.throws(() => parseAheadBehind('not-a-count'), /읽지 못했습니다/)
  assert.throws(() => parseAheadBehind('-1 2'), /읽지 못했습니다/)
})

test('pull 뒤 빌드 실패는 Git이 최신이어도 재시도할 수 있다', () => {
  const job = { state: 'failed' as const, startedAt: 1, finishedAt: 2, message: 'build failed' }
  assert.equal(needsMewUpdate(false, job), true)
  assert.equal(needsMewUpdate(false, { ...job, state: 'succeeded' }), false)
  assert.equal(needsMewUpdate(false, null), false)
  assert.equal(needsMewUpdate(true, null), true)
})
