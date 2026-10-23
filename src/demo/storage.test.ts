import assert from 'node:assert/strict'
import test from 'node:test'
import { browserCachePersistenceEnabled, globalBrowserStorage, globalSessionStorage, remoteStorageName, scopedBrowserStorage, setBrowserStorageScope } from '../../packages/ui/src/browser-storage-scope.ts'
import { pruneBrowserStorage, writeBrowserStorage } from '../../packages/ui/src/browser-storage.ts'
import { loadFontPreferences, saveFontPreferences } from '../utils/fontPreferences.ts'
import { loadThemeSettings, saveThemeSettings } from '../utils/theme-color.ts'
import { readHistoryCache } from '../utils/agent-history-cache.ts'
import { readScheduledCache } from '../utils/agent-scheduled-cache.ts'
import { createMemoryStorage } from './memory-storage.ts'

test('a transient storage backend isolates global preferences, drafts and cache maintenance', async t => {
  const existing = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const native = createMemoryStorage(), transient = createMemoryStorage()
  native.setItem('mew:fonts', JSON.stringify({ ui: 'Existing UI', markdown: 'Existing document', mono: 'Existing code' }))
  native.setItem('mew:cache-times:v1', '{}')
  const before = Array.from({ length: native.length }, (_, index) => [native.key(index), native.getItem(native.key(index)!)])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: native })
  t.after(() => {
    setBrowserStorageScope()
    if (existing) Object.defineProperty(globalThis, 'localStorage', existing)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
  const session = createMemoryStorage()
  setBrowserStorageScope('demo', 'playground', { storage: transient, sessionStorage: session, persistentCaches: false })
  assert.equal(globalBrowserStorage(), transient)
  globalSessionStorage().setItem('mew:break-progress', 'demo progress')
  assert.equal(session.getItem('mew:break-progress'), 'demo progress')
  assert.equal(browserCachePersistenceEnabled(), false)
  saveFontPreferences({ ui: 'Demo UI', markdown: 'Demo document', mono: 'Demo code' })
  assert.equal(loadFontPreferences().ui, 'Demo UI')
  saveThemeSettings(loadThemeSettings())
  assert.equal(writeBrowserStorage('mew:agent-input:demo', 'demo draft'), true)
  assert.equal(scopedBrowserStorage().getItem('mew:agent-input:demo'), 'demo draft')
  assert.equal(transient.getItem(remoteStorageName('mew:agent-input:demo')), 'demo draft')
  pruneBrowserStorage()
  assert.equal(await readHistoryCache('demo'), null)
  assert.equal(await readScheduledCache('demo'), null)
  assert.deepEqual(Array.from({ length: native.length }, (_, index) => [native.key(index), native.getItem(native.key(index)!)]), before)
  setBrowserStorageScope()
  assert.equal(browserCachePersistenceEnabled(), true)
  assert.equal(loadFontPreferences().ui, 'Existing UI')
})
