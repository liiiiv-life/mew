import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentWorkLoader, type AgentWorkRequest } from './agent-work-loader.ts'
import type { AgentEvent } from './agentFold.ts'

function events(start: number, end: number): AgentEvent[] {
  return Array.from({ length: end - start }, (_, i) => ({ type: 'error', message: String(start + i) }))
}

function harness(concurrency?: number) {
  const sent: AgentWorkRequest[] = []
  const loader = new AgentWorkLoader({ send: request => { sent.push(request) }, concurrency })
  const respond = (request: AgentWorkRequest, end = request.end) => loader.accept({ ...request, end, events: events(request.start, end) })
  return { loader, sent, respond }
}

test('chunks are bounded, at most two requests run, and out-of-order replies retain event order', async () => {
  const { loader, sent, respond } = harness(10)
  const result = loader.request('generation', 100, 900)
  assert.deepEqual(sent.map(({ start, end }) => [start, end]), [[100, 356], [356, 612]])
  respond(sent[1])
  assert.deepEqual(sent.map(({ start, end }) => [start, end]), [[100, 356], [356, 612], [612, 868]])
  respond(sent[2])
  respond(sent[3])
  respond(sent[0])
  assert.deepEqual(await result, events(100, 900))
  assert.ok(sent.every(request => request.end - request.start <= 256))
  loader.dispose()
})

test('identical pending and completed ranges share their promise and chunks share requests', async () => {
  const { loader, sent, respond } = harness()
  const result = loader.request('generation', 0, 600)
  assert.equal(loader.request('generation', 0, 600), result)
  const middle = loader.request('generation', 256, 512)
  assert.equal(sent.length, 2)
  respond(sent[1])
  assert.deepEqual(await middle, events(256, 512))
  respond(sent[2])
  respond(sent[0])
  assert.deepEqual(await result, events(0, 600))
  assert.equal(loader.request('generation', 0, 600), result)
  assert.deepEqual(await loader.request('generation', 0, 256), events(0, 256))
  assert.equal(sent.length, 3)
  assert.deepEqual(await loader.request('generation', 600, 600), [])
  assert.equal(sent.length, 3)
  loader.dispose()
})

test('opening details promotes queued background chunks without exceeding the concurrency limit', async () => {
  const { loader, sent, respond } = harness(1)
  const background = loader.request('generation', 0, 1024)
  const promoted = loader.request('generation', 768, 1024, { priority: true })
  const foreground = loader.request('generation', 2000, 2001, { priority: true })
  assert.equal(sent.length, 1)
  respond(sent[0])
  assert.equal(sent[1].start, 768)
  respond(sent[1])
  assert.deepEqual(await promoted, events(768, 1024))
  assert.equal(sent[2].start, 2000)
  respond(sent[2])
  await foreground
  assert.equal(sent[3].start, 256)
  respond(sent[3])
  respond(sent[4])
  await background
  loader.dispose()
})

test('promoting the exact original range also promotes all remaining chunks', async () => {
  const { loader, sent, respond } = harness(1)
  const first = loader.request('generation', 0, 1)
  const other = loader.request('generation', 100, 101)
  const target = loader.request('generation', 200, 800)
  assert.equal(loader.request('generation', 200, 800, { priority: true }), target)
  respond(sent[0])
  assert.equal(sent[1].start, 200)
  respond(sent[1])
  assert.equal(sent[2].start, 456)
  respond(sent[2])
  assert.equal(sent[3].start, 712)
  respond(sent[3])
  assert.equal(sent[4].start, 100)
  respond(sent[4])
  await Promise.all([first, other, target])
  loader.dispose()
})

test('pause accepts active replies and retains cached work while queued and new priority work wait for resume', async () => {
  const { loader, sent, respond } = harness()
  const background = loader.request('generation', 0, 768)
  assert.equal(sent.length, 2)
  loader.setPaused(true)
  const foreground = loader.request('generation', 1000, 1001, { priority: true })
  respond(sent[0])
  respond(sent[1])
  assert.equal(sent.length, 2, 'neither active completion nor a priority request starts queued work while paused')
  assert.deepEqual(await loader.request('generation', 0, 256), events(0, 256), 'cached responses remain usable')
  loader.setPaused(false)
  assert.equal(sent.length, 4)
  assert.equal(sent[2].start, 1000, 'priority is preserved across a pause')
  assert.equal(sent[3].start, 512)
  respond(sent[2])
  respond(sent[3])
  assert.deepEqual(await background, events(0, 768))
  await foreground
  loader.dispose()
})

