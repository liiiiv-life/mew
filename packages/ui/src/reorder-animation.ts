import { useEffect, useLayoutEffect, useRef } from 'react'

export const REORDER_DURATION = 180
export const REORDER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

const animations = new WeakMap<HTMLElement, Animation>()

/** Hit testing uses the destination layout, independent of an in-flight visual shift. */
export function reorderLayoutRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect()
  if (!animations.has(element)) return rect
  const transform = getComputedStyle(element).transform
  const offset = transform === 'none' ? { e: 0, f: 0 } : new DOMMatrixReadOnly(transform)
  return new DOMRect(rect.x - offset.e, rect.y - offset.f, rect.width, rect.height)
}

/** Capture just before changing order; animate after React commits the new layout. */
export function useReorderAnimation(elements: () => Iterable<HTMLElement>): () => void {
  const elementsRef = useRef(elements)
  elementsRef.current = elements
  const pending = useRef<Map<HTMLElement, DOMRect> | null>(null)
  const owned = useRef(new Map<HTMLElement, Animation>())

  useLayoutEffect(() => {
    const before = pending.current
    pending.current = null
    if (!before) return
    // Batch geometry reads before cancelling or starting animations.
    const after = [...elementsRef.current()].map(element => [element, reorderLayoutRect(element)] as const)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const [element, rect] of after) {
      const old = before.get(element)
      const previous = owned.current.get(element)
      previous?.cancel()
      owned.current.delete(element)
      animations.delete(element)
      if (!old || reduced || !element.animate) continue
      const dx = old.x - rect.x, dy = old.y - rect.y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      const animation = element.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: REORDER_DURATION, easing: REORDER_EASING })
      owned.current.set(element, animation)
      animations.set(element, animation)
      animation.onfinish = animation.oncancel = () => {
        if (owned.current.get(element) !== animation) return
        owned.current.delete(element)
        animations.delete(element)
      }
    }
  })

  useEffect(() => {
    const running = owned.current
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cancel = () => {
      for (const [element, animation] of running) { animation.cancel(); animations.delete(element) }
      running.clear()
    }
    const change = () => { if (media.matches) cancel() }
    media.addEventListener('change', change)
    return () => { media.removeEventListener('change', change); cancel() }
  }, [])

  return () => {
    pending.current = new Map([...elementsRef.current()].map(element => [element, element.getBoundingClientRect()]))
  }
}
