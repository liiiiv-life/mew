import { useLayoutEffect, useRef, type RefObject } from 'react'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Follow the moving character without rerendering the app on every animation frame. */
export function useMewcatBubble(anchor: RefObject<HTMLDivElement | null> | undefined, enabled: boolean, preferredWidth = 340) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const bubble = ref.current
    if (!enabled || !anchor || !bubble) return
    let frame = 0
    let previous = ''
    const place = () => {
      const cat = anchor.current
      if (cat?.style.transform) {
        const viewport = window.visualViewport
        const left = (viewport?.offsetLeft ?? 0) + 12
        const top = (viewport?.offsetTop ?? 0) + 12
        const width = Math.max(0, (viewport?.width ?? window.innerWidth) - 24)
        const bottom = top + (viewport?.height ?? window.innerHeight) - 24
        const box = cat.getBoundingClientRect()
        const above = Math.max(0, box.top - top - 10)
        const below = Math.max(0, bottom - box.bottom - 10)
        const naturalHeight = (bubble.firstElementChild?.scrollHeight ?? bubble.scrollHeight) + 2
        const side = naturalHeight <= above || above >= below ? 'above' : 'below'
        const available = side === 'above' ? above : below
        const bubbleWidth = Math.min(preferredWidth, width)
        bubble.style.width = `${bubbleWidth}px`
        bubble.style.maxHeight = `${Math.max(0, available - 2)}px`
        const center = box.left + box.width / 2
        const x = clamp(center - bubbleWidth / 2, left, left + width - bubbleWidth)
        const y = side === 'above' ? box.top - 10 - bubble.offsetHeight : box.bottom + 10
        const tail = clamp(center - x - 1, 18, bubbleWidth - 20)
        const next = `${x}:${y}:${tail}:${side}`
        if (next !== previous) {
          bubble.style.left = `${x}px`
          bubble.style.top = `${y}px`
          bubble.style.right = 'auto'
          bubble.style.bottom = 'auto'
          bubble.style.setProperty('--mewcat-tail-x', `${tail}px`)
          bubble.dataset.placement = side
          bubble.style.visibility = 'visible'
          previous = next
        }
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => {
      cancelAnimationFrame(frame)
      for (const name of ['left', 'top', 'right', 'bottom', 'width', 'max-height', 'visibility', '--mewcat-tail-x']) bubble.style.removeProperty(name)
      delete bubble.dataset.placement
    }
  }, [anchor, enabled, preferredWidth])
  return ref
}