test('active timeouts still reject during a pause while queued work and manual retries wait', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { loader, sent, respond } = harness(1)
  const active = loader.request('generation', 0, 1)
  const rejection = assert.rejects(active, /timed out/)
  const queued = loader.request('generation', 10, 11)
  loader.setPaused(true)
  t.mock.timers.tick(10_000)
  await rejection
  const retry = loader.request('generation', 0, 1, { priority: true })
  assert.equal(sent.length, 1)
  assert.equal(respond(sent[0]), false)
  loader.setPaused(false)
  assert.equal(sent[1].start, 0)
  respond(sent[1])
  assert.equal(sent[2].start, 10)
  respond(sent[2])
  await Promise.all([queued, retry])
  loader.dispose()
})

test('a partial active response waits until resume before sending its continuation', async () => {
  const { loader, sent, respond } = harness()
  const result = loader.request('generation', 0, 4)
  loader.setPaused(true)
  respond(sent[0], 2)
  assert.equal(sent.length, 1)
  loader.setPaused(false)
  assert.deepEqual([sent[1].start, sent[1].end], [2, 4])
  respond(sent[1])
  assert.deepEqual(await result, events(0, 4))
  loader.dispose()
})

test('partial responses continue with a fresh request ID and resolve only when the full range arrives', async () => {
  const { loader, sent, respond } = harness(1)
  const result = loader.request('generation', 0, 4, { priority: true })
  let settled = false
  void result.then(() => { settled = true })
  const background = loader.request('generation', 10, 11)
  respond(sent[0], 2)
  assert.deepEqual([sent[1].start, sent[1].end], [2, 4])
  assert.notEqual(sent[1].requestId, sent[0].requestId)
  assert.equal(respond(sent[0]), false, 'a duplicated partial response cannot append twice')
  await Promise.resolve()
  assert.equal(settled, false)
  respond(sent[1], 3)
  assert.deepEqual([sent[2].start, sent[2].end], [3, 4])
  respond(sent[2])
  assert.deepEqual(await result, events(0, 4))
  assert.equal(sent[3].start, 10)
  respond(sent[3])
  await background
  loader.dispose()
})

test('errors are not cached and a caller can retry immediately after a failed reply', async () => {
  const { loader, sent, respond } = harness(1)
  const original = loader.request('generation', 0, 2)
  const rejection = assert.rejects(original, /server failure/)
  assert.equal(loader.accept({ ...sent[0], error: 'server failure' }), true)
  const retry = loader.request('generation', 0, 2)
  assert.notEqual(retry, original)
  assert.equal(sent.length, 2)
  respond(sent[1])
  await rejection
  assert.deepEqual(await retry, events(0, 2))
  loader.dispose()
})

test('mismatched generation, start, end, missing events and event length reject and allow retry', async () => {
  const { loader, sent, respond } = harness()
  const invalid = [
    { generation: 'stale' },
    { start: 1 },
    { end: 3 },
    { end: 0, events: [] },
    { end: 1.5 },
    { events: undefined },
    { events: [] },
  ]
  for (const patch of invalid) {
    const result = loader.request('generation', 0, 2)
    const rejection = assert.rejects(result, /Invalid agent work response/)
    const request = sent.at(-1)!
    assert.equal(loader.accept({ ...request, events: events(0, 2), ...patch }), true)
    await rejection
  }
  const retry = loader.request('generation', 0, 2)
  respond(sent.at(-1)!)
  await retry
  loader.dispose()
})

test('partial results are discarded when a continuation fails', async () => {
  const { loader, sent, respond } = harness()
  const result = loader.request('generation', 0, 4)
  const rejection = assert.rejects(result, /failed/)
  respond(sent[0], 2)
  loader.accept({ ...sent[1], error: 'failed' })
  const retry = loader.request('generation', 0, 4)
  assert.equal(sent[2].start, 0)
  respond(sent[2])
  await rejection
  assert.deepEqual(await retry, events(0, 4))
  loader.dispose()
})

