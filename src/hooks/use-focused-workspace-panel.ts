import { numberedTabIndex, adjacentPanelTabDirection } from '@mew/shortcuts'
import { activateNumberedPanelTab, activateAdjacentPanelTab, numberedTabPanel } from '../utils/numbered-panel-tabs'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Track the working surface across portals, keyboard navigation and iframe focus. */
export function useFocusedWorkspacePanel() {
  const [focusedPanel, setFocusedPanel] = useState<string | null>(null)
  const lastFocus = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    let lastSurface: HTMLElement | null = null
    const record = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('.mobile-dock')) return
      const panel = target.closest<HTMLElement>('[data-workspace-panel]')?.dataset.workspacePanel
      if (panel) {
        lastSurface = target.closest<HTMLElement>('[data-workspace-panel]')
        setFocusedPanel(panel)
        if (target instanceof HTMLElement && target === document.activeElement) lastFocus.current.set(panel, target)
      }
    }
    const focus = (event: Event) => record(event.target)
    const selectTab = (event: KeyboardEvent) => {
      const index = numberedTabIndex(event)
      const direction = adjacentPanelTabDirection(event)
      if (index === null && direction === null) return
      const consume = () => { event.preventDefault(); event.stopImmediatePropagation() }
      const browserShortcut = event.ctrlKey || event.metaKey
      const target = event.target instanceof Element ? event.target : document.activeElement
      // A modal has its own keyboard scope; do not switch the panel behind it.
      if (target?.closest('[role="dialog"], [aria-modal="true"]')) { if (browserShortcut) consume(); return }
      const surface = target?.closest<HTMLElement>('[data-workspace-panel]') ?? lastSurface
      const panel = surface && numberedTabPanel(surface)
      if (!surface?.isConnected || surface.closest('[inert]') || !panel?.isConnected || panel.closest('[inert]') || !panel.checkVisibility({ visibilityProperty: true })) { if (browserShortcut) consume(); return }
      lastSurface = panel
      consume()
      if (index !== null) activateNumberedPanelTab(panel, index)
      else if (direction !== null) activateAdjacentPanelTab(panel, direction)
    }
    let frameFocus: ReturnType<typeof setTimeout> | undefined
    const blur = () => {
      clearTimeout(frameFocus)
      frameFocus = setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) record(document.activeElement)
      }, 0)
    }
    window.addEventListener('keydown', selectTab, true)
    document.addEventListener('pointerdown', focus, true)
    document.addEventListener('focusin', focus, true)
    window.addEventListener('blur', blur)
    record(document.activeElement)
    return () => {
      clearTimeout(frameFocus)
      window.removeEventListener('keydown', selectTab, true)
      document.removeEventListener('pointerdown', focus, true)
      document.removeEventListener('focusin', focus, true)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const focusPanel = useCallback((panel: string) => {
    setFocusedPanel(panel)
    const visible = (element: HTMLElement) => element.isConnected && !element.closest('[inert]') && !element.matches(':disabled') && element.checkVisibility({ visibilityProperty: true })
    const previous = lastFocus.current.get(panel)
    if (previous && visible(previous)) { previous.focus({ preventScroll: true }); return }
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-panel]'))
      .filter(element => element.dataset.workspacePanel === panel && visible(element))
    for (const selector of ['[contenteditable="true"], textarea, input:not([type="hidden"]), iframe', 'button, [tabindex]']) {
      for (const surface of surfaces) {
        const target = Array.from(surface.querySelectorAll<HTMLElement>(selector)).find(visible)
        if (target) { target.focus({ preventScroll: true }); return }
      }
    }
    const surface = surfaces[0]
    if (surface) { surface.tabIndex = -1; surface.focus({ preventScroll: true }) }
  }, [])
  return [focusedPanel, setFocusedPanel, focusPanel] as const
}
