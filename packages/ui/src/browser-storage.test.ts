import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setBrowserStorageScope, remoteStorageName, scopedBrowserStorage } from './browser-storage-scope.ts'
import {
  BROWSER_CACHE_MAX_AGE_MS, BROWSER_CACHE_MAX_BYTES, BROWSER_STORAGE_TARGET_BYTES,
  BROWSER_CACHE_CHECK_INTERVAL_MS, browserStorageBytes, pruneBrowserStorage,
  startBrowserStorageMaintenance, trimInputHistory, writeBrowserStorage,
} from './browser-storage.ts'

class MemoryStorage {
  values = new Map<string, string>()
  quota = Infinity
  get length() { return this.values.size }
  key(i: number) { return [...this.values.keys()][i] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) {
    const entries = new Map(this.values).set(key, value)
    const size = [...entries].reduce((n, [k, v]) => n + browserStorageBytes(k, v), 0)
    if (size > this.quota) throw new DOMException('Full', 'QuotaExceededError')
    this.values.set(key, value)
  }
}
let storage: MemoryStorage
beforeEach(() => {
  setBrowserStorageScope()
  storage = new MemoryStorage()
  Object.assign(globalThis, { localStorage: storage })
})

test('remote server namespaces share the origin cache budget while preserving every server draft', t => {
  let now = 1_000_000
  t.mock.method(Date, 'now', () => now++)
  const drafts: string[] = [], keys: string[] = []
  try {
    for (let i = 0; i < 18; i++) {
      setBrowserStorageScope('account', `server-${i}`)
      assert.equal(writeBrowserStorage('mew:agent-input-drafts', `draft-${i}`), true)
      drafts.push(remoteStorageName('mew:agent-input-drafts'))
      keys.push(remoteStorageName('mew:content:root:file'))
      assert.equal(writeBrowserStorage('mew:content:root:file', 'x'.repeat(100_000)), true)
      assert.ok(total() < BROWSER_CACHE_MAX_BYTES + 64 * 1024)
    }
    assert.equal(storage.getItem(keys[0]), null)
    assert.ok(storage.getItem(keys.at(-1)!))
    for (let i = 0; i < drafts.length; i++) assert.equal(storage.getItem(drafts[i]), `draft-${i}`)
    assert.equal(scopedBrowserStorage().getItem('mew:agent-input-drafts'), 'draft-17')
  } finally { setBrowserStorageScope() }
})
const total = () => [...storage.values].reduce((n, [k, v]) => n + browserStorageBytes(k, v), 0)

test('startup removes undated legacy caches, preserves drafts, settings, fallback tabs and unrelated keys', () => {
  const keep = ['mew:agent-input-drafts', 'mew:tmux-input-drafts', 'mew:theme', 'mew:open-tabs', 'mew:agent-tabs:/root', 'foreign:cache']
  for (const key of keep) storage.setItem(key, 'irreplaceable')
  for (const key of ['mew:content:old:file.md', 'mew:tree-children:old', 'mew:agent-controls:old', 'mew:agent-input-histories']) storage.setItem(key, '{}')
  const result = pruneBrowserStorage()
  assert.equal(result.removed, 4)
  assert.deepEqual([...storage.values.keys()], keep)
  assert.equal(result.remainingBytes, total())
})

test('all roots and cache kinds share a byte budget, evicting oldest first', (t) => {
  let now = 1_000_000
  t.mock.method(Date, 'now', () => now++)
  for (let i = 0; i < 18; i++) {
    const key = i % 2 ? `mew:content:root-${i}:file.md` : `mew:tree-children:root-${i}`
    assert.equal(writeBrowserStorage(key, '한'.repeat(100_000)), true)
    assert.ok(total() < BROWSER_CACHE_MAX_BYTES + 64 * 1024)
  }
  assert.equal(storage.getItem('mew:tree-children:root-0'), null)
  assert.ok(storage.getItem('mew:content:root-17:file.md'))
})

test('expiration keeps recent caches and drops old ones, including legacy event timestamps', (t) => {
  const now = Date.now()
  t.mock.method(Date, 'now', () => now)
  writeBrowserStorage('mew:content:recent:file.md', 'recent')
  storage.setItem('mew:agent-events:old', JSON.stringify({ savedAt: now - BROWSER_CACHE_MAX_AGE_MS, events: [] }))
  storage.setItem('mew:agent-events:recent', JSON.stringify({ savedAt: now - 1, events: [] }))
  pruneBrowserStorage({ now })
  assert.equal(storage.getItem('mew:agent-events:old'), null)
  assert.ok(storage.getItem('mew:agent-events:recent'))
  pruneBrowserStorage({ now: now + BROWSER_CACHE_MAX_AGE_MS })
  assert.equal(storage.getItem('mew:content:recent:file.md'), null)
  assert.equal(storage.getItem('mew:cache-times:v1'), null)
})

