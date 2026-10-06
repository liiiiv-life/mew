export const MOBILE_DOCK_ORDER = ['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'debugger', 'desktop', 'memo', 'tasks'] as const
export type MobileDockPanel = typeof MOBILE_DOCK_ORDER[number]
export type DockDirection = -1 | 1
export const MOBILE_DOCK_ORDER_KEY = 'mew:mobile-dock-order'

export function normalizeMobileDockOrder(value: unknown): MobileDockPanel[] {
  const known = Array.isArray(value) ? value.filter((id): id is MobileDockPanel => MOBILE_DOCK_ORDER.includes(id)) : []
  const order = [...new Set(known)]
  for (const panel of MOBILE_DOCK_ORDER) {
    if (order.includes(panel)) continue
    const desktop = order.indexOf('desktop')
    if ((panel === 'features' || panel === 'debugger') && desktop >= 0) order.splice(desktop, 0, panel)
    else order.push(panel)
  }
  return order
}

export function adjacentDockPanel(order: readonly MobileDockPanel[], active: string, direction: DockDirection): MobileDockPanel | undefined {
  const index = order.indexOf(active as MobileDockPanel)
  return index < 0 ? undefined : order[index + direction]
}

export function moveDockPanel(order: MobileDockPanel[], from: MobileDockPanel, to: MobileDockPanel): MobileDockPanel[] {
  const next = [...order], start = next.indexOf(from), end = next.indexOf(to)
  if (start < 0 || end < 0) return next
  next.splice(end, 0, ...next.splice(start, 1))
  return next
}

export const MOBILE_DOCK_HIDDEN_KEY = 'mew:mobile-dock-hidden'

export function normalizeHiddenDockPanels(value: unknown): MobileDockPanel[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is MobileDockPanel => MOBILE_DOCK_ORDER.includes(id)))] : []
}

export function visibleDockPanels(order: readonly MobileDockPanel[], available: readonly MobileDockPanel[], hidden: readonly MobileDockPanel[]): MobileDockPanel[] {
  return order.filter(id => available.includes(id) && !hidden.includes(id))
}
