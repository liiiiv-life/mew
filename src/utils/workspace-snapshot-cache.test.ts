import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceSnapshotCache } from './workspace-snapshot-cache.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('warm roots return immediately and concurrent cold reads share one request', async () => {
  const cache = new WorkspaceSnapshotCache<{ tabs: string[] }>()
  const pending = deferred<{ tabs: string[] }>()
  let reads = 0
  const read = () => { reads++; return pending.promise }
  const first = cache.load('/a', read)
  const second = cache.load('/a', read)
  assert.equal(first, second)
  assert.equal(reads, 1)
  pending.resolve({ tabs: ['README.md'] })
  await first
  assert.deepEqual(await cache.load('/a', read), { tabs: ['README.md'] })
  assert.equal(reads, 1)
  assert.equal(cache.get('/b'), undefined)
})

test('an outgoing local snapshot wins over an older in-flight server response', async () => {
  const cache = new WorkspaceSnapshotCache<{ tabs: string[] }>()
  const pending = deferred<{ tabs: string[] }>()
  const request = cache.load('/a', () => pending.promise)
  cache.set('/a', { tabs: ['new.md'] })
  pending.resolve({ tabs: ['old.md'] })
  assert.deepEqual(await request, { tabs: ['new.md'] })
  assert.deepEqual(cache.get('/a'), { tabs: ['new.md'] })
})

test('expiry, LRU, byte budget and oversized replacement stay bounded', () => {
  const cache = new WorkspaceSnapshotCache<string>(2, 60)
  cache.set('a', 'one'); cache.set('b', 'two'); cache.get('a'); cache.set('c', 'three')
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 'one')
  cache.set('a', 'x'.repeat(40))
  assert.equal(cache.get('a'), undefined, 'oversized replacement must not leave an old snapshot')
  const expired = new WorkspaceSnapshotCache<string>(2, 60, 0)
  expired.set('a', 'one')
  assert.equal(expired.get('a'), undefined)
})

test('permission/account invalidation prevents old requests from warming the new cache', async () => {
  const cache = new WorkspaceSnapshotCache<string>()
  const old = deferred<string>()
  const request = cache.load('/a', () => old.promise)
  cache.clear()
  const fresh = deferred<string>()
  const next = cache.load('/a', () => fresh.promise)
  old.resolve('old')
  await request
  assert.equal(cache.get('/a'), undefined)
  assert.equal(cache.load('/a', () => Promise.resolve('unexpected')), next)
  fresh.resolve('new')
  assert.equal(await next, 'new')
})

test('failed metadata reads can be retried', async () => {
  const cache = new WorkspaceSnapshotCache<string>()
  await assert.rejects(cache.load('/a', () => Promise.reject(new Error('offline'))), /offline/)
  assert.equal(await cache.load('/a', () => Promise.resolve('recovered')), 'recovered')
})
