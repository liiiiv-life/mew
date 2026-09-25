import { useEffect, useState } from 'react'

/** Track the working surface across portals, keyboard navigation and iframe focus. */
export function useFocusedWorkspacePanel() {
  const [focusedPanel, setFocusedPanel] = useState<string | null>(null)
  useEffect(() => {
    const record = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('.mobile-dock')) return
      const panel = target.closest<HTMLElement>('[data-workspace-panel]')?.dataset.workspacePanel
      if (panel) setFocusedPanel(panel)
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
  return [focusedPanel, setFocusedPanel] as const
}
