import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from 'react'
type Geometry = { x: number; y: number; width: number; height: number }
const initial: Geometry = { x: 24, y: 24, width: 420, height: 480 }
function load(key: string): Geometry {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (saved && Object.values(saved).every(value => typeof value === 'number' && Number.isFinite(value)) && saved.width >= 240 && saved.height >= 160 && typeof saved.x === 'number' && typeof saved.y === 'number') return saved
  } catch { /* defaults */ }
  return initial
}
let front = 60
export function useFloatingPanel(key: string, host: HTMLElement | null, enabled = true) {
  const [geometry, setGeometry] = useState(() => ({ key, rect: load(key) }))
  const rect = geometry.key === key ? geometry.rect : load(key)
  const rectRef = useRef(rect)
  rectRef.current = rect
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [layer, setLayer] = useState(60)
  const drag = useRef<{ pointer: number; x: number; y: number; mode: 'move' | 'resize'; rect: Geometry } | null>(null)
  useEffect(() => {
    if (!host || !enabled) return
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(host); measure()
    return () => observer.disconnect()
  }, [host, enabled])
  const clamp = (value: Geometry) => {
    const width = Math.min(Math.max(240, value.width), Math.max(1, size.width))
    const height = Math.min(Math.max(160, value.height), Math.max(1, size.height))
    return { width, height, x: Math.max(0, Math.min(value.x, size.width - width)), y: Math.max(0, Math.min(value.y, size.height - height)) }
  }
  const update = (value: Geometry) => {
    const next = clamp(value)
    setGeometry({ key, rect: next })
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* session-only geometry */ }
  }
  const start = (event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') => {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode, rect: clamp(rectRef.current) }
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current
    if (!active || active.pointer !== event.pointerId) return
    const dx = event.clientX - active.x, dy = event.clientY - active.y
    update(active.mode === 'move' ? { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy } : { ...active.rect, width: active.rect.width + dx, height: active.rect.height + dy })
  }
  const end = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const controls = (mode: 'move' | 'resize') => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => start(event, mode), onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      const dx = event.key === 'ArrowRight' ? 12 : event.key === 'ArrowLeft' ? -12 : 0
      const dy = event.key === 'ArrowDown' ? 12 : event.key === 'ArrowUp' ? -12 : 0
      if (!dx && !dy) return
      event.preventDefault()
      const current = clamp(rectRef.current)
      update(mode === 'move' ? { ...current, x: current.x + dx, y: current.y + dy } : { ...current, width: current.width + dx, height: current.height + dy })
    },
  })
  const bounded = clamp(rect)
  return { style: { position: 'absolute', left: bounded.x, top: bounded.y, width: bounded.width, height: bounded.height, zIndex: layer } as CSSProperties, focus: () => setLayer(++front), controls }
}
