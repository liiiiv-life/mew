import test from 'node:test'
import assert from 'node:assert/strict'
import { createNetworkUsageStore, desktopUsageReporter } from './network-usage.ts'
import { networkCategory, requestBodyBytes } from './network-tracking.ts'

test('remote sessions accumulate alongside other traffic without resetting or double counting', () => {
  const store = createNetworkUsageStore(), first = desktopUsageReporter(store)
  store.add('other', 'received', 300)
  store.add('other', 'sent', 20)
  first({ received: 1000, sent: 50 }); first({ received: 1000, sent: 50 })
  first({ received: 1200, sent: 60 })
  desktopUsageReporter(store)({ received: 200, sent: 10 })
  assert.deepEqual(store.getSnapshot().desktop, { received: 1400, sent: 70 })
  assert.deepEqual(store.getSnapshot().other, { received: 300, sent: 20 })
  assert.deepEqual(createNetworkUsageStore().getSnapshot().desktop, { received: 0, sent: 0 })
})

test('published snapshots are immutable and updates notify at most once per second', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const store = createNetworkUsageStore(), before = store.getSnapshot()
  let updates = 0
  const unsubscribe = store.subscribe(() => updates++)
  for (let i = 0; i < 100; i++) store.add('other', 'received', 10)
  for (const value of [-10, 0, NaN, Infinity]) store.add('desktop', 'sent', value)
  assert.equal(before.other.received, 0)
  assert.equal(store.getSnapshot().other.received, 1000)
  assert.equal(updates, 0)
  context.mock.timers.tick(1000)
  assert.equal(updates, 1)
  unsubscribe(); store.add('other', 'received', 5)
  context.mock.timers.tick(1000)
  assert.equal(updates, 1)
})

test('request sizes honor UTF-8, binary views, blobs, URL encoding and form fields', () => {
  assert.equal(requestBodyBytes('한글'), 6)
  assert.equal(requestBodyBytes(new Uint8Array(new ArrayBuffer(20), 4, 3)), 3)
  assert.equal(requestBodyBytes(new Blob(['한글'])), 6)
  assert.equal(requestBodyBytes(new URLSearchParams({ a: '한글' })), 20)
  const form = new FormData(); form.append('file', new Blob(['abc'])); form.append('name', '한글')
  assert.equal(requestBodyBytes(form), 17)
  assert.equal(requestBodyBytes(undefined), 0)
  assert.equal(requestBodyBytes(new ReadableStream()), 0, 'unknown stream size is not guessed or consumed')
  assert.equal(networkCategory(new URL('https://mew.test/api/remote-desktop/status')), 'desktop')
  assert.equal(networkCategory(new URL('https://mew.test/api/collab')), 'other')
})


test('rates use each direction and actual elapsed time, then return to zero while totals stay', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let time = 0
  const store = createNetworkUsageStore(() => time)
  const unsubscribe = store.subscribe(() => {})
  store.add('desktop', 'sent', 500)
  store.add('desktop', 'received', 2000)
  store.add('other', 'sent', 100)
  store.add('other', 'received', 400)
  time = 2000
  context.mock.timers.tick(1000)
  const active = store.getSnapshot()
  assert.deepEqual(active.rate, { desktop: { sent: 250, received: 1000 }, other: { sent: 50, received: 200 } })
  time = 3000
  context.mock.timers.tick(1000)
  assert.deepEqual(store.getSnapshot().rate, { desktop: { sent: 0, received: 0 }, other: { sent: 0, received: 0 } })
  assert.deepEqual(store.getSnapshot().desktop, { sent: 500, received: 2000 })
  assert.equal(active.rate.desktop.received, 1000, 'published rate snapshots stay immutable')
  unsubscribe()
  store.add('other', 'sent', 900)
  time = 10000
  const resubscribed = store.subscribe(() => {})
  store.add('other', 'sent', 200)
  time = 11000
  context.mock.timers.tick(1000)
  assert.equal(store.getSnapshot().rate.other.sent, 200, 'resubscribing excludes old traffic from current speed')
  resubscribed()
})
