import { useCallback, useEffect, useRef, useState } from 'react'

/** Track the working surface across portals, keyboard navigation and iframe focus. */
export function useFocusedWorkspacePanel() {
  const [focusedPanel, setFocusedPanel] = useState<string | null>(null)
  const lastFocus = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    const record = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('.mobile-dock')) return
      const panel = target.closest<HTMLElement>('[data-workspace-panel]')?.dataset.workspacePanel
      if (panel) {
        setFocusedPanel(panel)
        if (target instanceof HTMLElement && target === document.activeElement) lastFocus.current.set(panel, target)
      }
    }
    const focus = (event: Event) => record(event.target)
    let frameFocus: ReturnType<typeof setTimeout> | undefined
    const blur = () => {
      clearTimeout(frameFocus)
      frameFocus = setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) record(document.activeElement)
      }, 0)
    }
    document.addEventListener('pointerdown', focus, true)
    document.addEventListener('focusin', focus, true)
    window.addEventListener('blur', blur)
    record(document.activeElement)
    return () => {
      clearTimeout(frameFocus)
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
