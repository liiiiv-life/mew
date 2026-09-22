import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { DesktopIcon } from './desktop-stick.tsx'

export function DesktopFloating({ children, label, className, root, stage }: {
  children: ReactNode; label: string; className: string
  root: RefObject<HTMLDivElement | null>; stage: RefObject<HTMLDivElement | null>
}) {
  const element = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const clamp = useCallback((x: number, y: number) => {
    const area = root.current!.getBoundingClientRect(), viewport = stage.current!.getBoundingClientRect(), bar = element.current!.getBoundingClientRect()
    return { x: Math.max(8, Math.min(area.width - bar.width - 8, x)), y: Math.max(viewport.top - area.top + 8, Math.min(viewport.bottom - area.top - bar.height - 8, y)) }
  }, [root, stage])
  useEffect(() => {
    const observer = new ResizeObserver(() => setPosition(previous => previous ? clamp(previous.x, previous.y) : null))
    observer.observe(stage.current!); observer.observe(element.current!)
    return () => observer.disconnect()
  }, [stage, clamp])
  const origin = () => {
    const rect = element.current!.getBoundingClientRect(), area = root.current!.getBoundingClientRect()
    return { left: rect.left - area.left, top: rect.top - area.top }
  }
  return <div ref={element} className={className} role="group" aria-label={label} style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}>
    {children}
    <button className="desktop-handle" aria-label={`${label === '원격 데스크톱 조이스틱' ? '조이스틱' : label} 위치 이동`} title="핸들을 끌거나 방향키로 이동" onContextMenu={event => event.preventDefault()}
      onPointerDown={event => { if (drag.current) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...origin() } }}
      onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) setPosition(clamp(start.left + event.clientX - start.x, start.top + event.clientY - start.y)) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => { if (!event.key.startsWith('Arrow')) return; event.preventDefault(); event.stopPropagation(); const start = origin(); setPosition(clamp(start.left + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), start.top + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0))) }}><DesktopIcon kind="handle" /></button>
  </div>
}
