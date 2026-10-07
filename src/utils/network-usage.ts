import type { DesktopNetworkUsage } from './desktop-network.ts'

export type NetworkCategory = 'desktop' | 'other'
export type NetworkUsage = { startedAt: number; desktop: DesktopNetworkUsage; other: DesktopNetworkUsage }

export function createNetworkUsageStore() {
  let snapshot: NetworkUsage = { startedAt: Date.now(), desktop: { received: 0, sent: 0 }, other: { received: 0, sent: 0 } }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    add(category: NetworkCategory, direction: keyof DesktopNetworkUsage, bytes: number) {
      if (!Number.isFinite(bytes) || bytes <= 0) return
      snapshot = { ...snapshot, [category]: { ...snapshot[category], [direction]: snapshot[category][direction] + bytes } }
      if (!timer && listeners.size) timer = setTimeout(() => { timer = undefined; for (const listener of listeners) listener() }, 1000)
    },
  }
}

export const networkUsage = createNetworkUsageStore()

/** Each remote session contributes only its new bytes to the page-lifetime total. */
export function desktopUsageReporter(store = networkUsage) {
  let previous: DesktopNetworkUsage = { received: 0, sent: 0 }
  return (value: DesktopNetworkUsage) => {
    for (const direction of ['received', 'sent'] as const) store.add('desktop', direction, Math.max(0, value[direction] - previous[direction]))
    previous = { ...value }
  }
}
