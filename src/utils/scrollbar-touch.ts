const HIT_WIDTH = 24
const MIN_HIT_LENGTH = 44

type ScrollbarHit = {
  element: HTMLElement
  axis: 'x' | 'y'
  origin: number
  offset: number
  ratio: number
  min: number
  max: number
  distance: number
}

function axisAligned(element: HTMLElement) {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.rotate !== 'none' && style.rotate !== '0deg' || style.scale.includes('-')) return false
    if (style.transform === 'none') continue
    const matrix = new DOMMatrixReadOnly(style.transform)
    if (!matrix.is2D || matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.b) > 0.00001 || Math.abs(matrix.c) > 0.00001) return false
  }
  return true
}

function findScrollbar(event: Event, x: number, y: number): ScrollbarHit | null {
  const path = event.composedPath()
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue
    if (node.closest('[inert]') || node.matches('input, select')) return null
    if (node.matches('button, a[href], [role="button"]')) {
      const rect = node.getBoundingClientRect()
      if (rect.width <= MIN_HIT_LENGTH && rect.height <= MIN_HIT_LENGTH) return null
    }
  }

  for (const node of path) {
    if (!(node instanceof HTMLElement) || !node.clientWidth || !node.clientHeight) continue
    const element = node
    const style = getComputedStyle(element)
    if (style.scrollbarWidth === 'none') continue
    const scrollbarStyle = getComputedStyle(element, '::-webkit-scrollbar')
    if (scrollbarStyle.display === 'none') continue
    const rect = element.getBoundingClientRect()
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
    const scaleX = rect.width / element.offsetWidth
    const scaleY = rect.height / element.offsetHeight
    const rtl = style.direction === 'rtl'
    const hits: ScrollbarHit[] = []

    function check(axis: 'x' | 'y', distance: number, start: number, length: number, viewport: number, content: number, offset: number, scale: number) {
      const overflow = axis === 'y' ? style.overflowY : style.overflowX
      const thickness = axis === 'y' ? scrollbarStyle.width : scrollbarStyle.height
      const range = content - viewport
      if (!/^(auto|scroll|overlay)$/.test(overflow) || thickness === '0px' || range <= 0 || distance < 0 || distance > HIT_WIDTH) return
      const thumbLength = Math.min(length, Math.max(18 * scale, length * viewport / content))
      const travel = length - thumbLength
      if (travel <= 0) return
      const min = axis === 'x' && rtl ? -range : 0
      const progress = Math.max(0, Math.min(1, (offset - min) / range))
      const center = start + progress * travel + thumbLength / 2
      const hitLength = Math.min(length, Math.max(thumbLength, MIN_HIT_LENGTH))
      const hitStart = Math.max(start, Math.min(start + length - hitLength, center - hitLength / 2))
      const coordinate = axis === 'y' ? y : x
      if (coordinate < hitStart || coordinate > hitStart + hitLength) return
      hits.push({ element, axis, origin: coordinate, offset, ratio: range / travel, min, max: min + range, distance })
    }

    const verticalEdge = rtl ? rect.left + parseFloat(style.borderLeftWidth) * scaleX : rect.right - parseFloat(style.borderRightWidth) * scaleX
    check('y', rtl ? x - verticalEdge : verticalEdge - x, rect.top + element.clientTop * scaleY,
      element.clientHeight * scaleY, element.clientHeight, element.scrollHeight, element.scrollTop, scaleY)
    check('x', rect.bottom - parseFloat(style.borderBottomWidth) * scaleY - y, rect.left + element.clientLeft * scaleX,
      element.clientWidth * scaleX, element.clientWidth, element.scrollWidth, element.scrollLeft, scaleX)
    if (hits.length) return axisAligned(element) ? hits.sort((a, b) => a.distance - b.distance)[0] : null
  }
  return null
}

/** Expand touch grabbing around native thumbs without changing their paint or layout. */
export function startScrollbarTouchDragging() {
  let drag: (ScrollbarHit & { identifier: number }) | null = null

  function stopDrag() {
    drag = null
    document.removeEventListener('touchmove', move, true)
    document.removeEventListener('touchend', end, true)
    document.removeEventListener('touchcancel', stopDrag, true)
    document.removeEventListener('visibilitychange', stopDrag)
    window.removeEventListener('blur', stopDrag)
  }

  function move(event: TouchEvent) {
    if (!drag) return
    const touch = Array.from(event.touches).find(point => point.identifier === drag!.identifier)
    if (!touch || event.touches.length !== 1 || !event.cancelable || !drag.element.isConnected) { stopDrag(); return }
    event.preventDefault()
    event.stopPropagation()
    const coordinate = drag.axis === 'y' ? touch.clientY : touch.clientX
    const offset = Math.max(drag.min, Math.min(drag.max, drag.offset + (coordinate - drag.origin) * drag.ratio))
    drag.element.scrollTo({ [drag.axis === 'y' ? 'top' : 'left']: offset, behavior: 'instant' })
  }

  function end(event: TouchEvent) {
    if (drag && !Array.from(event.touches).some(point => point.identifier === drag!.identifier)) {
      event.stopPropagation()
      stopDrag()
    }
  }

  function start(event: TouchEvent) {
    if (event.touches.length !== 1) { stopDrag(); return }
    if (!event.cancelable || event.defaultPrevented) return
    const touch = event.touches[0]
    const hit = findScrollbar(event, touch.clientX, touch.clientY)
    if (!hit) return
    event.preventDefault()
    event.stopPropagation()
    stopDrag()
    drag = { ...hit, identifier: touch.identifier }
    hit.element.dispatchEvent(new Event('mew:scrollbar-drag-start', { bubbles: true }))
    document.addEventListener('touchmove', move, { capture: true, passive: false })
    document.addEventListener('touchend', end, { capture: true, passive: true })
    document.addEventListener('touchcancel', stopDrag, { capture: true, passive: true })
    document.addEventListener('visibilitychange', stopDrag)
    window.addEventListener('blur', stopDrag)
  }

  function pointerDown(event: PointerEvent) {
    if (event.pointerType !== 'touch' || !event.isPrimary || event.defaultPrevented || !event.target || !findScrollbar(event, event.clientX, event.clientY)) return
    // Keep ancestor focus capture while preventing content swipes and long presses.
    const target = event.target
    const block = (next: Event) => { if (next === event) next.stopImmediatePropagation() }
    target.addEventListener('pointerdown', block, { capture: true, once: true })
    setTimeout(() => target.removeEventListener('pointerdown', block, true), 0)
  }

  document.addEventListener('pointerdown', pointerDown, { capture: true, passive: true })
  document.addEventListener('touchstart', start, { capture: true, passive: false })
  return () => {
    stopDrag()
    document.removeEventListener('pointerdown', pointerDown, true)
    document.removeEventListener('touchstart', start, true)
  }
}
