/** Keep the workspace bottom inside both viewports, including fullscreen keyboard transitions. */
export function observeWorkspaceViewport() {
  const viewport = window.visualViewport
  const style = document.documentElement.style
  const previous = style.getPropertyValue('--app-height')
  let frame = 0
  const update = () => {
    // Focus can pan the visual viewport; measure its bottom in layout coordinates.
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
    style.setProperty('--app-height', `${Math.min(window.innerHeight, bottom)}px`)
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
