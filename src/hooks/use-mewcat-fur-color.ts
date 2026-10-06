import { useSyncExternalStore } from 'react'
import { loadMewcatFurColor, saveMewcatFurColor, MEWCAT_FUR_COLOR_KEY } from '../utils/mewcat-fur-color'
let color = loadMewcatFurColor()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === MEWCAT_FUR_COLOR_KEY || event.key === null) { color = loadMewcatFurColor(); emit() }
})
export function setMewcatFurColor(value: string): void {
  color = saveMewcatFurColor(value)
  emit()
}
export function useMewcatFurColor(): string {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => color)
}
