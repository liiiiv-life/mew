import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccountThemeSync, loadAccountThemeCache, saveAccountThemeCache } from './account-theme.ts'
import { DEFAULT_THEME_PALETTE, THEME_PRESETS, type ThemeSettings } from '../../shared/theme.ts'

const theme = (index: number): ThemeSettings => ({ palette: THEME_PRESETS[index].palette, custom: [] })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

test('legacy theme is claimed once, caches stay separate by account and remote instance', () => {
  const legacy = memoryStorage(), firstInstance = memoryStorage(), secondInstance = memoryStorage()
  legacy.setItem('mew:themes', JSON.stringify(theme(1)))
  assert.deepEqual(loadAccountThemeCache('a', firstInstance, legacy), theme(1))
  saveAccountThemeCache('a', theme(1), firstInstance, legacy)
  assert.deepEqual(loadAccountThemeCache('b', firstInstance, legacy), { palette: DEFAULT_THEME_PALETTE, custom: [] })
  saveAccountThemeCache('b', theme(3), firstInstance, legacy)
  assert.deepEqual(loadAccountThemeCache('a', firstInstance, legacy), theme(1))
  assert.deepEqual(loadAccountThemeCache('b', firstInstance, legacy), theme(3))
  assert.deepEqual(loadAccountThemeCache('b', secondInstance, legacy), { palette: DEFAULT_THEME_PALETTE, custom: [] })
})

test('server theme wins over stale device cache, refreshes do not write it back', async () => {
  let remote = theme(1), local = theme(0), writes = 0
  const sync = createAccountThemeSync(local, {
    read: async () => remote, write: async value => { writes++; return value },
    apply: value => { local = value }, onError: assert.fail,
  })
  sync.refresh(); await tick()
  assert.deepEqual(local, remote)
  remote = theme(3)
  sync.refresh(); await tick()
  assert.deepEqual(local, remote)
  assert.equal(writes, 0)
  sync.dispose()
})

test('concurrent first-device migration uses the existing server theme', async () => {
  const result = deferred<ThemeSettings | null>(), existing = theme(4)
  let local = theme(0)
  const sync = createAccountThemeSync(local, {
    read: () => result.promise,
    write: async (_value, initialize) => { assert.equal(initialize, true); return existing },
    apply: value => { local = value }, onError: assert.fail,
  })
  sync.refresh(); result.resolve(null); await tick()
  assert.deepEqual(local, existing)
  sync.dispose()
})

test('late hydration cannot replace a user choice and rapid saves stay ordered', async () => {
  const hydration = deferred<ThemeSettings | null>(), firstSave = deferred<ThemeSettings>()
  let remote = theme(0), local = remote, reads = 0
  const writes: ThemeSettings[] = []
  const sync = createAccountThemeSync(local, {
    read: () => ++reads === 1 ? hydration.promise : Promise.resolve(remote),
    write: async (value, initialize) => {
      assert.equal(initialize, false)
      writes.push(value)
      if (writes.length === 1) await firstSave.promise
      remote = value
      return value
    }, apply: value => { local = value }, onError: assert.fail,
  })
  sync.refresh(); sync.change(theme(1)); hydration.resolve(theme(3)); await tick()
  assert.deepEqual(local, theme(1))
  sync.change(theme(5)); sync.refresh(); firstSave.resolve(theme(1)); await tick()
  assert.deepEqual(writes, [theme(1), theme(5)])
  assert.deepEqual(remote, theme(5))
  assert.deepEqual(local, remote)
  sync.dispose()
})

test('failed saves retry on reconnect, and disposed sessions ignore late responses', async () => {
  let offline = true, errors = 0, local = theme(0), remote = local
  const sync = createAccountThemeSync(local, {
    read: async () => remote,
    write: async value => { if (offline) throw new Error('offline'); remote = value; return value },
    apply: value => { local = value }, onError: () => { errors++ },
  })
  sync.change(theme(1)); await tick()
  assert.equal(errors, 1)
  assert.deepEqual(local, theme(1))
  offline = false; sync.refresh(); await tick()
  assert.deepEqual(remote, theme(1))
  sync.dispose()
  const response = deferred<ThemeSettings | null>()
  const stale = createAccountThemeSync(local, { read: () => response.promise, write: async value => value, apply: assert.fail, onError: assert.fail })
  stale.refresh(); stale.dispose(); response.resolve(theme(3)); await tick()
})

test('unavailable or corrupt browser storage does not prevent account synchronization', () => {
  const denied = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.deepEqual(loadAccountThemeCache('a', denied), { palette: DEFAULT_THEME_PALETTE, custom: [] })
  assert.doesNotThrow(() => saveAccountThemeCache('a', theme(1), denied))
  const storage = memoryStorage()
  storage.setItem('mew:themes:"a"', 'invalid json')
  assert.deepEqual(loadAccountThemeCache('a', storage), { palette: DEFAULT_THEME_PALETTE, custom: [] })
})
