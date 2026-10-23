import type { DesktopNetworkUsage } from './desktop-network.ts'

export type NetworkCategory = 'desktop' | 'other'
type NetworkAmounts = { desktop: DesktopNetworkUsage; other: DesktopNetworkUsage }
export type NetworkUsage = NetworkAmounts & { startedAt: number; rate: NetworkAmounts }

export function createNetworkUsageStore(now = () => performance.now()) {
  const empty = (): NetworkAmounts => ({ desktop: { received: 0, sent: 0 }, other: { received: 0, sent: 0 } })
  let snapshot: NetworkUsage = { startedAt: Date.now(), ...empty(), rate: empty() }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous = snapshot, sampledAt = now()
  const sample = () => {
    timer = undefined
    const time = now(), seconds = (time - sampledAt) / 1000
    const rate = empty()
    for (const category of ['desktop', 'other'] as const) for (const direction of ['received', 'sent'] as const) {
      rate[category][direction] = seconds > 0 ? (snapshot[category][direction] - previous[category][direction]) / seconds : 0
    }
    const changed = snapshot !== previous || (['desktop', 'other'] as const).some(category =>
      (['received', 'sent'] as const).some(direction => rate[category][direction] !== snapshot.rate[category][direction]))
    if (changed) snapshot = { ...snapshot, rate }
    previous = snapshot
    sampledAt = time
    if (changed) for (const listener of listeners) listener()
    if (listeners.size) timer = setTimeout(sample, 1000)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!listeners.size) { previous = snapshot; sampledAt = now(); timer = setTimeout(sample, 1000) }
      listeners.add(listener)
      return () => { listeners.delete(listener); if (!listeners.size) { clearTimeout(timer); timer = undefined } }
    },
    add(category: NetworkCategory, direction: keyof DesktopNetworkUsage, bytes: number) {
      if (!Number.isFinite(bytes) || bytes <= 0) return
      snapshot = { ...snapshot, [category]: { ...snapshot[category], [direction]: snapshot[category][direction] + bytes } }
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
