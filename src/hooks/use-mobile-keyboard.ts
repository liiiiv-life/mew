import { useEffect, useState } from 'react'

/** Remember the unobscured height for browsers that resize both viewports. */
export function useMobileKeyboard() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let width = window.innerWidth
    let baseline = Math.max(window.innerHeight, window.visualViewport?.height ?? 0)
    let editingSession = false
    let fullscreen = Boolean(document.fullscreenElement)
    const baselines = new Map([[fullscreen, baseline]])
    let restoredBaseline = false
    const update = () => {
      const viewport = window.visualViewport
      // Focus zoom and pinch zoom shorten CSS pixels without covering more of the screen.
      // Normalize the visible height instead of skipping keyboard detection while zoomed.
      const height = (viewport?.height ?? window.innerHeight) * (viewport?.scale ?? 1)
      const active = document.activeElement
      const editing = active instanceof HTMLElement && (active.isContentEditable || active.matches('textarea, input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="range"]):not([readonly])'))
      const nextFullscreen = Boolean(document.fullscreenElement)
      if (width !== window.innerWidth) {
        width = window.innerWidth
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
      const keyboard = editingSession && baseline - height > 150
      if (!keyboard && !editing) { baseline = height; editingSession = false; restoredBaseline = false }
      baselines.set(fullscreen, baseline)
      setHidden(keyboard)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    document.addEventListener('fullscreenchange', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      document.removeEventListener('fullscreenchange', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return hidden
}
