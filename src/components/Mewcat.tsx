import { useEffect, useRef } from 'react'

// 원본 33×32 프레임을 화면에서 1.5배로 표시한다.
const CAT_WIDTH = 49.5
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
export function Mewcat() {
  const catRef = useRef<HTMLDivElement>(null)
  const spriteRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const cat = catRef.current; const sprite = spriteRef.current
    if (!cat || !sprite) return
    let x = Math.max(0, Math.min(window.innerWidth - CAT_WIDTH, window.innerWidth * 0.3)); let y = floor(); let direction = 1; let activity: Activity = nextActivity(); let activityStarted = performance.now(); let activityEnds = activityStarted + 1_000; let horizontalVelocity = 0; let verticalVelocity = 0; let lastFrame = activityStarted; let animationFrame = 0; let pointerId: number | undefined; let dragging = false; let lastPointerX = 0; let lastPointerY = 0; let lastPointerAt = 0
    const chooseRoam = (now: number) => { activity = nextActivity(); activityStarted = now; activityEnds = now + (activity === 'idle' ? 900 + Math.random() * 1_800 : activity === 'walk' ? 2_200 + Math.random() * 2_400 : 1_000 + Math.random() * 1_500) }
    const setActivity = (next: Activity, now: number, duration = 0) => { activity = next; activityStarted = now; activityEnds = duration ? now + duration : 0 }
    const render = (now: number) => { const config = animation[activity]; const frame = config.frames[Math.floor((now - activityStarted) / config.frameMs) % config.frames.length]; sprite.style.backgroundPosition = `${-frame * CAT_WIDTH}px ${-config.row * CAT_HEIGHT}px`; cat.style.transform = `translate3d(${x}px, ${y}px, 0) scaleX(${direction < 0 ? -1 : 1})` }
    const tick = (now: number) => { const delta = Math.min(0.05, (now - lastFrame) / 1_000); lastFrame = now; const maxX = Math.max(0, window.innerWidth - CAT_WIDTH); const ground = floor(); if (activity === 'walk' || activity === 'run') { x += direction * (activity === 'walk' ? 48 : 115) * delta; if (x <= 0 || x >= maxX) { x = Math.max(0, Math.min(maxX, x)); direction *= -1 } } else if (activity === 'fall') { x += horizontalVelocity * delta; verticalVelocity += 1_600 * delta; y += verticalVelocity * delta; if (x <= 0 || x >= maxX) { x = Math.max(0, Math.min(maxX, x)); horizontalVelocity = -horizontalVelocity * WALL_BOUNCE; direction = horizontalVelocity < 0 ? -1 : 1 } if (y < 0) { y = 0; verticalVelocity = Math.max(0, -verticalVelocity * WALL_BOUNCE) } if (y >= ground) { y = ground; horizontalVelocity = 0; verticalVelocity = 0; setActivity('land', now, animation.land.frames.length * animation.land.frameMs) } } else if (activity !== 'struggle') y = ground; if (activityEnds && now >= activityEnds) chooseRoam(now); render(now); animationFrame = window.requestAnimationFrame(tick) }
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
      render(now)
    }
    const onPointerDown = (event: PointerEvent) => { const caughtInAir = activity === 'fall'; const now = performance.now(); pointerId = event.pointerId; dragging = caughtInAir; horizontalVelocity = 0; verticalVelocity = 0; lastPointerX = event.clientX; lastPointerY = event.clientY; lastPointerAt = now; setActivity(caughtInAir ? 'struggle' : 'idle', now); cat.setPointerCapture(event.pointerId) }
    const onPointerMove = (event: PointerEvent) => { if (event.pointerId !== pointerId) return; const now = performance.now(); const elapsed = Math.max(0.01, (now - lastPointerAt) / 1_000); const nextHorizontalVelocity = (event.clientX - lastPointerX) / elapsed; const nextVerticalVelocity = (event.clientY - lastPointerY) / elapsed; horizontalVelocity = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, horizontalVelocity * 0.35 + nextHorizontalVelocity * 0.65)); verticalVelocity = Math.max(-MAX_THROW_SPEED, Math.min(MAX_THROW_SPEED, verticalVelocity * 0.35 + nextVerticalVelocity * 0.65)); lastPointerX = event.clientX; lastPointerY = event.clientY; lastPointerAt = now; if (!dragging) { dragging = true; setActivity('struggle', now) }; const maxX = Math.max(0, window.innerWidth - CAT_WIDTH); x = Math.max(0, Math.min(maxX, event.clientX - CAT_WIDTH / 2)); y = Math.max(0, Math.min(floor(), event.clientY - CAT_HEIGHT / 2)); if (horizontalVelocity) direction = horizontalVelocity < 0 ? -1 : 1 }
    const onPointerUp = (event: PointerEvent) => { if (event.pointerId !== pointerId) return; if (cat.hasPointerCapture(event.pointerId)) cat.releasePointerCapture(event.pointerId); pointerId = undefined; if (dragging) { dragging = false; horizontalVelocity *= THROW_SPEED_SCALE; verticalVelocity *= THROW_SPEED_SCALE; setActivity('fall', performance.now()) } else setActivity('love', performance.now(), animation.love.frames.length * animation.love.frameMs) }
    const viewport = window.visualViewport
    cat.addEventListener('pointerdown', onPointerDown); cat.addEventListener('pointermove', onPointerMove); cat.addEventListener('pointerup', onPointerUp); cat.addEventListener('pointercancel', onPointerUp); window.addEventListener('resize', syncViewport); viewport?.addEventListener('resize', syncViewport); viewport?.addEventListener('scroll', syncViewport); animationFrame = window.requestAnimationFrame(tick)
    return () => { window.cancelAnimationFrame(animationFrame); cat.removeEventListener('pointerdown', onPointerDown); cat.removeEventListener('pointermove', onPointerMove); cat.removeEventListener('pointerup', onPointerUp); cat.removeEventListener('pointercancel', onPointerUp); window.removeEventListener('resize', syncViewport); viewport?.removeEventListener('resize', syncViewport); viewport?.removeEventListener('scroll', syncViewport) }
  }, [])
  return <div ref={catRef} className="mewcat" aria-label="Mewcat"><span ref={spriteRef} className="mewcat-sprite" /></div>
}
