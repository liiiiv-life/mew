import assert from 'node:assert/strict'
import test from 'node:test'
import { nextLocalMinuteValue } from './scheduleTime.ts'

test('예약 가능 최솟값은 현재 분을 제외한 바로 다음 로컬 분이다', () => {
  assert.equal(nextLocalMinuteValue(new Date(2026, 8, 7, 22, 42, 0).getTime()), '2026-09-07T22:43')
  assert.equal(nextLocalMinuteValue(new Date(2026, 8, 7, 22, 42, 59).getTime()), '2026-09-07T22:43')
})

test('다음 분 계산은 날짜 경계를 넘는다', () => {
  assert.equal(nextLocalMinuteValue(new Date(2026, 11, 31, 23, 59, 59).getTime()), '2027-01-01T00:00')
})
