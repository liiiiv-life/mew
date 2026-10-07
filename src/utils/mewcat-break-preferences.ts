import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { useSyncExternalStore } from 'react'
import { parseBreakPreferences, type BreakPreferences } from './mewcat-break-rules.ts'

export const BREAK_PREFERENCES_KEY = 'mew:break-preferences'
export const BREAK_PROGRESS_KEY = 'mew:break-progress'
function read() {
  try { return parseBreakPreferences(scopedBrowserStorage().getItem(BREAK_PREFERENCES_KEY)) }
  catch { return parseBreakPreferences(null) }
}
let preferences = read()
const listeners = new Set<() => void>()
function storageChanged(event: StorageEvent) {
  if (event.key !== BREAK_PREFERENCES_KEY && event.key !== null) return
  preferences = read()
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
export const useBreakPreferences = () => useSyncExternalStore(subscribe, () => preferences)
export function saveBreakPreferences(next: BreakPreferences) {
  preferences = parseBreakPreferences(JSON.stringify(next))
  try { scopedBrowserStorage().setItem(BREAK_PREFERENCES_KEY, JSON.stringify(preferences)) } catch { /* session-only settings */ }
  listeners.forEach(listener => listener())
}
