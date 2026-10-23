import { useEffect, useState } from 'react'
import { getVirtualKeyboard, unzoomedViewportHeight, viewportZoomRatio, virtualKeyboardViewportBottom } from '@mew/ui/virtual-keyboard'

/** Remember the unobscured height for browsers that resize both viewports. */
export function useMobileKeyboard() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const virtualKeyboard = getVirtualKeyboard()
    let width = window.innerWidth
    let screenWidth = Math.round((window.visualViewport?.width ?? width) * (window.visualViewport?.scale ?? 1))
    let baseline = Math.max(window.innerHeight, unzoomedViewportHeight())
    let editingSession = false
    let fullscreen = Boolean(document.fullscreenElement)
    const baselines = new Map([[fullscreen, baseline]])
    let restoredBaseline = false
    const update = () => {
      const viewport = window.visualViewport
      // Focus zoom and pinch zoom shorten CSS pixels without covering more of the screen.
      // Normalize relative to the fitted layout, rather than assuming its scale is 1.
      const height = unzoomedViewportHeight()
      const active = document.activeElement
      const editing = active instanceof HTMLElement && (active.isContentEditable || active.matches('textarea, input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="range"]):not([readonly])'))
      const nextFullscreen = Boolean(document.fullscreenElement)
      const nextScreenWidth = Math.round((viewport?.width ?? window.innerWidth) * (viewport?.scale ?? 1))
      if (width !== window.innerWidth || screenWidth !== nextScreenWidth) {
        width = window.innerWidth
        screenWidth = nextScreenWidth
        baseline = Math.max(window.innerHeight, height)
        editingSession = false
        fullscreen = nextFullscreen
        baselines.clear()
        restoredBaseline = false
      }
      if (fullscreen !== nextFullscreen) {
        baselines.set(fullscreen, baseline)
        fullscreen = nextFullscreen
        const remembered = baselines.get(fullscreen)
        baseline = remembered ?? Math.max(baseline, window.innerHeight, height)
        // Browser chrome changes the unobscured height. Keep the destination's
        // baseline even if fullscreenchange precedes the viewport resize.
        restoredBaseline = remembered !== undefined && editingSession
      }
      if (!restoredBaseline) baseline = Math.max(baseline, window.innerHeight, height)
      editingSession ||= editing
      // Desktop-site CSS pixels are smaller than screen pixels. Keep browser
      // chrome changes below the same keyboard threshold in both display modes.
      const coverage = (baseline - height) * (viewport?.scale ?? 1) / viewportZoomRatio()
      const keyboard = Number.isFinite(virtualKeyboardViewportBottom()) || (editingSession && coverage > 150)
      if (!keyboard && !editing) { baseline = height; editingSession = false; restoredBaseline = false }
      baselines.set(fullscreen, baseline)
      setHidden(keyboard)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    virtualKeyboard?.addEventListener('geometrychange', update)
    document.addEventListener('fullscreenchange', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      virtualKeyboard?.removeEventListener('geometrychange', update)
      document.removeEventListener('fullscreenchange', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return hidden
}
