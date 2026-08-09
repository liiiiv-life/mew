// GUI 형태 ↔ 크론식 왕복 — 여기가 깨지면 저장할 때마다 사용자가 고른 시각이 조용히 바뀐다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { describeSchedule, fromCron, toCron, type Schedule } from './cron.ts'

const cases: Schedule[] = [
  { kind: 'daily', time: '02:00' },
  { kind: 'daily', time: '23:45' },
  { kind: 'weekly', time: '09:30', days: [1, 3, 5] },
  { kind: 'hourly', minute: 15 },
  { kind: 'interval', minutes: 10 },
  { kind: 'custom', expr: '0 0 1 * *' },
]

test('형태 → 크론식 → 형태 왕복이 같은 값이다', () => {
  for (const s of cases) {
    assert.deepEqual(fromCron(toCron(s)), s, `왕복 실패: ${JSON.stringify(s)}`)
  }
})

test('표현할 수 없는 식은 custom으로 떨어진다', () => {
  for (const expr of ['0 2 1 * *', '0 2 * * MON-FRI', '이상한 값']) {
    assert.equal(fromCron(expr).kind, 'custom')
  }
})

test('요일 7(=일)은 0으로 정규화된다', () => {
  assert.deepEqual(fromCron('0 9 * * 7'), { kind: 'weekly', time: '09:00', days: [0] })
})

test('설명 문구', () => {
  assert.equal(describeSchedule('0 2 * * *'), '매일 02:00')
  assert.equal(describeSchedule('*/5 * * * *'), '5분마다')
})
