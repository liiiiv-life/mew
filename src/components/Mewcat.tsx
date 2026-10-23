import { apexDurationBeforeLanding, motionCycleDuration, motionFrameAt, motionMovementSpeed, nextMotionBoundary } from '../utils/mewcat-motion'
import { mewpetMotionEnabled } from '../../shared/mewpet-motion'
import { createPortal } from 'react-dom'
import { useMewcatAssistant, type MewcatAssistantOptions } from '../hooks/use-mewcat-assistant'
import { MewcatAssistant } from './mewcat-assistant'
import { useI18n } from '../i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useMewcatNotices, useNotificationPreferences } from '../utils/mewcat-notifications'
import { MewcatNotifications } from './mewcat-notifications'
import { MewcatFullscreenGuide } from './mewcat-fullscreen-guide'
import { MewcatResources } from './mewcat-resources'
import { MewcatBreak } from './mewcat-break'
import { useMewcatBreak } from '../hooks/use-mewcat-break'
import type { MewcatSkin } from '../utils/mewcatSkin'
import { useMewcatSpriteSkin } from '../hooks/use-mewcat-sprite-skins'
import { MEWCAT_CYCLE_MS, roamActivity, spriteAction, transitionAction, type MewcatActivity as Activity, type MewcatTransitionAction, type SpriteSkin } from '../utils/mewcat-sprites'
import { MewcatSprite } from './mewcat-sprite'
import { paintSpriteFrame } from '../utils/mewcat-sprite-render'
import { useMewcatSize } from '../utils/mewcat-size-preferences'
import { getVirtualKeyboard, virtualKeyboardViewportBottom } from '@mew/ui/virtual-keyboard'

