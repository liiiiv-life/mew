import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { DesktopIcon } from './desktop-stick.tsx'
import { desktopLocalPoint, rotateDelta, type Rotation } from '../utils/desktop-view.ts'

export function DesktopFloating({ children, label, className, root, stage, rotation = 0 }: {
  children: ReactNode; label: string; className: string
  root: RefObject<HTMLDivElement | null>; stage: RefObject<HTMLDivElement | null>
  rotation?: Rotation
}) {
  useUiLocale()
  const element = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const clamp = useCallback((x: number, y: number) => {
    const area = root.current!, viewport = stage.current!, bar = element.current!
    return { x: Math.max(8, Math.min(area.clientWidth - bar.offsetWidth - 8, x)), y: Math.max(viewport.offsetTop + 8, Math.min(viewport.offsetTop + viewport.clientHeight - bar.offsetHeight - 8, y)) }
  }, [root, stage])
  useEffect(() => {
    const observer = new ResizeObserver(() => setPosition(previous => previous ? clamp(previous.x, previous.y) : null))
    observer.observe(stage.current!); observer.observe(element.current!)
    return () => observer.disconnect()
  }, [stage, clamp])
  const origin = () => {
    return { left: element.current!.offsetLeft, top: element.current!.offsetTop }
  }
  return <div ref={element} className={className} role="group" aria-label={label} style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}>
    {children}
    <button className="desktop-handle" aria-label={uiText("{p0} 위치 이동", { p0: label === uiText("원격 데스크톱 조이스틱") ? uiText("조이스틱") : label })} title={uiText("핸들을 끌거나 방향키로 이동")} onContextMenu={event => event.preventDefault()}
      onPointerDown={event => { if (drag.current) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, ...desktopLocalPoint(root.current!, event.clientX, event.clientY, rotation), ...origin() } }}
      onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) { const point = desktopLocalPoint(root.current!, event.clientX, event.clientY, rotation); setPosition(clamp(start.left + point.x - start.x, start.top + point.y - start.y)) } }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => { if (!event.key.startsWith('Arrow')) return; event.preventDefault(); event.stopPropagation(); const start = origin(); const delta = rotateDelta(event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0, event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0, ((360 - rotation) % 360) as Rotation); setPosition(clamp(start.left + delta.x, start.top + delta.y)) }}><DesktopIcon kind="handle" /></button>
  </div>
}
