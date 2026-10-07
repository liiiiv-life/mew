import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { useSyncExternalStore } from 'react'
export type ToolPresentation = { memo: 'tab' | 'popup'; tasks: 'tab' | 'popup' }
let value: ToolPresentation = { memo: 'tab', tasks: 'tab' }
const listeners = new Set<() => void>()
const read = () => {
  try {
    const saved = JSON.parse(scopedBrowserStorage().getItem('mew:tool-presentation') ?? '{}')
    value = { memo: saved.memo === 'popup' ? 'popup' : 'tab', tasks: saved.tasks === 'popup' ? 'popup' : 'tab' }
  } catch { /* defaults */ }
}
read()
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === 'mew:tool-presentation') { read(); listeners.forEach(listener => listener()) } })
export function setToolPresentation(tool: keyof ToolPresentation, mode: 'tab' | 'popup') {
  value = { ...value, [tool]: mode }
  try { scopedBrowserStorage().setItem('mew:tool-presentation', JSON.stringify(value)) } catch { /* session setting */ }
  listeners.forEach(listener => listener())
}
export function useToolPresentation() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => value)
}
