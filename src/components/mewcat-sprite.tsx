import { motionFrameAt } from '../utils/mewcat-motion'
import { useEffect, useRef } from 'react'
import { MEWCAT_CYCLE_MS, type MewcatAnimation, type SpriteStrip } from '../utils/mewcat-sprites'
import { paintSpriteFrame } from '../utils/mewcat-sprite-render'

export function MewcatSprite({ strip, action = 'idle', playing = false, className = '', duration }: { strip: SpriteStrip; action?: MewcatAnimation; playing?: boolean; className?: string; duration?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const svg = ref.current!
    paintSpriteFrame(svg, strip, 0)
    if (!playing) return
    const cycle = duration ?? MEWCAT_CYCLE_MS[action]
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      paintSpriteFrame(svg, strip, motionFrameAt(action, (now - started) % cycle, strip.frames, cycle))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [strip, action, playing, duration])
  return <svg ref={ref} className={`mewcat-sprite ${className}`} viewBox={`0 0 ${strip.width / strip.frames} ${strip.height}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
    <image href={strip.src} width={strip.width} height={strip.height} />
    <g transform={`scale(${strip.width / strip.frames / 48} ${strip.height / 48})`}><path className="mewcat-sprite-hit" d={strip.hitPaths[0]} fill="transparent" /></g>
  </svg>
}
