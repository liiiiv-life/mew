import { fullscreenKeyboardOverlay, getVirtualKeyboard, viewportZoomRatio, virtualKeyboardViewportBottom } from '@mew/ui/virtual-keyboard'

/** Zoom changes CSS pixel coverage, while the fixed dock stays in the layout viewport. */
export function workspaceViewportBottom() {
  const viewport = window.visualViewport
  // The overflow-hidden root is a separate clipping boundary during fullscreen
  // keyboard transitions, even while the viewport APIs still report older sizes.
  const root = document.documentElement
  const layoutHeight = root.clientHeight || window.innerHeight
  // On the document root, clientHeight reports the layout viewport rather than
  // the rendered box. Fullscreen can clip that box before any viewport shrinks.
  const rootBottom = root.getBoundingClientRect().bottom || layoutHeight
  const keyboardBottom = virtualKeyboardViewportBottom()
  if (!viewport) return Math.min(window.innerHeight, layoutHeight, rootBottom, keyboardBottom)
  const zoom = viewportZoomRatio()
  const bottom = viewport.height * zoom + (zoom === 1 ? viewport.offsetTop : 0)
  return Math.min(window.innerHeight, layoutHeight, rootBottom, bottom, keyboardBottom)
}

/** Keep the workspace bottom inside both viewports, including fullscreen keyboard transitions. */
export function observeWorkspaceViewport() {
  const viewport = window.visualViewport
  const keyboard = getVirtualKeyboard()
  const previousOverlay = keyboard?.overlaysContent ?? false
  const style = document.documentElement.style
  const previous = style.getPropertyValue('--app-height')
  let frame = 0
  const update = () => {
    // Fullscreen Chromium does not resize content for the OS keyboard, even
    // with interactive-widget=resizes-content. Opt in to its geometry instead.
    if (keyboard && window === window.top) {
      const overlay = fullscreenKeyboardOverlay() ? true : previousOverlay
      if (keyboard.overlaysContent !== overlay) keyboard.overlaysContent = overlay
    }
    style.setProperty('--app-height', `${workspaceViewportBottom()}px`)
  }
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(update)
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  observer?.observe(document.documentElement)
  update()
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  keyboard?.addEventListener('geometrychange', schedule)
  window.addEventListener('resize', schedule)
  document.addEventListener('fullscreenchange', schedule)
  return () => {
    window.cancelAnimationFrame(frame)
    observer?.disconnect()
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    keyboard?.removeEventListener('geometrychange', schedule)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('fullscreenchange', schedule)
    if (keyboard && window === window.top) keyboard.overlaysContent = previousOverlay
    if (previous) style.setProperty('--app-height', previous)
    else style.removeProperty('--app-height')
  }
}
