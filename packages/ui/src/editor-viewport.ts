const MOBILE_WIDTH = 768
const CARET_MARGIN = 12

/** Intersection of the editor, visible viewport and optional fixed key bar. */
export function visibleEditorBounds(container: HTMLElement) {
  const win = container.ownerDocument.defaultView!
  const viewport = win.visualViewport
  const box = container.getBoundingClientRect()
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportBottom = viewportTop + (viewport?.height ?? win.innerHeight)
  const bar = container.querySelector<HTMLElement>('[data-mobile-key-bar]')?.getBoundingClientRect()
  return {
    top: Math.max(box.top, viewportTop) + CARET_MARGIN,
    bottom: Math.min(box.bottom, viewportBottom, bar && bar.height > 0 ? bar.top : Infinity) - CARET_MARGIN,
  }
}

/** Keep a mobile editor inside the keyboard-adjusted viewport, including hosts with a fixed height. */
export function observeEditorViewport(container: HTMLElement, onResize: () => void, reserveKeyBar = false) {
  const win = container.ownerDocument.defaultView!
  const viewport = win.visualViewport
  const originalMaxHeight = container.style.maxHeight
  let frame: number | null = null
  const update = () => {
    frame = null
    if (win.innerWidth >= MOBILE_WIDTH || (viewport?.scale ?? 1) !== 1) {
      container.style.maxHeight = originalMaxHeight
      return
    }
    const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? win.innerHeight)
    const bar = reserveKeyBar ? container.querySelector<HTMLElement>('[data-mobile-key-bar]') : null
    const barHeight = bar && win.getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().height : 0
    const height = Math.max(0, bottom - barHeight - container.getBoundingClientRect().top)
    const maxHeight = `${height}px`
    if (container.style.maxHeight !== maxHeight) container.style.maxHeight = maxHeight
    onResize()
    // Property/search inputs also live in the editor, outside the rich-text selection.
    const active = container.ownerDocument.activeElement
    if (active instanceof HTMLElement && container.contains(active) && active.matches('input, textarea') && active.getBoundingClientRect().height > 0) {
      const bounds = visibleEditorBounds(container)
      const caret = active.getBoundingClientRect()
      if (bounds.bottom > bounds.top) {
        if (caret.bottom > bounds.bottom) container.scrollTop += caret.bottom - bounds.bottom
        else if (caret.top < bounds.top) container.scrollTop -= bounds.top - caret.top
      }
    }
  }
  const schedule = () => {
    if (frame !== null) win.cancelAnimationFrame(frame)
    frame = win.requestAnimationFrame(update)
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(container)
  const mutations = reserveKeyBar ? new MutationObserver(schedule) : null
  mutations?.observe(container, { childList: true, subtree: true })
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  win.addEventListener('resize', schedule)
  container.addEventListener('focusin', schedule)
  schedule()
  return () => {
    observer.disconnect()
    mutations?.disconnect()
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    win.removeEventListener('resize', schedule)
    container.removeEventListener('focusin', schedule)
    if (frame !== null) win.cancelAnimationFrame(frame)
    container.style.maxHeight = originalMaxHeight
  }
}
