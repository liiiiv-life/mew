import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
// @ts-expect-error Native helper JavaScript owns shutdown ordering.
import { shutdownNativeHost } from '../native/remote-desktop/host-shutdown.mjs'

function fixture() {
  const calls: string[] = []
  const worker = Object.assign(new EventEmitter(), {
    threadId: 1,
    postMessage() { calls.push('worker-close'); setImmediate(() => worker.emit('exit')) },
    async terminate() { calls.push('terminate') },
  })
  return { calls, worker, platform: { close() { calls.push('platform-close') } }, parent: { input: { destroy() { calls.push('input-close') } }, output: { destroy() { calls.push('output-close') } } }, rtc: { cleanup() { calls.push('rtc-close') } } }
}

test('native shutdown waits for capture and NAT deletion beyond the former 500ms deadline before releasing RTC', async () => {
  const value = fixture()
  await shutdownNativeHost({ ...value, stop: async () => { await delay(650); value.calls.push('nat-deleted') } })
  assert.deepEqual(value.calls, ['nat-deleted', 'worker-close', 'terminate', 'platform-close', 'input-close', 'output-close', 'rtc-close'])
})

test('unresponsive cleanup is bounded and a platform shutdown error cannot retain parent channels', async () => {
  const value = fixture()
  const start = performance.now()
  await shutdownNativeHost({ ...value, cleanupMs: 20, stop: () => new Promise(() => {}), platform: { close() { throw new Error('fixture') } } })
  assert.ok(performance.now() - start < 500)
  assert.deepEqual(value.calls, ['worker-close', 'terminate', 'input-close', 'output-close', 'rtc-close'])
})
