import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceBreak, breakSignature, DEFAULT_BREAK_PREFERENCES, formatBreakCountdown, freshBreakProgress, parseBreakPreferences, restoreBreakProgress } from './mewcat-break-rules.ts'

const enabled = { enabled: true, workMinutes: 1, restMinutes: 2 }

test('breaks default off; both durations require whole minutes within bounds', () => {
  assert.deepEqual(parseBreakPreferences(null), { enabled: false, workMinutes: 50, restMinutes: 10 })
  assert.deepEqual(parseBreakPreferences('invalid'), DEFAULT_BREAK_PREFERENCES)
  assert.deepEqual(parseBreakPreferences('null'), DEFAULT_BREAK_PREFERENCES)
  assert.deepEqual(parseBreakPreferences('{"enabled":"true","workMinutes":0,"restMinutes":1.5}'), DEFAULT_BREAK_PREFERENCES)
  assert.deepEqual(parseBreakPreferences('{"enabled":true,"workMinutes":1439,"restMinutes":1}'), { enabled: true, workMinutes: 1439, restMinutes: 1 })
})

test('only foreground time counts; blur, sleep and clock rollback do not cause false breaks', () => {
  let progress = freshBreakProgress()
  progress = advanceBreak(progress, enabled, 1000, 1000, true)
  assert.equal(progress.usedMs, 1000)
  progress = advanceBreak(progress, enabled, 2000, 1000, false)
  assert.equal(progress.usedMs, 1000)
  progress = advanceBreak(progress, enabled, 3_602_000, 3_600_000, true)
  assert.equal(progress.usedMs, 1000)
  progress = advanceBreak(progress, enabled, 1000, -1000, true)
  assert.equal(progress.usedMs, 1000)
  assert.deepEqual(advanceBreak(progress, DEFAULT_BREAK_PREFERENCES, 2000, 1000, true), freshBreakProgress())
})

test('at the threshold rest starts once, expires while away, then starts a fresh work cycle', () => {
  const progress = advanceBreak({ usedMs: 59_000, restUntil: null }, enabled, 100_000, 1000, true)
  assert.deepEqual(progress, { usedMs: 0, restUntil: 220_000 })
  assert.deepEqual(advanceBreak(progress, enabled, 110_000, 1000, true), progress)
  assert.deepEqual(advanceBreak(progress, enabled, 219_999, 1000, false), progress)
  assert.deepEqual(advanceBreak(progress, enabled, 220_000, 1000, false), freshBreakProgress())
})

test('refresh restores active progress and rest deadline, but expired/rest-config changes reset', () => {
  const saved = JSON.stringify({ usedMs: 20_000, restUntil: null, signature: breakSignature(enabled) })
  assert.deepEqual(restoreBreakProgress(saved, enabled, 1000), { usedMs: 20_000, restUntil: null })
  const rest = JSON.stringify({ usedMs: 0, restUntil: 120_000, signature: breakSignature(enabled) })
  assert.deepEqual(restoreBreakProgress(rest, enabled, 1000), { usedMs: 0, restUntil: 120_000 })
  assert.deepEqual(restoreBreakProgress(rest, enabled, 120_000), freshBreakProgress())
  assert.deepEqual(restoreBreakProgress(rest, { ...enabled, restMinutes: 3 }, 1000), freshBreakProgress())
  assert.deepEqual(restoreBreakProgress('invalid', enabled, 1000), freshBreakProgress())
  assert.deepEqual(restoreBreakProgress(JSON.stringify({ usedMs: -10, restUntil: null, signature: breakSignature(enabled) }), enabled, 1000), freshBreakProgress())
})

test('countdown rounds up and includes hours for long breaks', () => {
  assert.equal(formatBreakCountdown(60_001), '1:01')
  assert.equal(formatBreakCountdown(3_660_000), '1:01:00')
  assert.equal(formatBreakCountdown(-1), '0:00')
})