test('quota failure reclaims caches and retries important state without losing the draft', () => {
  writeBrowserStorage('mew:content:root:file.md', 'x'.repeat(10_000))
  writeBrowserStorage('mew:agent-input-drafts', 'unsent draft')
  storage.quota = total() + 10
  assert.equal(writeBrowserStorage('mew:open-tabs', 'tab state'.repeat(500)), true)
  assert.equal(storage.getItem('mew:content:root:file.md'), null)
  assert.equal(storage.getItem('mew:agent-input-drafts'), 'unsent draft')
  assert.ok(storage.getItem('mew:open-tabs'))
})

test('oversized cache replacement removes the stale version; settings can occupy the remaining space', () => {
  writeBrowserStorage('mew:content:root:file.md', 'old')
  assert.equal(writeBrowserStorage('mew:content:root:file.md', 'x'.repeat(256 * 1024)), false)
  assert.equal(storage.getItem('mew:content:root:file.md'), null)
  storage.setItem('mew:agent-input-drafts', 'x'.repeat(BROWSER_STORAGE_TARGET_BYTES / 2))
  assert.equal(writeBrowserStorage('mew:content:root:other.md', 'cache'), false)
  assert.ok(storage.getItem('mew:agent-input-drafts'))
})

test('cache replacement reserves only the new size and never deletes unrelated data', () => {
  for (let i = 0; i < 8; i++) writeBrowserStorage(`mew:content:root:${i}`, 'x'.repeat(100_000))
  writeBrowserStorage('mew:content:root:7', 'new')
  assert.ok(storage.getItem('mew:content:root:0'))
  assert.equal(storage.getItem('mew:content:root:7'), 'new')
})

test('sent histories keep whole recent inputs within 128KiB while skipping huge entries', () => {
  const original = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`tab-${i}`, ['x'.repeat(20_000), ...Array.from({ length: 100 }, (_, j) => `input-${j} ${'y'.repeat(100)}`)]]))
  const trimmed = trimInputHistory(original)
  assert.ok(JSON.stringify(trimmed).length * 2 <= 128 * 1024)
  assert.equal(trimmed['tab-39'].at(-1), original['tab-39'].at(-1))
  assert.ok(Object.values(trimmed).every((items) => items.length <= 100 && items.every((item) => item.length < 20_000)))
  assert.equal(original['tab-0'][0].length, 20_000, 'input data is not mutated')
  assert.deepEqual(trimInputHistory({ tab: ['keep', 'x'.repeat(20_000)] }), { tab: ['keep'] })
})

test('unavailable storage never throws or clears unrelated state', () => {
  storage.setItem = () => { throw new DOMException('Blocked', 'SecurityError') }
  assert.equal(writeBrowserStorage('mew:agent-input-drafts', 'draft'), false)
  storage.getItem = () => { throw new DOMException('Blocked', 'SecurityError') }
  assert.doesNotThrow(() => pruneBrowserStorage())
})

test('startup, periodic checks, visibility changes and pagehide clean caches; disposal removes listeners', () => {
  const win = new EventTarget()
  const doc = new EventTarget()
  let interval: (() => void) | undefined
  let cleared = false
  Object.assign(win, {
    setInterval: (fn: () => void, ms: number) => { assert.equal(ms, BROWSER_CACHE_CHECK_INTERVAL_MS); interval = fn; return 7 },
    clearInterval: (id: number) => { assert.equal(id, 7); cleared = true },
  })
  Object.assign(globalThis, { window: win, document: doc })
  const key = 'mew:content:legacy:file.md'
  storage.setItem(key, '{}')
  const stop = startBrowserStorageMaintenance()
  assert.equal(storage.getItem(key), null)
  for (const run of [() => interval!(), () => doc.dispatchEvent(new Event('visibilitychange')), () => win.dispatchEvent(new Event('pagehide'))]) {
    storage.setItem(key, '{}')
    run()
    assert.equal(storage.getItem(key), null)
  }
  stop()
  assert.equal(cleared, true)
  storage.setItem(key, '{}')
  win.dispatchEvent(new Event('pagehide'))
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(storage.getItem(key), '{}')
})
