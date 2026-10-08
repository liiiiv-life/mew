import { useEffect, useRef } from 'react'
import { spriteFrameAt, type MewcatSpriteAction, type SpriteStrip } from '../utils/mewcat-sprites'
import { paintSpriteFrame } from '../utils/mewcat-sprite-render'

export function MewcatSprite({ strip, action = 'idle', playing = false, className = '' }: { strip: SpriteStrip; action?: MewcatSpriteAction; playing?: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const svg = ref.current!
    paintSpriteFrame(svg, strip, 0)
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      paintSpriteFrame(svg, strip, spriteFrameAt(action, now - started, strip.frames))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [strip, action, playing])
  return <svg ref={ref} className={`mewcat-sprite ${className}`} viewBox={`0 0 ${strip.width / strip.frames} ${strip.height}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
    <image href={strip.src} width={strip.width} height={strip.height} />
    <g transform={`scale(${strip.width / strip.frames / 48} ${strip.height / 48})`}><path className="mewcat-sprite-hit" d={strip.hitPaths[0]} fill="transparent" /></g>
  </svg>
}