test('reset rejects active and queued work, clears caches, and ignores stale replies even for the same generation', async () => {
  const { loader, sent, respond } = harness(1)
  const cached = loader.request('generation', 1000, 1001)
  respond(sent[0])
  await cached
  const result = loader.request('generation', 0, 600)
  const rejection = assert.rejects(result, /reset/)
  const stale = sent[1]
  loader.reset('generation')
  const retry = loader.request('generation', 0, 600)
  assert.equal(respond(stale), false)
  assert.notEqual(sent[2].requestId, stale.requestId)
  respond(sent[2])
  respond(sent[3])
  respond(sent[4])
  await rejection
  await retry
  const refreshed = loader.request('generation', 1000, 1001)
  assert.equal(sent.length, 6, 'reset removed the previously completed range')
  respond(sent[5])
  await refreshed
  loader.reset('new-generation')
  await assert.rejects(loader.request('generation', 0, 1), /generation changed/)
  const next = loader.request('new-generation', 0, 1)
  respond(sent[6])
  await next
  loader.dispose()
})

test('timeout reclaims the slot, ignores the late reply and allows a fresh manual retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { loader, sent, respond } = harness(1)
  const result = loader.request('generation', 0, 1)
  const rejection = assert.rejects(result, /timed out/)
  const queued = loader.request('generation', 10, 11)
  t.mock.timers.tick(9999)
  assert.equal(sent.length, 1)
  t.mock.timers.tick(1)
  assert.equal(sent.length, 2)
  assert.equal(respond(sent[0]), false)
  respond(sent[1])
  const retry = loader.request('generation', 0, 1)
  assert.equal(sent.length, 3)
  respond(sent[2])
  await rejection
  await queued
  await retry
  loader.dispose()
})

test('reset also rejects a range whose last response has not yet reached its promise listener', async () => {
  const { loader, sent, respond } = harness()
  const result = loader.request('generation', 0, 1)
  const rejection = assert.rejects(result, /reset/)
  respond(sent[0])
  loader.reset('generation')
  await rejection
  loader.dispose()
})

test('dispose clears timers and queued requests and permanently rejects new requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { loader, sent, respond } = harness(1)
  const result = loader.request('generation', 0, 600)
  const rejection = assert.rejects(result, /reset/)
  loader.dispose()
  t.mock.timers.tick(20_000)
  assert.equal(sent.length, 1)
  assert.equal(respond(sent[0]), false)
  await rejection
  await assert.rejects(loader.request('generation', 0, 1), /disposed/)
})

test('synchronous socket send failures release slots and do not leave rejected listeners', async () => {
  let fail = true
  let loader!: AgentWorkLoader
  loader = new AgentWorkLoader({ send: request => {
    if (fail) throw new Error('Socket closed')
    loader.accept({ ...request, events: events(request.start, request.end) })
  } })
  await assert.rejects(loader.request('generation', 0, 600), /Socket closed/)
  fail = false
  assert.deepEqual(await loader.request('generation', 0, 600), events(0, 600))
  loader.dispose()
})

test('large requested ranges assemble without spreading their events onto the call stack', async () => {
  let loader!: AgentWorkLoader
  loader = new AgentWorkLoader({ send: request => {
    loader.accept({ ...request, events: events(request.start, request.end) })
  } })
  const result = await loader.request('generation', 0, 150_000)
  assert.equal(result.length, 150_000)
  assert.deepEqual(result[0], events(0, 1)[0])
  assert.deepEqual(result.at(-1), events(149_999, 150_000)[0])
  loader.dispose()
})

test('invalid inputs never send a request', async () => {
  const { loader, sent } = harness()
  for (const [generation, start, end] of [['', 0, 1], ['generation', -1, 1], ['generation', 2, 1],
    ['generation', 0.5, 1], ['generation', 0, Number.POSITIVE_INFINITY]] as const) {
    await assert.rejects(loader.request(generation, start, end), /Invalid agent work range/)
  }
  assert.equal(sent.length, 0)
  loader.dispose()
})