const MAX_THROW_SPEED = 1_400
const THROW_SPEED_SCALE = 0.5
const WALL_BOUNCE = 0.5
function movementBounds(giant: boolean, normalSize: number, groundInset: number) {
  const viewport = window.visualViewport
  const width = viewport?.width ?? window.innerWidth
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const height = Math.max(0, Math.min(top + (viewport?.height ?? window.innerHeight), virtualKeyboardViewportBottom()) - top)
  const size = giant ? Math.min(width * 1.18, height * 1.08) : normalSize
  const overflow = giant ? size * 0.18 : 0
  const ground = giant ? top + height - size + groundInset * size : Math.max(top, top + height - size + groundInset * size)
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
export function Mewcat({ skin, hidden = false, portalTarget, assistant }: { hidden?: boolean; portalTarget?: HTMLElement | null; skin: MewcatSkin | null; assistant?: MewcatAssistantOptions & { onConnect: () => void; onRuntimeChange: (runtime: string) => void } }) {
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
  const approvalId = preferences.visual && preferences.mewcat ? notices.findLast(notice => notice.kind === 'permission')?.id : undefined
  useEffect(() => {
    if (approvalId !== undefined) setBubbleOpen(false)
  }, [approvalId])
  const showBubble = bubbleOpen && skin !== null
  const attention = fullscreenGuide || showBubble || (preferences.visual && preferences.mewcat && notices.length > 0)
  useEffect(() => {
    if (hidden || remainingMs !== null || skin === null) setBubbleOpen(false)
  }, [hidden, remainingMs, skin])
  if (hidden) return null
  const content = remainingMs !== null ? <MewcatBreak remainingMs={remainingMs}><MewcatActive spriteSkin={spriteSkin} attention={false} giant /></MewcatBreak> : <>{skin !== null && <MewcatActive spriteSkin={spriteSkin} anchorRef={anchorRef} attention={attention} noticeId={attention ? notices.at(-1)?.id : undefined}
    onTap={() => { setActivated(true); setBubbleOpen(open => !open) }} onDrag={closeBubble} expanded={showBubble} />}
    {fullscreenGuide && approvalId === undefined ? <MewcatFullscreenGuide anchorRef={spriteSkin ? anchorRef : undefined} onClose={() => setFullscreenGuide(false)} /> : showBubble ? <MewcatResources anchorRef={anchorRef} assistant={assistant?.enabled ? <MewcatAssistant state={helper} runtime={assistant.runtime} onConnect={() => { closeBubble(); assistant.onConnect() }} onRuntimeChange={assistant.onRuntimeChange} /> : undefined} onClose={closeBubble} /> : null}
    <MewcatNotifications hasCat={skin !== null} />
  </>
  return portalTarget ? createPortal(content, portalTarget) : content
}

function MewcatActive({ spriteSkin, anchorRef, attention, noticeId, giant = false, onTap, onDrag, expanded }: { spriteSkin?: SpriteSkin; anchorRef?: RefObject<HTMLDivElement | null>; attention: boolean; noticeId?: number; giant?: boolean; onTap?: () => void; onDrag?: () => void; expanded?: boolean }) {
  const { t } = useI18n()
  const size = useMewcatSize()
  const sizeRef = useRef(size)
  const resizeRef = useRef<(() => void) | null>(null)
  const spriteSkinRef = useRef(spriteSkin)
  spriteSkinRef.current = spriteSkin
  useLayoutEffect(() => { resizeRef.current?.() }, [spriteSkin])
  useLayoutEffect(() => {
    sizeRef.current = size
    resizeRef.current?.()
  }, [size])
  const attentionRef = useRef(attention)
  attentionRef.current = attention
  const interactionRef = useRef({ onTap, onDrag })
  interactionRef.current = { onTap, onDrag }
  const localRef = useRef<HTMLDivElement>(null)
  const catRef = anchorRef ?? localRef
  const lastNotice = useRef(0)
  useEffect(() => {
    if (!spriteSkinRef.current || !noticeId || noticeId <= lastNotice.current) return
    lastNotice.current = noticeId
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const art = catRef.current?.querySelector('.mewcat-art')
    const nod = art?.animate([
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(3deg)', offset: 0.45 },
      { transform: 'rotate(0deg)' },
    ], { duration: 420, easing: 'ease-in-out' })
    return () => nod?.cancel()
  }, [noticeId, catRef])
  useEffect(() => {
    const cat = catRef.current
    if (!cat) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const enabled = (action: Parameters<typeof mewpetMotionEnabled>[0]) => mewpetMotionEnabled(action, spriteSkinRef.current?.motion)
    const cycle = (action: Activity | MewcatTransitionAction) => motionCycleDuration(action, spriteSkinRef.current?.motion?.durations[action === 'land' ? 'landing' : action] ?? MEWCAT_CYCLE_MS[action], spriteSkinRef.current?.motion)
    let activity: Activity = spriteSkinRef.current ? nextActivity() : 'idle'
    if (activity === 'run' && !enabled('run')) activity = 'walk'
    let transition: { action: MewcatTransitionAction; from: Activity; started: number; duration: number } | undefined
    let pendingRoam: { next: 'idle' | 'walk' | 'run' | 'jump'; duration: number; at: number } | undefined
    let jumpAfterStop = false
    const visibleAction = () => transition?.action ?? (enabled(spriteAction(activity)) ? spriteAction(activity) : 'idle')
    const currentStrip = () => spriteSkinRef.current?.sprites[visibleAction()]
    const groundInset = () => {
      const strip = spriteSkinRef.current?.sprites.idle
      return strip ? strip.bottomPadding / Math.max(strip.width / strip.frames, strip.height) : 1 / 48
    }
    let bounds = movementBounds(giant, sizeRef.current, groundInset())
    let x = giant ? (bounds.minX + bounds.maxX) / 2 : clamp(window.innerWidth * 0.3, bounds.minX, bounds.maxX)
    let y = bounds.ground
    let direction = 1
    let activityStarted = performance.now()
    let activityEnds = performance.now() + 1000
    let horizontalVelocity = 0
    let verticalVelocity = 0
    let lastFrame = performance.now()
    let frameDuration = 16
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
    const setActivity = (next: Activity, now: number, duration = 0, animate = true) => {
      pendingRoam = undefined
      jumpAfterStop = false
      if ((next === 'run' || next === 'love') && !enabled(next)) { next = 'idle'; duration = cycle('idle') }
      const action = animate && !reducedMotion ? transitionAction(activity, next) : undefined
      const transitionDuration = action ? action === 'apex' && spriteSkinRef.current?.motion?.stride ? apexDurationBeforeLanding(cycle(action), bounds.ground - y, verticalVelocity, frameDuration) : cycle(action) : 0
      transition = action && transitionDuration && enabled(action) && spriteSkinRef.current?.sprites[action] ? { action, from: activity, started: now, duration: transitionDuration } : undefined
      if (activity !== next) activityStarted = now
      activity = next
      activityEnds = duration ? now + duration + (transition && next !== 'takeoff' && next !== 'land' ? transition.duration : 0) : 0
      bounds = movementBounds(giant, sizeRef.current, groundInset())
      if (pointerId === undefined && next !== 'jump' && next !== 'fall' && next !== 'struggle') y = bounds.ground
    }
    const launch = (now: number) => {
      horizontalVelocity = direction * 90 * (spriteSkinRef.current?.motion?.movementSpeed ?? 1)
      verticalVelocity = -640
      setActivity('jump', now)
    }
    const startJump = (now: number) => {
      if (attentionRef.current || !enabled('jump')) { setActivity('idle', now); return }
      if (enabled('takeoff') && spriteSkinRef.current?.sprites.takeoff) setActivity('takeoff', now, cycle('takeoff'))
      else launch(now)
    }
    const startRoam = (next: 'idle' | 'walk' | 'run' | 'jump', now: number, duration: number) => {
      if (next === 'jump') {
        const stop = transitionAction(activity, 'idle')
        if (!reducedMotion && stop && enabled(stop) && spriteSkinRef.current?.sprites[stop]) {
          setActivity('idle', now)
          jumpAfterStop = true
        } else startJump(now)
      } else setActivity(next, now, duration)
    }
    const chooseRoam = (now: number) => {
      let next = roamActivity(Math.random(), reducedMotion)
      if (!enabled(next)) next = 'walk'
      const duration = next === 'jump' ? 0 : next === 'idle' ? 900 + Math.random() * 1800 : next === 'walk' ? 2200 + Math.random() * 2400 : 1000 + Math.random() * 1500
      if (!reducedMotion && next !== activity && (activity === 'walk' || activity === 'run' || activity === 'idle')) {
        const at = nextMotionBoundary(activityStarted, now, cycle(activity))
        if (at > now) {
          pendingRoam = { next, duration, at }
          activityEnds = 0
          return
        }
      }
      startRoam(next, now, duration)
    }
    const render = () => {
      const spriteSvg = cat.querySelector<SVGSVGElement>('.mewcat-sprite')
      if (transition && (!enabled(transition.action) || !spriteSkinRef.current?.sprites[transition.action])) transition = undefined
      cat.dataset.activity = activity
      if (transition) cat.dataset.transition = transition.action
      else delete cat.dataset.transition
      cat.style.transform = `translate3d(${x}px, ${y}px, 0) scaleX(${direction < 0 ? -1 : 1})`
      const strip = currentStrip()
      const frameActivity = transition?.action ?? (enabled(spriteAction(activity)) ? activity : 'idle')
      if (spriteSvg && strip) paintSpriteFrame(spriteSvg, strip, motionFrameAt(frameActivity, performance.now() - (transition?.started ?? activityStarted), strip.frames, transition?.duration ?? cycle(frameActivity)))
    }
    const followPointer = () => {
      x = clamp(lastPointerX - grabX * bounds.size, bounds.minX, bounds.maxX)
      y = clamp(lastPointerY - grabY * bounds.size, bounds.minY, bounds.ground)
    }
    const resize = () => {
      bounds = movementBounds(giant, sizeRef.current, groundInset())
      cat.style.width = `${bounds.size}px`
      cat.style.height = `${bounds.size}px`
      x = clamp(x, bounds.minX, bounds.maxX)
      if (dragging) followPointer()
      else if (activity === 'jump' || activity === 'fall') {
        y = Math.max(bounds.minY, y)
        if (y >= bounds.ground) {
          y = bounds.ground
          verticalVelocity = 0
          setActivity('land', performance.now(), cycle('land'))
        }
      } else y = bounds.ground
      render()
    }
    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - lastFrame) / 1000)
      frameDuration = Math.max(16, delta * 1000)
      lastFrame = now
      if (!spriteSkinRef.current) {
        setActivity('idle', now, 0, false)
        render()
        animationFrame = window.requestAnimationFrame(tick)
        return
      }
      if (transition && now - transition.started >= transition.duration) {
        const completed = transition.action
        transition = undefined
        activityStarted = now
        bounds = movementBounds(giant, sizeRef.current, groundInset())
        if (completed === 'landing') setActivity('idle', now, cycle('idle'), false)
        else if (jumpAfterStop) startJump(now)
      }
      // A captured pointer owns position, even before the mouse sends its next move.
      // Never let roaming, gravity or ground correction run while the cat is held.
      if (pointerId !== undefined) {
        if (dragging) followPointer()
        render()
        animationFrame = window.requestAnimationFrame(tick)
        return
      }
      if ((activity === 'run' && !enabled('run')) || (activity === 'takeoff' && !enabled('jump'))) setActivity('walk', now, 2200)
      if (activity === 'idle' || activity === 'walk' || activity === 'run' || activity === 'takeoff') {
        if (attentionRef.current && (activity !== 'idle' || activityEnds || pendingRoam || jumpAfterStop)) {
          setActivity('idle', now)
        } else if (!attentionRef.current && pendingRoam && now >= pendingRoam.at) {
          const pending = pendingRoam
          startRoam(pending.next, now, pending.duration)
        } else if (!attentionRef.current && activity === 'idle' && !activityEnds && !transition && !pendingRoam) chooseRoam(now)
      }
      if (activity === 'idle' || activity === 'walk' || activity === 'run') {
        y = bounds.ground
        const speed = (state: Activity) => {
          if (state !== 'walk' && (state !== 'run' || !enabled('run'))) return 0
          const skin = spriteSkinRef.current, strip = skin?.sprites[state]
          return motionMovementSpeed(state, skin?.motion?.durations[state] ?? MEWCAT_CYCLE_MS[state], bounds.size, strip ? strip.width / strip.frames : 128, skin?.motion)
        }
        const progress = transition ? Math.min(1, (now - transition.started) / transition.duration) : 1
        const velocity = attentionRef.current ? 0 : transition ? speed(transition.from) + (speed(activity) - speed(transition.from)) * progress : speed(activity)
        x += direction * velocity * delta
        if (velocity && (x <= bounds.minX || x >= bounds.maxX)) {
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
          setActivity('land', now, cycle('land'))
        }
      } else if (activity !== 'struggle') y = bounds.ground
      if (activityEnds && now >= activityEnds) {
        if (activity === 'takeoff') launch(now)
        else if (attentionRef.current) setActivity('idle', now)
        else chooseRoam(now)
      }
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
      setActivity(dragging ? 'struggle' : 'idle', lastPointerAt, 0, false)
      cat.setPointerCapture(event.pointerId)
      render()
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || !spriteSkinRef.current) return
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
        if (activity !== 'love') setActivity('love', now, cycle('love'))
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
        if (horizontalVelocity !== 0) direction = horizontalVelocity < 0 ? -1 : 1
        setActivity(verticalVelocity < 0 ? 'jump' : 'fall', performance.now())
      } else {
        if (spriteSkinRef.current) setActivity('love', performance.now(), cycle('love'))
        else setActivity('idle', performance.now(), 0, false)
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
    const keyboard = getVirtualKeyboard()
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
    keyboard?.addEventListener('geometrychange', resize)
    resizeRef.current = resize
    resize()
    animationFrame = window.requestAnimationFrame(tick)
    return () => {
      resizeRef.current = null
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
      keyboard?.removeEventListener('geometrychange', resize)
    }
  }, [giant, catRef])
  return <div ref={catRef} className={`mewcat text-accent${giant ? ' mewcat-break-cat' : ''}`} style={{ visibility: spriteSkin ? undefined : 'hidden' }} aria-hidden={!spriteSkin || undefined} data-notification={attention ? 'true' : undefined} aria-label={t('settings.mewcat')}
    role={onTap ? 'button' : undefined} tabIndex={onTap && spriteSkin ? 0 : undefined} aria-expanded={onTap ? expanded : undefined}
    onKeyDown={event => { if (onTap && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onTap() } }}>
    <div className="mewcat-art">{spriteSkin && <MewcatSprite strip={spriteSkin.sprites.idle} />}</div>
  </div>
}
