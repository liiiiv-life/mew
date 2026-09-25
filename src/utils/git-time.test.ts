import test from 'node:test'
import assert from 'node:assert/strict'
import { relativeCommitTime } from './git-time.ts'

test('commit time uses only the largest whole unit, including zero minutes', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')
  for (const [minutes, expected] of [[0, '0분 전'], [0.9, '0분 전'], [59, '59분 전'], [60, '1시간 전'], [119, '1시간 전'], [1439, '23시간 전'], [1440, '1일 전'], [2941, '2일 전']] as const) {
    assert.equal(relativeCommitTime(new Date(now - minutes * 60_000).toISOString(), now), expected)
  }
  assert.equal(relativeCommitTime(new Date(now + 60_000).toISOString(), now), '0분 전')
  assert.equal(relativeCommitTime('invalid', now), '—')
})
