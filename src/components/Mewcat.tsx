import { useMewcatFurColor } from '../hooks/use-mewcat-fur-color'
import { mewcatFurPalette } from '../utils/mewcat-fur-color'
import { createPortal } from 'react-dom'
import { useMewcatAssistant, type MewcatAssistantOptions } from '../hooks/use-mewcat-assistant'
import { MewcatAssistant } from './mewcat-assistant'
import { useI18n } from '../i18n'
import { useCallback, useEffect, useRef, useState, type RefObject, type CSSProperties } from 'react'
import { useMewcatNotices, useNotificationPreferences } from '../utils/mewcat-notifications'
import { MewcatNotifications } from './mewcat-notifications'
import { MewcatFullscreenGuide } from './mewcat-fullscreen-guide'
import { MewcatResources } from './mewcat-resources'
import { MewcatBreak } from './mewcat-break'
import { useMewcatBreak } from '../hooks/use-mewcat-break'
import type { MewcatSkin } from '../utils/mewcatSkin'
import { useMewcatSpriteSkin } from '../hooks/use-mewcat-sprite-skins'
import { MEWCAT_CYCLE_MS, spriteAction, spriteFrameAt, type MewcatActivity as Activity, type SpriteSkin } from '../utils/mewcat-sprites'
import { MewcatSprite } from './mewcat-sprite'
import { paintSpriteFrame } from '../utils/mewcat-sprite-render'

