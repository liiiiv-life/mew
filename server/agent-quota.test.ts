import test from 'node:test'
import assert from 'node:assert/strict'
import { quotaWindows, shortestQuota } from '../shared/agent-quota.ts'

test('Codex selects shortest returned window, including weekly-only Pro and arbitrary primary ordering', () => {
  const weekly = { usedPercent: 72, windowDurationMins: 10080 }
  assert.equal(shortestQuota(quotaWindows('codex', { rateLimits: { primary: weekly } }))?.remainingPercent, 28)
  const windows = quotaWindows('codex', { rateLimits: { primary: weekly, secondary: { usedPercent: 30, windowDurationMins: 300 } }, rateLimitsByLimitId: { other: { primary: { usedPercent: 99, windowDurationMins: 1 } } } })
  assert.equal(shortestQuota(windows)?.remainingPercent, 70)
  assert.equal(shortestQuota(windows)?.windowMinutes, 300)
})

test('Kimi normalized CLI windows select 5h before weekly; zero and malformed limits stay unknown', () => {
  const windows = quotaWindows('kimi', { kind: 'ok', summary: { used: 72, limit: 100, window: { duration: 1, unit: 'week' } }, limits: [{ used: 8, limit: 10, window: { duration: 5, unit: 'hour' } }] })
  assert.equal(shortestQuota(windows)?.remainingPercent, 20)
  assert.deepEqual(quotaWindows('kimi', { kind: 'ok', limits: [{ used: 0, limit: 0, window: { duration: 5, unit: 'hour' } }] }), [])
  assert.deepEqual(quotaWindows('kimi', { kind: 'error', summary: { used: 1, limit: 10, window: { duration: 1, unit: 'week' } } }), [])
})

test('Claude structured CLI usage supports independently missing windows and does not confuse utilization units', () => {
  const windows = quotaWindows('claude', { rate_limits: { five_hour: { utilization: 0.5 }, seven_day: { utilization: 72 } } })
  assert.equal(shortestQuota(windows)?.remainingPercent, 99.5)
  assert.equal(shortestQuota(quotaWindows('claude', { rate_limits: { five_hour: null, seven_day: { utilization: 72 } } }))?.remainingPercent, 28)
})

test('unknown is distinct from empty/full; invalid fields and expired resets never invent headroom', () => {
  assert.equal(shortestQuota([]), null)
  const windows = quotaWindows('codex', { rateLimits: { primary: { usedPercent: 110, windowDurationMins: 300 }, secondary: { usedPercent: 0, windowDurationMins: 10080 } } })
  assert.equal(shortestQuota(windows)?.remainingPercent, 0)
  assert.equal(shortestQuota(quotaWindows('codex', { rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1 } } })), null)
  for (const usedPercent of [null, '72', NaN, Infinity, -1]) assert.deepEqual(quotaWindows('codex', { rateLimits: { primary: { usedPercent, windowDurationMins: 300 } } }), [])
})
