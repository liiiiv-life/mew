import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { REORDER_DURATION, REORDER_EASING } from '@mew/ui'

type Snapshot = { from: string; to: string; rows: Map<string, DOMRect>; scrollTop: number }

/** Keep a move snapshot until the asynchronous tree refresh actually changes paths. */
export function useTreeMoveAnimation(root: RefObject<HTMLElement | null>) {
  const pending = useRef<Snapshot | null>(null)
  const running = useRef(new Map<HTMLElement, Animation>())
  const rows = () => [...root.current?.querySelectorAll<HTMLElement>('[data-path]') ?? []]

  useLayoutEffect(() => {
    const snapshot = pending.current
    if (!snapshot || !root.current) return
    const elements = rows()
    // An unrelated render (drop highlight, focus, etc.) must not consume the snapshot.
    if (elements.some(el => el.dataset.path === snapshot.from)) return
    pending.current = null
    const destinations = elements.map(el => [el, el.getBoundingClientRect()] as const)
    for (const animation of running.current.values()) animation.cancel()
    running.current.clear()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const scrollDelta = root.current.scrollTop - snapshot.scrollTop
    for (const [element, rect] of destinations) {
      const path = element.dataset.path!
      const oldPath = path === snapshot.to || path.startsWith(`${snapshot.to}/`)
        ? snapshot.from + path.slice(snapshot.to.length) : path
      const before = snapshot.rows.get(oldPath)
      if (!before || !element.animate) continue
      const dx = before.x - rect.x, dy = before.y - rect.y - scrollDelta
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      const animation = element.animate([
        { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' },
      ], { duration: REORDER_DURATION, easing: REORDER_EASING })
      running.current.set(element, animation)
      animation.onfinish = animation.oncancel = () => {
        if (running.current.get(element) === animation) running.current.delete(element)
      }
    }
  })

  useEffect(() => {
    const animations = running.current
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cancel = () => { for (const animation of animations.values()) animation.cancel(); animations.clear() }
    const change = () => { if (media.matches) { pending.current = null; cancel() } }
    media.addEventListener('change', change)
    return () => { media.removeEventListener('change', change); cancel() }
  }, [])

  return (from: string, to: string) => {
    pending.current = {
      from, to, scrollTop: root.current?.scrollTop ?? 0,
      rows: new Map(rows().map(el => [el.dataset.path!, el.getBoundingClientRect()])),
    }
  }
}