const CAT_SIZE = 48
const MAX_THROW_SPEED = 1_400
const THROW_SPEED_SCALE = 0.5
const WALL_BOUNCE = 0.5
function movementBounds(giant: boolean, groundInset = 1) {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const size = giant ? Math.min(width * 1.18, height * 1.08) : CAT_SIZE
  const overflow = giant ? size * 0.18 : 0
  const ground = giant ? top + height - size + groundInset * size / CAT_SIZE : Math.max(top, top + height - size + groundInset)
  return {
    size, ground,
    minX: left - overflow,
    maxX: Math.max(left - overflow, left + width - size + overflow),
    minY: giant ? Math.min(top, ground) - height * 0.5 : top,
  }
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
function nextActivity(): 'idle' | 'walk' | 'run' { const options = ['idle', 'walk', 'run'] as const; return options[Math.floor(Math.random() * options.length)] }

/** 화면 맨 아래를 자유롭게 오가며, 눌러서 잠깐 놀아 줄 수 있는 Mew의 고양이. */
export function Mewcat({ skin, hidden = false, portalTarget, onOpenSystemStats, assistant }: { hidden?: boolean; portalTarget?: HTMLElement | null; skin: MewcatSkin | null; onOpenSystemStats?: () => void; assistant?: MewcatAssistantOptions & { onConnect: () => void; onRuntimeChange: (runtime: string) => void } }) {
  const spriteSkin = useMewcatSpriteSkin(skin)
  const [activated, setActivated] = useState(false)
  const [fullscreenGuide, setFullscreenGuide] = useState(() => !document.fullscreenElement && document.fullscreenEnabled !== false && typeof document.documentElement.requestFullscreen === 'function')
  useEffect(() => {
    const entered = () => { if (document.fullscreenElement) setFullscreenGuide(false) }
    document.addEventListener('fullscreenchange', entered)
    return () => document.removeEventListener('fullscreenchange', entered)
  }, [])
  const helper = useMewcatAssistant(assistant ? { ...assistant, enabled: assistant.enabled && activated } : { account: 'guest', enabled: false, runtime: null, projectRoot: null, onAction: async () => {} })
  const anchorRef = useRef<HTMLDivElement>(null)
  const remainingMs = useMewcatBreak()
  const notices = useMewcatNotices()
  const preferences = useNotificationPreferences()
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const closeBubble = useCallback(() => setBubbleOpen(false), [])
  const showBubble = bubbleOpen && skin !== null
  const attention = fullscreenGuide || showBubble || (preferences.visual && preferences.mewcat && notices.length > 0)
  useEffect(() => {
    if (hidden || remainingMs !== null || skin === null) setBubbleOpen(false)
  }, [hidden, remainingMs, skin])
  if (hidden) return null
  const content = remainingMs !== null ? <MewcatBreak remainingMs={remainingMs}><MewcatActive spriteSkin={spriteSkin} attention={false} giant /></MewcatBreak> : <>{skin !== null && <MewcatActive spriteSkin={spriteSkin} anchorRef={anchorRef} attention={attention} noticeId={attention ? notices.at(-1)?.id : undefined}
    onTap={() => { setActivated(true); setBubbleOpen(open => !open) }} onDrag={closeBubble} expanded={showBubble} />}
    {fullscreenGuide ? <MewcatFullscreenGuide anchorRef={skin !== null ? anchorRef : undefined} onClose={() => setFullscreenGuide(false)} /> : showBubble ? <MewcatResources anchorRef={anchorRef} assistant={assistant?.enabled ? <MewcatAssistant state={helper} runtime={assistant.runtime} onConnect={() => { closeBubble(); assistant.onConnect() }} onRuntimeChange={assistant.onRuntimeChange} /> : undefined} onClose={closeBubble} onOpen={onOpenSystemStats ? () => { closeBubble(); onOpenSystemStats() } : undefined} /> : <MewcatNotifications anchorRef={anchorRef} hasCat={skin !== null} />}
  </>
  return portalTarget ? createPortal(content, portalTarget) : content
}

/** 둥근 얼굴과 짧은 발을 가진 자체 벡터 캐릭터. 설정 미리보기에서도 같은 그림을 쓴다. */
export function MewcatMark({ className = '' }: { className?: string }) {
  const color = useMewcatFurColor()
  return (
    <svg viewBox="0 0 48 48" style={mewcatFurPalette(color) as CSSProperties} className={className} aria-hidden="true" focusable="false">
      <g stroke="var(--mewcat-outline, #737373)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M33 39c9 2 13-4 10-10-1.5-3-5-2-4.5 1 .8 4-1.5 5-5 3" fill="var(--mewcat-fur, #171717)" />
        <path d="M14 29c-3 5-4 10-1 14 3 4 18 4 21 0 3-4 1-11-3-14" fill="var(--mewcat-fur, #171717)" />
        <g className="mewcat-head">
        <path d="M9 17C7 13 7 5 10 5c2 0 6 4 8 7a26 26 0 0 1 11 0c2-3 6-7 8-6 2 1 2 8 0 12 3 3 4 6 3 10-1 7-9 10-17 10S7 35 6 29c-1-5 0-9 3-12Z" fill="var(--mewcat-fur, #171717)" />
        <path d="m11 10 1 7 4-2Z" fill="#e9aaa4" stroke="none" />
        <path d="m35 11-4 4 4 2Z" fill="#e9aaa4" stroke="none" />
        <path d="M20 13v3m4-3v4m4-4v3" stroke="var(--mewcat-stripe, #353535)" />
        <ellipse cx="12.5" cy="28.5" rx="3.3" ry="1.8" fill="#efbeb1" stroke="none" />
        <ellipse cx="33.5" cy="28.5" rx="3.3" ry="1.8" fill="#efbeb1" stroke="none" />
        <g className="mewcat-eyes" fill="var(--mewcat-ink, #e8d99b)" stroke="none">
          <ellipse cx="16" cy="25" rx="2" ry="2.5" />
          <ellipse cx="30" cy="25" rx="2" ry="2.5" />
          <circle cx="16.6" cy="24.2" r=".65" fill="#fff" />
          <circle cx="30.6" cy="24.2" r=".65" fill="#fff" />
        </g>
        <path className="mewcat-happy-eyes" d="M13.8 25.5q2.2-3 4.4 0m9.6 0q2.2-3 4.4 0" fill="none" stroke="var(--mewcat-ink, #e8d99b)" />
        <path d="M21.5 28h3L23 29.5Z" fill="#c98f88" stroke="none" />
        <path d="M23 29.5c0 2-3 2.5-3.5.5m3.5-.5c0 2 3 2.5 3.5.5" fill="none" stroke="var(--mewcat-ink, #e8d99b)" strokeWidth="1.1" />
        <path d="m7 25-3-1m3 5H3m35-4 3-1m-3 5h4" stroke="#a3a3a3" strokeWidth="1" />
        </g>
        <path d="M14 39c-2 1-3 5-1 6.5 1 .7 6 .7 7-.5 1-1 .5-3 0-4m7 0c-.5 1-1 3 0 4 1 1.2 6 1.2 7 .5 2-1.5 1-5.5-1-6.5" fill="var(--mewcat-fur, #171717)" />
      </g>
    </svg>
  )
}

function MewcatActive({ spriteSkin, anchorRef, attention, noticeId, giant = false, onTap, onDrag, expanded }: { spriteSkin?: SpriteSkin; anchorRef?: RefObject<HTMLDivElement | null>; attention: boolean; noticeId?: number; giant?: boolean; onTap?: () => void; onDrag?: () => void; expanded?: boolean }) {
  const { t } = useI18n()
  const attentionRef = useRef(attention)
  attentionRef.current = attention
  const interactionRef = useRef({ onTap, onDrag })
  interactionRef.current = { onTap, onDrag }
  const localRef = useRef<HTMLDivElement>(null)
  const catRef = anchorRef ?? localRef
  const lastNotice = useRef(0)
  useEffect(() => {
    if (!noticeId || noticeId <= lastNotice.current) return
    lastNotice.current = noticeId
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const head = catRef.current?.querySelector('.mewcat-head')
    const nod = head?.animate([
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(8deg)', offset: 0.45 },
      { transform: 'rotate(0deg)' },
    ], { duration: 420, easing: 'ease-in-out' })
    return () => nod?.cancel()
  }, [noticeId, catRef])
  useEffect(() => {
    const cat = catRef.current
    if (!cat) return
    let activity: Activity = nextActivity()
    const groundInset = () => {
      const strip = spriteSkin?.sprites[spriteAction(activity)]
      return strip ? strip.bottomPadding * CAT_SIZE / Math.max(strip.width / strip.frames, strip.height) : 1
    }
    let bounds = movementBounds(giant, groundInset())
    let x = giant ? (bounds.minX + bounds.maxX) / 2 : clamp(window.innerWidth * 0.3, bounds.minX, bounds.maxX)
    let y = bounds.ground
    let direction = 1
    let activityStarted = performance.now()
    let activityEnds = performance.now() + 1000
    let horizontalVelocity = 0
    let verticalVelocity = 0
    let lastFrame = performance.now()
    let animationFrame = 0
    let pointerId: number | undefined
    let dragging = false
    let grabStartX = 0
    let grabStartY = 0
    let grabX = 0
    let grabY = 0
    let lastPointerX = 0
    let lastPointerY = 0
    let lastPointerAt = 0
    const setActivity = (next: Activity, now: number, duration = 0) => {
      activity = next
      activityStarted = now
      activityEnds = duration ? now + duration : 0
      bounds = movementBounds(giant, groundInset())
    }
    const chooseRoam = (now: number) => {
      const next = nextActivity()
      setActivity(next, now, next === 'idle' ? 900 + Math.random() * 1800 : next === 'walk' ? 2200 + Math.random() * 2400 : 1000 + Math.random() * 1500)
    }
    const spriteSvg = cat.querySelector<SVGSVGElement>('.mewcat-sprite')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const render = () => {
      cat.dataset.activity = activity
      cat.style.transform = `translate3d(${x}px, ${y}px, 0) scaleX(${direction < 0 ? -1 : 1})`
      const strip = spriteSkin?.sprites[spriteAction(activity)]
      if (spriteSvg && strip) paintSpriteFrame(spriteSvg, strip, reducedMotion ? 0 : spriteFrameAt(activity, performance.now() - activityStarted, strip.frames))
    }
    const followPointer = () => {
      x = clamp(lastPointerX - grabX * bounds.size, bounds.minX, bounds.maxX)
      y = clamp(lastPointerY - grabY * bounds.size, bounds.minY, bounds.ground)
    }
    const resize = () => {
      bounds = movementBounds(giant, groundInset())
      cat.style.width = `${bounds.size}px`
      cat.style.height = `${bounds.size}px`
      x = clamp(x, bounds.minX, bounds.maxX)
      if (dragging) followPointer()
      else if (activity === 'jump' || activity === 'fall') {
        y = Math.max(bounds.minY, y)
        if (y >= bounds.ground) {
          y = bounds.ground
          verticalVelocity = 0
          setActivity('land', performance.now(), MEWCAT_CYCLE_MS.land)
        }
      } else y = bounds.ground
      render()
    }
    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - lastFrame) / 1000)
      lastFrame = now
      // A captured pointer owns position, even before the mouse sends its next move.
      // Never let roaming, gravity or ground correction run while the cat is held.
      if (pointerId !== undefined) {
        if (dragging) followPointer()
        render()
        animationFrame = window.requestAnimationFrame(tick)
        return
      }
      if (activity === 'idle' || activity === 'walk' || activity === 'run') {
        if (attentionRef.current && (activity !== 'idle' || activityEnds)) {
          setActivity('idle', now)
        } else if (!attentionRef.current && activity === 'idle' && !activityEnds) chooseRoam(now)
      }
      if (activity === 'walk' || activity === 'run') {
        y = bounds.ground
        x += direction * (activity === 'walk' ? 48 : 115) * delta
        if (x <= bounds.minX || x >= bounds.maxX) {
          x = clamp(x, bounds.minX, bounds.maxX)
          direction *= -1
        }
      } else if (activity === 'jump' || activity === 'fall') {
        x += horizontalVelocity * delta
        verticalVelocity += 1600 * delta
        y += verticalVelocity * delta
        if (x <= bounds.minX || x >= bounds.maxX) {
          x = clamp(x, bounds.minX, bounds.maxX)
          horizontalVelocity = -horizontalVelocity * WALL_BOUNCE
          direction = horizontalVelocity < 0 ? -1 : 1
        }
        if (y < bounds.minY) {
          y = bounds.minY
          verticalVelocity = Math.max(0, -verticalVelocity * WALL_BOUNCE)
        }
        if (activity === 'jump' && verticalVelocity >= 0) setActivity('fall', now)
        if (y >= bounds.ground) {
          y = bounds.ground
          horizontalVelocity = 0
          verticalVelocity = 0
          setActivity('land', now, MEWCAT_CYCLE_MS.land)
        }
      } else if (activity !== 'struggle') y = bounds.ground
      if (activityEnds && now >= activityEnds) chooseRoam(now)
      render()
      animationFrame = window.requestAnimationFrame(tick)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (pointerId !== undefined || event.button !== 0) return
      event.preventDefault()
      pointerId = event.pointerId
      dragging = activity === 'jump' || activity === 'fall' || y < bounds.ground
      if (dragging) interactionRef.current.onDrag?.()
      horizontalVelocity = verticalVelocity = 0
      grabStartX = lastPointerX = event.clientX
      grabStartY = lastPointerY = event.clientY
      // Preserve the exact grab point, especially when the character is larger than the viewport.
      grabX = (event.clientX - x) / bounds.size
      grabY = (event.clientY - y) / bounds.size
      lastPointerAt = performance.now()
      setActivity(dragging ? 'struggle' : 'idle', lastPointerAt)
      cat.setPointerCapture(event.pointerId)
      render()
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      const now = performance.now()
      const elapsed = Math.max(0.01, (now - lastPointerAt) / 1000)
      horizontalVelocity = clamp(horizontalVelocity * 0.35 + (event.clientX - lastPointerX) / elapsed * 0.65, -MAX_THROW_SPEED, MAX_THROW_SPEED)
      verticalVelocity = clamp(verticalVelocity * 0.35 + (event.clientY - lastPointerY) / elapsed * 0.65, -MAX_THROW_SPEED, MAX_THROW_SPEED)
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      lastPointerAt = now
      const dx = event.clientX - grabStartX
      const dy = event.clientY - grabStartY
      // Retain the small cat's downward pet gesture; the giant cat can be grabbed in any direction.
      if (!giant && !dragging && dy > 4) {
        horizontalVelocity = verticalVelocity = 0
        y = bounds.ground
        if (activity !== 'love') setActivity('love', now, MEWCAT_CYCLE_MS.love)
      } else if (dragging || Math.hypot(dx, dy) > 4) {
        if (!dragging) interactionRef.current.onDrag?.()
        dragging = true
        setActivity('struggle', now)
        followPointer()
      }
      render()
    }
    const release = (event: PointerEvent, cancelled = false) => {
      if (event.pointerId !== pointerId) return
      pointerId = undefined
      if (cat.hasPointerCapture(event.pointerId)) cat.releasePointerCapture(event.pointerId)
      if (dragging) {
        dragging = false
        // A held cat should drop rather than reuse a stale flick when released much later.
        const scale = cancelled || performance.now() - lastPointerAt > 120 ? 0 : THROW_SPEED_SCALE
        horizontalVelocity *= scale
        verticalVelocity *= scale
        setActivity(verticalVelocity < 0 ? 'jump' : 'fall', performance.now())
      } else {
        setActivity('love', performance.now(), MEWCAT_CYCLE_MS.love)
        if (!cancelled && Math.hypot(event.clientX - grabStartX, event.clientY - grabStartY) <= 4) interactionRef.current.onTap?.()
      }
      render()
    }
    const onPointerUp = (event: PointerEvent) => release(event)
    const onPointerCancel = (event: PointerEvent) => release(event, true)
    // Claim the native touch gesture too: cancelling pointerdown alone can leave
    // the browser suppressing the first tap after a fast touch drag.
    const onTouchStart = (event: TouchEvent) => event.preventDefault()
    const viewport = window.visualViewport
    cat.addEventListener('pointerdown', onPointerDown)
    cat.addEventListener('pointermove', onPointerMove)
    cat.addEventListener('pointerup', onPointerUp)
    cat.addEventListener('pointercancel', onPointerCancel)
    cat.addEventListener('lostpointercapture', onPointerCancel)
    cat.addEventListener('touchstart', onTouchStart, { passive: false })
    window.addEventListener('resize', resize)
    document.addEventListener('fullscreenchange', resize)
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    resize()
    animationFrame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      cat.removeEventListener('pointerdown', onPointerDown)
      cat.removeEventListener('pointermove', onPointerMove)
      cat.removeEventListener('pointerup', onPointerUp)
      cat.removeEventListener('pointercancel', onPointerCancel)
      cat.removeEventListener('lostpointercapture', onPointerCancel)
      cat.removeEventListener('touchstart', onTouchStart)
      if (pointerId !== undefined && cat.hasPointerCapture(pointerId)) cat.releasePointerCapture(pointerId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('fullscreenchange', resize)
      viewport?.removeEventListener('resize', resize)
      viewport?.removeEventListener('scroll', resize)
    }
  }, [giant, catRef, spriteSkin])
  return <div ref={catRef} className={`mewcat text-accent${giant ? ' mewcat-break-cat' : ''}`} data-notification={attention ? 'true' : undefined} aria-label={t('settings.mewcat')}
    role={onTap ? 'button' : undefined} tabIndex={onTap ? 0 : undefined} aria-expanded={onTap ? expanded : undefined}
    onKeyDown={event => { if (onTap && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onTap() } }}>
    <div className="mewcat-art">{spriteSkin ? <MewcatSprite strip={spriteSkin.sprites.idle} /> : <MewcatMark className="mewcat-mark" />}</div>
  </div>
}
