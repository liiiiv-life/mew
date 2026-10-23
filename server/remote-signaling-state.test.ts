import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { RemoteSignalingState, type SignalBrowser, type SignalInstance, type SignalStorage, type SignalSqlValue } from '../shared/remote-signaling-state.ts'

const instance: SignalInstance = { id: 'host-a', owner: 'owner-a', name: 'laptop', publicKey: '{"kty":"OKP"}', revoked: 0 }
const browser: SignalBrowser = { id: 'browser-a', label: 'Chrome', createdAt: 10, lastSeen: 20, revoked: 0 }

function fixture(t: test.TestContext) {
  const database = new DatabaseSync(':memory:')
  t.after(() => database.close())
  let failQuery: ((query: string) => boolean) | undefined
  const storage: SignalStorage = {
    sql: {
      exec<T extends Record<string, SignalSqlValue>>(query: string, ...bindings: SignalSqlValue[]) {
        if (failQuery?.(query)) throw new Error('fixture-storage-failure')
        const rows = database.prepare(query).all(...bindings) as T[]
        return { toArray: () => rows.map(row => ({ ...row })) }
      },
    },
    transactionSync<T>(callback: () => T): T {
      database.exec('BEGIN')
      try {
        const result = callback()
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { storage, state: new RemoteSignalingState(storage), fail: (predicate?: (query: string) => boolean) => { failQuery = predicate } }
}

test('signaling authority seeds once and restores instances and browser registry from the same SQLite database', t => {
  const { state, storage } = fixture(t)
  assert.equal(state.initialized(instance.id), false)
  assert.equal(state.instance(instance.id), null)
  state.seed(instance, [browser])
  assert.equal(state.initialized(instance.id), true)
  assert.deepEqual(state.instance(instance.id), instance)
  assert.deepEqual(state.browsers(instance.id), [browser])
  const restored = new RemoteSignalingState(storage)
  assert.deepEqual(restored.instance(instance.id), instance)
  assert.deepEqual(restored.browsers(instance.id), [browser])
  restored.seed({ ...instance, owner: 'stale-owner', publicKey: 'stale-key' }, [{ ...browser, label: 'Stale label', lastSeen: 5 }])
  assert.deepEqual(restored.instance(instance.id), instance)
  assert.deepEqual(restored.browsers(instance.id), [browser])
})

test('revocation before seed and later active snapshots cannot resurrect an instance or browser', t => {
  const { state, storage } = fixture(t)
  state.revokeInstance(instance.id)
  state.revokeBrowser(instance.id, browser.id, 30)
  assert.equal(state.initialized(instance.id), false)
  state.seed(instance, [browser])
  assert.equal(state.initialized(instance.id), true)
  assert.equal(state.instance(instance.id), null)
  assert.equal(state.browserRevoked(instance.id, browser.id), true)
  assert.equal(state.trustBrowser(instance.id, browser.id, 'Late trust'), false)
  state.mergeRevocations(instance.id, true, [browser])
  state.seed(instance, [browser])
  const restored = new RemoteSignalingState(storage)
  assert.equal(restored.initialized(instance.id), true)
  assert.equal(restored.instance(instance.id), null)
  assert.equal(restored.browserRevoked(instance.id, browser.id), true)
})

test('a pending browser revocation survives initial import without revoking other browsers or instances', t => {
  const { state } = fixture(t)
  state.revokeBrowser(instance.id, browser.id, 30)
  state.seed(instance, [browser, { ...browser, id: 'browser-b' }])
  const other = { ...instance, id: 'host-b' }
  state.seed(other, [browser])
  assert.deepEqual(state.instance(instance.id), instance)
  assert.equal(state.browserRevoked(instance.id, browser.id), true)
  assert.equal(state.trustBrowser(instance.id, browser.id, 'Late trust', 40), false)
  assert.equal(state.trustBrowser(instance.id, 'browser-b', 'Other browser', 40), true)
  assert.equal(state.browserRevoked(other.id, browser.id), false)
  assert.equal(state.trustBrowser(other.id, browser.id, 'Other host', 50), true)
  state.revokeInstance(instance.id)
  assert.deepEqual(state.instance(other.id), other)
  assert.equal(state.trustBrowser(other.id, browser.id, 'Still active', 60), true)
})

test('trust registration sanitizes labels, preserves creation time, and never moves lastSeen backwards', t => {
  const { state } = fixture(t)
  assert.equal(state.trustBrowser(instance.id, browser.id, 'Unknown host', 1), false)
  state.seed(instance, [])
  assert.equal(state.trustBrowser(instance.id, browser.id, '\u0000  Chrome\n · Linux\u007f  ', 100), true)
  assert.deepEqual(state.browsers(instance.id), [{ id: browser.id, label: 'Chrome · Linux', createdAt: 100, lastSeen: 100, revoked: 0 }])
  assert.equal(state.trustBrowser(instance.id, browser.id, 'Updated', 200), true)
  assert.equal(state.trustBrowser(instance.id, browser.id, 'Older clock', 150), true)
  assert.deepEqual(state.browsers(instance.id), [{ id: browser.id, label: 'Older clock', createdAt: 100, lastSeen: 200, revoked: 0 }])
  state.trustBrowser(instance.id, 'empty-label', '\n\u0000 ', 250)
  state.trustBrowser(instance.id, 'long-label', 'x'.repeat(130), 250)
  assert.deepEqual(state.browsers(instance.id).map(value => [value.id, value.label]), [
    ['empty-label', 'Browser'], ['long-label', 'x'.repeat(120)], [browser.id, 'Older clock'],
  ])
  state.revokeBrowser(instance.id, browser.id, 300)
  assert.equal(state.trustBrowser(instance.id, browser.id, 'Retry', 400), false)
  assert.deepEqual(state.browsers(instance.id).find(value => value.id === browser.id), { id: browser.id, label: 'Older clock', createdAt: 100, lastSeen: 200, revoked: 1 })
})

test('reconciliation imports only revocations and preserves them through a subsequent stale snapshot', t => {
  const { state } = fixture(t)
  state.seed(instance, [browser])
  state.trustBrowser(instance.id, browser.id, 'Current label', 100)
  state.mergeRevocations(instance.id, true, [{ ...browser, label: 'Old label' }, { ...browser, id: 'untrusted' }])
  assert.equal(state.browsers(instance.id).length, 1)
  assert.equal(state.browsers(instance.id)[0].label, 'Current label')
  state.mergeRevocations(instance.id, true, [{ ...browser, revoked: 1 }, { ...browser, id: 'revoked-offline', revoked: 1 }])
  assert.equal(state.browserRevoked(instance.id, browser.id), true)
  assert.equal(state.browserRevoked(instance.id, 'revoked-offline'), true)
  state.mergeRevocations(instance.id, true, [browser])
  assert.equal(state.browserRevoked(instance.id, browser.id), true)
  assert.equal(state.trustBrowser(instance.id, browser.id, 'Retry', 200), false)
  state.mergeRevocations(instance.id, false, [])
  state.mergeRevocations(instance.id, true, [])
  assert.equal(state.instance(instance.id), null)
})

test('a failed initial import rolls back its initialized marker and leaves earlier tombstones intact', t => {
  const { state, fail } = fixture(t)
  state.revokeBrowser(instance.id, browser.id, 30)
  fail(query => query.includes('INSERT INTO mew_signal_browsers'))
  assert.throws(() => state.seed(instance, [browser]), /fixture-storage-failure/)
  fail()
  assert.equal(state.initialized(instance.id), false)
  assert.equal(state.instance(instance.id), null)
  assert.equal(state.browserRevoked(instance.id, browser.id), true)
  state.seed(instance, [browser])
  assert.equal(state.initialized(instance.id), true)
  assert.equal(state.browserRevoked(instance.id, browser.id), true)
})
