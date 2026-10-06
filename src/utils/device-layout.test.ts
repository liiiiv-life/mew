import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreDeviceLayout, saveDeviceLayout } from './device-layout.ts'

test('devices restore independent geometry without copying unrelated account settings', () => {
  const desktop = new Map<string, string>(), mobile = new Map<string, string>()
  const attach = (storage: Map<string, string>) => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })
  const fallback = { dock: { ratio: .5 }, tabs: { main: 1 }, features: { expanded: true } }
  attach(desktop)
  saveDeviceLayout('a', '/project', { dock: { ratio: .3 }, tabs: { main: 2 }, features: { expanded: false } })
  assert.deepEqual(restoreDeviceLayout('a', '/project', fallback), { ...fallback, dock: { ratio: .3 }, tabs: { main: 2 } })
  assert.deepEqual(restoreDeviceLayout('b', '/project', fallback), fallback)
  attach(mobile)
  assert.deepEqual(restoreDeviceLayout('a', '/project', fallback), fallback)
  saveDeviceLayout('a', '/project', { dock: { ratio: .7 } })
  attach(desktop)
  assert.deepEqual(restoreDeviceLayout('a', '/project', fallback).dock, { ratio: .3 })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } } })
  assert.deepEqual(restoreDeviceLayout('a', '/project', fallback), fallback)
  assert.doesNotThrow(() => saveDeviceLayout('a', '/project', fallback))
})
