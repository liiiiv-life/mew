import { useEffect, useRef } from 'react'
import type { MewcatSkin } from '../utils/mewcatSkin'

const CAT_WIDTH = 48
const CAT_HEIGHT = 48
const MAX_THROW_SPEED = 1_400
const THROW_SPEED_SCALE = 0.5
const WALL_BOUNCE = 0.5
type Activity = 'idle' | 'walk' | 'run' | 'love' | 'struggle' | 'fall' | 'land'
const animation: Record<Activity, { row: number; frames: number[]; frameMs: number }> = {
  idle: { row: 6, frames: [0, 1, 2, 3], frameMs: 220 }, walk: { row: 8, frames: [0, 1, 2, 3, 4, 5, 6, 7], frameMs: 110 }, run: { row: 9, frames: [0, 1, 2, 3], frameMs: 85 }, love: { row: 7, frames: [0, 1, 2, 3], frameMs: 140 }, struggle: { row: 15, frames: [0, 1, 2, 3, 4, 5], frameMs: 100 }, fall: { row: 9, frames: [1, 2], frameMs: 90 }, land: { row: 9, frames: [2, 3], frameMs: 120 },
}
function floor() {
  const viewport = window.visualViewport
  const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
  // 원본 스프라이트 프레임 하단에 투명 여백 약 5px(화면 기준 7.5px) 존재 → 그만큼 바닥을 내린다
  return Math.max(0, bottom - CAT_HEIGHT + 7.5)
}
function nextActivity(): Exclude<Activity, 'love' | 'struggle' | 'fall' | 'land'> { const options: Array<Exclude<Activity, 'love' | 'struggle' | 'fall' | 'land'>> = ['idle', 'walk', 'run']; return options[Math.floor(Math.random() * options.length)] }

/** 화면 맨 아래를 자유롭게 오가며, 눌러서 잠깐 놀아 줄 수 있는 Mew의 고양이. */
export function Mewcat({ skin }: { skin: MewcatSkin | null }) {
  if (skin === null) return null
  return <MewcatActive />
}

