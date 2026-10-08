import { useSyncExternalStore } from 'react'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import { remoteStorageName, scopedBrowserStorage } from '@mew/ui/browser-storage-scope'

export const MEWCAT_SIZE_KEY = 'mew:mewcat-size'
export const DEFAULT_MEWCAT_SIZE = 48
export const MIN_MEWCAT_SIZE = 24
export const MAX_MEWCAT_SIZE = 144

function normalizeSize(value: unknown): number {
  const size = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(size) ? Math.max(MIN_MEWCAT_SIZE, Math.min(MAX_MEWCAT_SIZE, Math.round(size))) : DEFAULT_MEWCAT_SIZE
}

function readSize(): number {
  try { return normalizeSize(scopedBrowserStorage().getItem(MEWCAT_SIZE_KEY)) }
  catch { return DEFAULT_MEWCAT_SIZE }
}

let snapshotKey: string | undefined
let size = DEFAULT_MEWCAT_SIZE
const listeners = new Set<() => void>()
function snapshot() {
  const key = remoteStorageName(MEWCAT_SIZE_KEY)
  if (snapshotKey !== key) {
    snapshotKey = key
    size = readSize()
  }
  return size
}
function storageChanged(event: StorageEvent) {
  if (event.key !== null && event.key !== remoteStorageName(MEWCAT_SIZE_KEY)) return
  snapshotKey = remoteStorageName(MEWCAT_SIZE_KEY)
  size = readSize()
  listeners.forEach(listener => listener())
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', storageChanged)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', storageChanged)
  }
}

export const useMewcatSize = () => useSyncExternalStore(subscribe, snapshot)

export function setMewcatSize(next: number): boolean {
  snapshot()
  size = normalizeSize(next)
  const saved = writeBrowserStorage(MEWCAT_SIZE_KEY, String(size))
  listeners.forEach(listener => listener())
  return saved
}
