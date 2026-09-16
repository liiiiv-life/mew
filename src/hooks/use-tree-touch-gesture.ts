import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const MENU_HOLD_MS = 500
const DRAG_HOLD_MS = 1000
const MOVE_TOLERANCE_PX = 12

/** Touch owns its hold timing; mouse input keeps the browser's native HTML drag. */
export function useTreeTouchGesture({ enabled, onMenu, onDragCancel }: {
  enabled: boolean
  onMenu: (x: number, y: number) => void
  onDragCancel: () => void
}) {
  const [element, setElement] = useState<HTMLButtonElement | null>(null)
  const callbacks = useRef({ onMenu, onDragCancel })
  useLayoutEffect(() => { callbacks.current = { onMenu, onDragCancel } })
  const touchInput = useRef(false)
  const suppressClickUntil = useRef(0)

  useEffect(() => {
    if (!element || !enabled) return
    const source = element
    let gesture: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean; phase: 'pending' | 'menu' | 'drag' } | null = null
    let menuTimer: ReturnType<typeof setTimeout> | undefined
    let dragTimer: ReturnType<typeof setTimeout> | undefined
    let data: DataTransfer | null = null
    let target: Element | null = null
    let ghost: HTMLDivElement | null = null
    let frame = 0

    function dispatch(type: string, to: Element | null) {
      return to?.dispatchEvent(new DragEvent(type, {
        bubbles: true, cancelable: true, dataTransfer: data,
        clientX: gesture?.x, clientY: gesture?.y,
      })) === false
    }

    function clearTimers() {
      clearTimeout(menuTimer)
      clearTimeout(dragTimer)
    }

    function updateTarget() {
      if (!gesture) return false
      const next = document.elementFromPoint(gesture.x, gesture.y)
      if (next !== target) {
        dispatch('dragleave', target)
        target = next
        dispatch('dragenter', target)
      }
      if (ghost) {
        ghost.style.left = `${Math.max(0, Math.min(gesture.x + 12, window.innerWidth - ghost.offsetWidth))}px`
        ghost.style.top = `${Math.max(0, gesture.y - 40)}px`
      }
      return dispatch('dragover', target)
    }

    function autoScroll() {
      if (gesture?.phase !== 'drag') return
      // Native touch scrolling is blocked only during a drag. Keep edge scrolling
      // available so a folder outside the viewport can still be reached.
      for (let node = target; node instanceof HTMLElement; node = node.parentElement) {
        if (node.scrollHeight <= node.clientHeight || !/auto|scroll/.test(getComputedStyle(node).overflowY)) continue
        const rect = node.getBoundingClientRect()
        const delta = gesture.y < rect.top + 32 ? -8 : gesture.y > rect.bottom - 32 ? 8 : 0
        if (delta) { node.scrollTop += delta; updateTarget() }
        break
      }
      frame = requestAnimationFrame(autoScroll)
    }

    function reset() {
      clearTimers()
      document.removeEventListener('touchstart', additionalTouch)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', cancel)
      document.removeEventListener('keydown', keyDown)
      document.removeEventListener('visibilitychange', visibilityChange)
      window.removeEventListener('blur', cancel)
      cancelAnimationFrame(frame)
      if (gesture?.phase === 'drag') {
        dispatch('dragleave', target)
        dispatch('dragend', source)
        if (!source.isConnected) callbacks.current.onDragCancel()
      }
      ghost?.remove()
      ghost = null
      source.removeAttribute('data-touch-dragging')
      gesture = null
      target = null
      data = null
    }

    function cancel() {
      if (gesture) suppressClickUntil.current = Date.now() + 500
      reset()
    }

    function start(event: TouchEvent) {
      if (event.touches.length !== 1) { cancel(); return }
      reset()
      touchInput.current = true
      source.draggable = false
      suppressClickUntil.current = 0
      document.addEventListener('touchstart', additionalTouch, { passive: true })
      document.addEventListener('touchmove', move, { passive: false })
      document.addEventListener('touchend', end, { passive: false })
      document.addEventListener('touchcancel', cancel)
      document.addEventListener('keydown', keyDown)
      document.addEventListener('visibilitychange', visibilityChange)
      window.addEventListener('blur', cancel)
      const touch = event.touches[0]
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, startX: touch.clientX, startY: touch.clientY, moved: false, phase: 'pending' }
      menuTimer = setTimeout(() => { if (gesture) gesture.phase = 'menu' }, MENU_HOLD_MS)
      dragTimer = setTimeout(() => {
        if (!gesture) return
        data = new DataTransfer()
        if (dispatch('dragstart', source)) { cancel(); return }
        gesture.phase = 'drag'
        source.dataset.touchDragging = 'true'
        ghost = document.createElement('div')
        ghost.setAttribute('aria-hidden', 'true')
        ghost.textContent = source.textContent
        ghost.className = 'pointer-events-none fixed z-[1100] max-w-60 truncate rounded border border-accent bg-surface-raised px-2 py-1 text-sm text-ink'
        document.body.append(ghost)
        updateTarget()
        frame = requestAnimationFrame(autoScroll)
      }, DRAG_HOLD_MS)
    }

    function move(event: TouchEvent) {
      if (!gesture) return
      if (event.touches.length !== 1) { cancel(); return }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture?.id)
      if (!touch) return
      if (gesture.phase !== 'drag') {
        if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) >= MOVE_TOLERANCE_PX) cancel()
        return
      }
      event.preventDefault()
      gesture.moved ||= Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY) >= MOVE_TOLERANCE_PX
      gesture.x = touch.clientX
      gesture.y = touch.clientY
      updateTarget()
    }

    function end(event: TouchEvent) {
      if (!gesture) return
      const touch = Array.from(event.changedTouches).find(item => item.identifier === gesture?.id)
      if (!touch) return
      const phase = gesture.phase
      if (phase !== 'pending') {
        event.preventDefault()
        event.stopPropagation()
        suppressClickUntil.current = Date.now() + 500
      }
      if (phase === 'drag') {
        gesture.x = touch.clientX
        gesture.y = touch.clientY
        // Holding still only arms a drag; it must never move a subproject file
        // to a containing tree's root just because the finger was released.
        if (gesture.moved && updateTarget()) dispatch('drop', target)
      }
      reset()
      if (phase === 'menu') callbacks.current.onMenu(touch.clientX, touch.clientY)
    }

    function additionalTouch(event: TouchEvent) { if (event.touches.length > 1) cancel() }
    function keyDown(event: KeyboardEvent) { if (event.key === 'Escape') cancel() }
    function visibilityChange() { if (document.hidden) cancel() }
    // React's touch listeners are passive. Real non-passive listeners must cancel
    // scrolling/click generation after a hold without disabling normal swipes.
    source.addEventListener('touchstart', start, { passive: true })
    return () => {
      reset()
      source.removeEventListener('touchstart', start)
    }
  }, [enabled, element])

  return {
    ref: setElement,
    onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
      touchInput.current = event.pointerType === 'touch'
      event.currentTarget.draggable = enabled && !touchInput.current
      suppressClickUntil.current = 0
    },
    isTouchInput: () => touchInput.current,
    consumeClick: () => Date.now() < suppressClickUntil.current,
  }
}
