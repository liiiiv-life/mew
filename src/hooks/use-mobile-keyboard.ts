import { useEffect, useState } from 'react'

/** Remember the unobscured height for browsers that resize both viewports. */
export function useMobileKeyboard() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let width = window.innerWidth
    let baseline = Math.max(window.innerHeight, window.visualViewport?.height ?? 0)
    let editingSession = false
    const update = () => {
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      const active = document.activeElement
      const editing = active instanceof HTMLElement && (active.isContentEditable || active.matches('textarea, input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="range"]):not([readonly])'))
      if (width !== window.innerWidth) { width = window.innerWidth; baseline = window.innerHeight; editingSession = false }
      if ((viewport?.scale ?? 1) !== 1) return
      baseline = Math.max(baseline, window.innerHeight, height)
      editingSession ||= editing
      const keyboard = editingSession && baseline - height > 150
      if (!keyboard && !editing) { baseline = height; editingSession = false }
      setHidden(keyboard)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return hidden
}
