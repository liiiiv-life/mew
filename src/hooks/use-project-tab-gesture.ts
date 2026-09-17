import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ProjectTabDrop } from '../../shared/project-tab-groups'

type Drag = { path: string; x: number; y: number; target: ProjectTabDrop | null }

/** Hold to move; short swipes remain native scrolling, including on touch screens. */
export function useProjectTabGesture({ enabled, onMenu, hitTest, onDrop }: {
  enabled: boolean
  onMenu: (path: string) => void
  hitTest: (x: number, y: number) => ProjectTabDrop | null
  onDrop: (path: string, target: ProjectTabDrop) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onMenu, hitTest, onDrop })
  useLayoutEffect(() => { callbacks.current = { onMenu, hitTest, onDrop } })
  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClickUntil = useRef(0)
  const holding = useRef(false)

  useEffect(() => {
    const strip = ref.current
    if (!strip || !enabled) return
    let gesture: { path: string; id: number; touch: boolean; x: number; y: number; startX: number; startY: number; started: number; dragging: boolean; moved: boolean } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame = 0

    function reset() {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      gesture = null
      holding.current = false
      setDrag(null)
      document.removeEventListener('pointermove', pointerMove)
      document.removeEventListener('pointerup', pointerEnd)
      document.removeEventListener('pointercancel', pointerCancel)
      document.removeEventListener('touchstart', additionalTouch)
      document.removeEventListener('touchmove', touchMove)
      document.removeEventListener('touchend', touchEnd)
      document.removeEventListener('touchcancel', cancel)
      document.removeEventListener('keydown', keyDown, true)
      document.removeEventListener('visibilitychange', visibilityChange)
      window.removeEventListener('blur', cancel)
    }
    function cancel() {
      if (gesture) suppressClickUntil.current = Date.now() + 600
      reset()
    }
    function update() {
      if (!gesture?.dragging) return
      const { path, x, y } = gesture
      const target = callbacks.current.hitTest(x, y)
      setDrag(previous => previous && previous.path === path && previous.x === x && previous.y === y && JSON.stringify(previous.target) === JSON.stringify(target) ? previous : { path, x, y, target })
    }
    function autoScroll() {
      if (!gesture?.dragging || !strip) return
      const box = strip.getBoundingClientRect()
      if (gesture.y >= box.top && gesture.y <= box.bottom && gesture.x >= box.left && gesture.x <= box.right) {
        const delta = gesture.x < box.left + 28 ? -7 : gesture.x > box.right - 28 ? 7 : 0
        if (delta) { strip.scrollLeft += delta; update() }
      }
      frame = requestAnimationFrame(autoScroll)
    }
    function start(target: EventTarget | null, id: number, touch: boolean, x: number, y: number) {
      if (gesture) { cancel(); return }
      const button = target instanceof Element ? target.closest<HTMLElement>('[data-project-drag]') : null
      const path = button?.dataset.projectDrag
      if (!path) return
      holding.current = true
      suppressClickUntil.current = 0
      gesture = { path, id, touch, x, y, startX: x, startY: y, started: Date.now(), dragging: false, moved: false }
      document.addEventListener('pointermove', pointerMove)
      document.addEventListener('pointerup', pointerEnd)
      document.addEventListener('pointercancel', pointerCancel)
      document.addEventListener('touchstart', additionalTouch, { passive: true })
      document.addEventListener('touchmove', touchMove, { passive: false })
      document.addEventListener('touchend', touchEnd, { passive: false })
      document.addEventListener('touchcancel', cancel)
      document.addEventListener('keydown', keyDown, true)
      document.addEventListener('visibilitychange', visibilityChange)
      window.addEventListener('blur', cancel)
      timer = setTimeout(() => {
        if (!gesture) return
        gesture.dragging = true
        suppressClickUntil.current = Date.now() + 600
        update()
        frame = requestAnimationFrame(autoScroll)
      }, 1000)
    }
    function move(x: number, y: number, event: Event) {
      if (!gesture) return
      const distance = Math.hypot(x - gesture.startX, y - gesture.startY)
      if (!gesture.dragging) { if (distance >= 10) cancel(); return }
      event.preventDefault()
      gesture.moved ||= distance >= 10
      gesture.x = x
      gesture.y = y
      update()
    }
    function end(x: number, y: number, event: Event) {
      if (!gesture) return
      const { path, dragging, moved, started } = gesture
      const menu = !dragging && Date.now() - started >= 500
      const target = dragging && moved ? callbacks.current.hitTest(x, y) : null
      if (dragging || menu) {
        event.preventDefault()
        suppressClickUntil.current = Date.now() + 600
      }
      reset()
      if (target) callbacks.current.onDrop(path, target)
      else if (menu) callbacks.current.onMenu(path)
    }
    function pointerStart(event: PointerEvent) {
      if (event.pointerType !== 'touch' && event.button === 0) start(event.target, event.pointerId, false, event.clientX, event.clientY)
    }
    function pointerMove(event: PointerEvent) { if (gesture && !gesture.touch && event.pointerId === gesture.id) move(event.clientX, event.clientY, event) }
    function pointerEnd(event: PointerEvent) { if (gesture && !gesture.touch && event.pointerId === gesture.id) end(event.clientX, event.clientY, event) }
    function pointerCancel(event: PointerEvent) { if (gesture && !gesture.touch && event.pointerId === gesture.id) cancel() }
    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 1) { cancel(); return }
      const touch = event.touches[0]
      start(event.target, touch.identifier, true, touch.clientX, touch.clientY)
    }
    function additionalTouch(event: TouchEvent) { if (event.touches.length > 1) cancel() }
    function touchMove(event: TouchEvent) {
      if (!gesture?.touch) return
      const touch = Array.from(event.touches).find(t => t.identifier === gesture?.id)
      if (touch) move(touch.clientX, touch.clientY, event)
    }
    function touchEnd(event: TouchEvent) {
      if (!gesture?.touch) return
      const touch = Array.from(event.changedTouches).find(t => t.identifier === gesture?.id)
      if (touch) end(touch.clientX, touch.clientY, event)
    }
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel() }
    }
    function visibilityChange() { if (document.hidden) cancel() }
    strip.addEventListener('pointerdown', pointerStart)
    strip.addEventListener('touchstart', touchStart, { passive: true })
    return () => {
      reset()
      strip.removeEventListener('pointerdown', pointerStart)
      strip.removeEventListener('touchstart', touchStart)
    }
  }, [enabled])

  return { ref, drag, isHolding: () => holding.current, consumeClick: () => Date.now() < suppressClickUntil.current }
}
