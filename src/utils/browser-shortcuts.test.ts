import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setBrowserStorageScope } from '@mew/ui/browser-storage-scope'
import { readBrowserShortcuts, writeBrowserShortcuts } from './browser-shortcuts.ts'

function installStorage(t: TestContext, storage: object) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
}

test('new installations and unreadable shortcut state start with no workspace shortcuts', t => {
  setBrowserStorageScope()
  const storage = { getItem: () => null as string | null }
  installStorage(t, storage)
  assert.deepEqual(readBrowserShortcuts(), [])
  storage.getItem = () => '{broken'
  assert.deepEqual(readBrowserShortcuts(), [])
  storage.getItem = () => '{}'
  assert.deepEqual(readBrowserShortcuts(), [])
  storage.getItem = () => { throw new Error('storage unavailable') }
  assert.deepEqual(readBrowserShortcuts(), [])
})

test('saved shortcuts remain available and a deleted list stays empty', t => {
  setBrowserStorageScope()
  const values = new Map<string, string>()
  const storage = {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  installStorage(t, storage)
  const saved = [{ id: 'project-dev', name: 'Project dev', url: 'http://localhost:3000/' }]
  assert.equal(writeBrowserShortcuts(saved), true)
  assert.deepEqual(readBrowserShortcuts(), saved)
  assert.equal(writeBrowserShortcuts([]), true)
  assert.deepEqual(readBrowserShortcuts(), [])
  assert.equal(storage.getItem('mew:browser-shortcuts'), '[]')
})
