/** Zoom changes CSS pixel coverage, while the fixed dock stays in the layout viewport. */
export function workspaceViewportBottom() {
  const viewport = window.visualViewport
  if (!viewport) return window.innerHeight
  const bottom = viewport.scale === 1
    ? viewport.offsetTop + viewport.height
    : viewport.height * viewport.scale
  return Math.min(window.innerHeight, bottom)
}

/** Keep the workspace bottom inside both viewports, including fullscreen keyboard transitions. */
export function observeWorkspaceViewport() {
  const viewport = window.visualViewport
  const style = document.documentElement.style
  const previous = style.getPropertyValue('--app-height')
  let frame = 0
  const update = () => {
    style.setProperty('--app-height', `${workspaceViewportBottom()}px`)
  }
  const schedule = () => {
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(update)
  }
  update()
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  document.addEventListener('fullscreenchange', schedule)
  return () => {
    window.cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('fullscreenchange', schedule)
    if (previous) style.setProperty('--app-height', previous)
    else style.removeProperty('--app-height')
  }
}