/** 레포에서 직접 만든 단순 벡터 마크. 외부 이미지·폰트·스프라이트에 의존하지 않는다. */
export function MewcatMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <path d="M9 20 13 8l8 6a17 17 0 0 1 6 0l8-6 4 12v12a15 15 0 0 1-30 0Z" fill="currentColor" />
      <path d="m14 13 1.5 5M34 13l-1.5 5" stroke="var(--color-surface)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="25" r="2" fill="var(--color-surface)" />
      <circle cx="30" cy="25" r="2" fill="var(--color-surface)" />
      <path d="M24 29v4m-5 0c2 2 8 2 10 0" fill="none" stroke="var(--color-surface)" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 30 3 28m5 6-5 2m37-6 5-2m-5 8 5 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function MewcatActive() {
  const catRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const cat = catRef.current
    if (!cat) return
    let x = Math.max(0, Math.min(window.innerWidth - CAT_WIDTH, window.innerWidth * 0.3)); let y = floor(); let direction = 1; let activity: Activity = nextActivity(); let activityStarted = performance.now(); let activityEnds = activityStarted + 1_000; let horizontalVelocity = 0; let verticalVelocity = 0; let lastFrame = activityStarted; let animationFrame = 0; let pointerId: number | undefined; let dragging = false; let grabStartY = 0; let lastPointerX = 0; let lastPointerY = 0; let lastPointerAt = 0
    const chooseRoam = (now: number) => { activity = nextActivity(); activityStarted = now; activityEnds = now + (activity === 'idle' ? 900 + Math.random() * 1_800 : activity === 'walk' ? 2_200 + Math.random() * 2_400 : 1_000 + Math.random() * 1_500) }
    const setActivity = (next: Activity, now: number, duration = 0) => { activity = next; activityStarted = now; activityEnds = duration ? now + duration : 0 }
    const render = () => { cat.dataset.activity = activity; cat.style.transform = `translate3d(${x}px, ${y}px, 0) scaleX(${direction < 0 ? -1 : 1})` }
    const tick = (now: number) => { const delta = Math.min(0.05, (now - lastFrame) / 1_000); lastFrame = now; const maxX = Math.max(0, window.innerWidth - CAT_WIDTH); const ground = floor(); if (activity === 'walk' || activity === 'run') { x += direction * (activity === 'walk' ? 48 : 115) * delta; if (x <= 0 || x >= maxX) { x = Math.max(0, Math.min(maxX, x)); direction *= -1 } } else if (activity === 'fall') { x += horizontalVelocity * delta; verticalVelocity += 1_600 * delta; y += verticalVelocity * delta; if (x <= 0 || x >= maxX) { x = Math.max(0, Math.min(maxX, x)); horizontalVelocity = -horizontalVelocity * WALL_BOUNCE; direction = horizontalVelocity < 0 ? -1 : 1 } if (y < 0) { y = 0; verticalVelocity = Math.max(0, -verticalVelocity * WALL_BOUNCE) } if (y >= ground) { y = ground; horizontalVelocity = 0; verticalVelocity = 0; setActivity('land', now, animation.land.frames.length * animation.land.frameMs) } } else if (activity !== 'struggle') y = ground; if (activityEnds && now >= activityEnds) chooseRoam(now); render(); animationFrame = window.requestAnimationFrame(tick) }
    // 모바일 키보드는 layout viewport보다 VisualViewport를 먼저 바꾼다. 다음 행동 전환을
    // 기다리지 않고, resize/scroll 이벤트가 오는 즉시 바닥 위치를 다시 그린다.
    const syncViewport = () => {
      const now = performance.now()
      const maxX = Math.max(0, window.innerWidth - CAT_WIDTH)
      const ground = floor()
      x = Math.max(0, Math.min(maxX, x))
      if (dragging) y = Math.min(y, ground)
      else if (activity === 'fall') {
        if (y >= ground) {
          y = ground
          verticalVelocity = 0
          setActivity('land', now, animation.land.frames.length * animation.land.frameMs)
        }
      } else y = ground
      render()
    }
    const onPointerDown = (event: PointerEvent) => { const now = performance.now(); pointerId = event.pointerId; dragging = false; horizontalVelocity = 0; verticalVelocity = 0; grabStartY = event.clientY; lastPointerX = event.clientX; lastPointerY = event.clientY; lastPointerAt = now; setActivity('idle', now); cat.setPointerCapture(event.pointerId) }
    const onPointerMove = (event: PointerEvent) => { if (event.pointerId !== pointerId) return; const now = performance.now(); const elapsed = Math.max(0.01, (now - lastPointerAt) / 1_000); const nextHorizontalVelocity = (event.clientX - lastPointerX) / elapsed; const nextVerticalVelocity = (event.clientY - lastPointerY) / elapsed; horizontalVelocity = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, horizontalVelocity * 0.35 + nextHorizontalVelocity * 0.65)); verticalVelocity = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, verticalVelocity * 0.35 + nextVerticalVelocity * 0.65)); lastPointerX = event.clientX; lastPointerY = event.clientY; lastPointerAt = now; const verticalDistance = event.clientY - grabStartY; if (verticalDistance < -4) { if (!dragging) { dragging = true; setActivity('struggle', now) }; const maxX = Math.max(0, window.innerWidth - CAT_WIDTH); x = Math.max(0, Math.min(maxX, event.clientX - CAT_WIDTH / 2)); y = Math.max(0, Math.min(floor(), event.clientY - CAT_HEIGHT / 2)); if (horizontalVelocity) direction = horizontalVelocity < 0 ? -1 : 1 } else if (verticalDistance > 4) { dragging = false; horizontalVelocity = 0; verticalVelocity = 0; y = floor(); if (activity !== 'love') setActivity('love', now, animation.love.frames.length * animation.love.frameMs) } }
    const onPointerUp = (event: PointerEvent) => { if (event.pointerId !== pointerId) return; if (cat.hasPointerCapture(event.pointerId)) cat.releasePointerCapture(event.pointerId); pointerId = undefined; if (dragging) { dragging = false; horizontalVelocity *= THROW_SPEED_SCALE; verticalVelocity *= THROW_SPEED_SCALE; setActivity('fall', performance.now()) } else setActivity('love', performance.now(), animation.love.frames.length * animation.love.frameMs) }
    const viewport = window.visualViewport
    cat.addEventListener('pointerdown', onPointerDown); cat.addEventListener('pointermove', onPointerMove); cat.addEventListener('pointerup', onPointerUp); cat.addEventListener('pointercancel', onPointerUp); window.addEventListener('resize', syncViewport); viewport?.addEventListener('resize', syncViewport); viewport?.addEventListener('scroll', syncViewport); animationFrame = window.requestAnimationFrame(tick)
    return () => { window.cancelAnimationFrame(animationFrame); cat.removeEventListener('pointerdown', onPointerDown); cat.removeEventListener('pointermove', onPointerMove); cat.removeEventListener('pointerup', onPointerUp); cat.removeEventListener('pointercancel', onPointerUp); window.removeEventListener('resize', syncViewport); viewport?.removeEventListener('resize', syncViewport); viewport?.removeEventListener('scroll', syncViewport) }
  }, [])
  return <div ref={catRef} className="mewcat text-accent" aria-label="Mewcat"><MewcatMark className="mewcat-mark" /></div>
}
