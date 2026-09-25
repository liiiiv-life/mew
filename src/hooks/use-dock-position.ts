import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'
import { writeBrowserStorage } from '@mew/ui/browser-storage'

const POSITION_KEY = 'mew:desktop-dock-position'
type Position = { x: number; y: number }

function readPosition(): Position | null {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null')
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null
  } catch { return null }
}

export function useDockPosition(root: RefObject<HTMLElement | null>, hidden: boolean, portalTarget?: HTMLElement | null) {
  const [position, setPosition] = useState(readPosition)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [moving, setMoving] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number; start: Position; original: Position | null; next: Position; handle: HTMLButtonElement } | null>(null)
  const cancel = () => {
    const current = drag.current
    if (!current) return
    drag.current = null
    setPosition(current.original)
    setMoving(false)
    if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id)
  }
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [root, hidden, portalTarget])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    document.addEventListener('visibilitychange', cancel)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('resize', cancel)
      document.removeEventListener('visibilitychange', cancel)
    }
  }, [])
  useEffect(() => { cancel() }, [hidden, portalTarget])
  const clamp = (next: Position): Position => ({
    x: Math.max(8, Math.min(next.x, window.innerWidth - size.width - 8)),
    y: Math.max(8, Math.min(next.y, window.innerHeight - size.height - 8)),
  })
  const save = (next: Position) => { setPosition(next); writeBrowserStorage(POSITION_KEY, JSON.stringify(next)) }
  return {
    moving,
    style: {
      '--dock-width': `${size.width}px`, '--dock-height': `${size.height}px`,
      ...(position ? { '--dock-x': `${position.x}px`, '--dock-y': `${position.y}px` } : {}),
    } as CSSProperties,
    handleProps: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        event.stopPropagation()
        if (!event.isPrimary) { cancel(); return }
        if (event.button !== 0 || !root.current || drag.current) return
        const box = root.current.getBoundingClientRect()
        const start = { x: box.x, y: box.y }
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start, original: position, next: start, handle: event.currentTarget }
        event.currentTarget.setPointerCapture(event.pointerId)
        setMoving(true)
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const current = drag.current
        if (!current || current.id !== event.pointerId) return
        current.next = clamp({ x: current.start.x + event.clientX - current.x, y: current.start.y + event.clientY - current.y })
        setPosition(current.next)
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        const current = drag.current
        if (!current || current.id !== event.pointerId) return
        drag.current = null
        save(current.next)
        setMoving(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !root.current || drag.current) return
        event.preventDefault()
        event.stopPropagation()
        const box = root.current.getBoundingClientRect(), step = event.shiftKey ? 32 : 8
        save(clamp({ x: box.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: box.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }))
      },
    },
  }
}
