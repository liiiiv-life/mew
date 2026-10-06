/** Resolve a portalled body to its own tab bar, never another split of the same kind. */
export function numberedTabPanel(surface: HTMLElement): HTMLElement | undefined {
  const group = surface.dataset.dockBody
  return group
    ? Array.from(document.querySelectorAll<HTMLElement>('[data-dock-panel]')).find(element => element.dataset.dockPanel === group)
    : surface
}

function panelTabs(surface: HTMLElement): HTMLElement[] {
  const panel = numberedTabPanel(surface)
  if (!panel || panel.closest('[inert]') || !panel.checkVisibility({ visibilityProperty: true })) return []
  const bar = panel.querySelector<HTMLElement>('[data-dock-tab-bar]')
  const list = bar?.querySelector<HTMLElement>('[role="tablist"]') ?? bar
  return Array.from((list ?? panel).querySelectorAll<HTMLElement>(list ? '[role="tab"]' : '[data-numbered-tab]'))
}

export function activateNumberedPanelTab(surface: HTMLElement, index: number): void {
  const tab = panelTabs(surface)[index]
  if (!tab || tab.matches(':disabled, [aria-disabled="true"]')) return
  tab.click()
}

export function activateAdjacentPanelTab(surface: HTMLElement, direction: -1 | 1): void {
  const tabs = panelTabs(surface)
  const index = tabs.findIndex(tab => tab.matches('[aria-selected="true"], [aria-pressed="true"]'))
  if (index < 0 || tabs.length < 2) return
  const next = (index + direction + tabs.length) % tabs.length
  if (!tabs[next].matches(':disabled, [aria-disabled="true"]')) tabs[next].click()
}
