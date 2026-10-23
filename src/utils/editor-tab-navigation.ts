export type TabNavigation = { entries: string[]; index: number }

type NavigationTab = { id?: string; path: string; navigation?: TabNavigation }
type NavigationPane<T extends NavigationTab> = { tabs: T[]; activePath: string | null; activeTabId?: string; recentTabIds?: string[] }

const tabId = (tab: NavigationTab) => tab.id ?? tab.path

export function activePaneTab<T extends NavigationTab>(pane: NavigationPane<T>): T | undefined {
  return (pane.activeTabId ? pane.tabs.find(tab => tab.id === pane.activeTabId) : undefined) ?? pane.tabs.find(tab => tab.path === pane.activePath)
}

/** Keep activation order independent from tab position and the document currently shown in a tab. */
export function recordPaneActivation<T extends NavigationTab, P extends NavigationPane<T>>(previous: P | undefined, next: P): P {
  const available = new Set(next.tabs.map(tabId))
  const previousActive = previous ? activePaneTab(previous) : undefined
  const active = activePaneTab(next)
  const recent = [...new Set(previous?.recentTabIds ?? (previousActive ? [tabId(previousActive)] : []))].filter(id => available.has(id))
  if (active) {
    const id = tabId(active)
    const index = recent.indexOf(id)
    if (index !== -1) recent.splice(index, 1)
    recent.unshift(id)
  }
  if (next.activeTabId === active?.id && next.activePath === (active?.path ?? null) && next.recentTabIds?.length === recent.length && next.recentTabIds.every((id, index) => id === recent[index])) return next
  return { ...next, activePath: active?.path ?? null, activeTabId: active?.id, recentTabIds: recent }
}

export function mostRecentTab<T extends NavigationTab>(pane: NavigationPane<T>, remaining: T[]): T | undefined {
  for (const id of pane.recentTabIds ?? []) {
    const tab = remaining.find(tab => tabId(tab) === id)
    if (tab) return tab
  }
  return remaining[0]
}

export function mostRecentTabPath<T extends NavigationTab>(pane: NavigationPane<T>, remaining: T[]): string | null {
  return mostRecentTab(pane, remaining)?.path ?? null
}

export function nextTabNavigation(tab: NavigationTab, path: string, index?: number): TabNavigation {
  const current = tab.navigation ?? { entries: [tab.path], index: 0 }
  if (index !== undefined) return { ...current, index }
  if (current.entries[current.index] === path) return current
  return { entries: [...current.entries.slice(0, current.index + 1), path], index: current.index + 1 }
}

/** Remap or remove even documents that are only present in a tab's back/forward list. */
export function remapTabNavigation(navigation: TabNavigation | undefined, remap: (path: string) => string | null): TabNavigation | undefined {
  if (!navigation) return undefined
  const entries: string[] = []
  let index = 0
  navigation.entries.forEach((path, position) => {
    const mapped = remap(path)
    if (mapped !== null && entries.at(-1) !== mapped) entries.push(mapped)
    if (position <= navigation.index) index = Math.max(0, entries.length - 1)
  })
  return entries.length ? { entries, index: Math.min(index, entries.length - 1) } : undefined
}
