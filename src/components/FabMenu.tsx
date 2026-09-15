import { HoverTipLayer, useOverlayDismiss } from '@mew/ui'
import { useI18n } from '../i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  EditPencil,
  Expand,
  Folder,
  Lock,
  LockSlash,
  Terminal,
} from 'iconoir-react'

type Action = { label: string; icon: ReactNode; run: () => void }
type Offset = { right: number; bottom: number }
const RADIUS = 60
const HANDLE_RADIUS = 24
// 중심 핸들과 8방향 버튼 사이의 제스처 유효 고리. 의도치 않은 작은 흔들림이나
// 멀리 벗어난 스와이프가 명령으로 확정되는 것을 막는다.
const DIRECTION_MIN_DISTANCE = 36
const DIRECTION_MAX_DISTANCE = (RADIUS + 30) * 2.5
const POSITION_KEY = 'mew:floating-handle-position'
const LOCK_KEY = 'mew:floating-handle-locked'
// 키보드와 맞닿지 않도록 확보할 여백. 핸들이 이 영역에 걸칠 때만 옮긴다.
const KEYBOARD_CLEARANCE = 32
const dots = <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="3" r="1.5" /><circle cx="18.4" cy="5.6" r="1.5" /><circle cx="21" cy="12" r="1.5" /><circle cx="18.4" cy="18.4" r="1.5" /><circle cx="12" cy="21" r="1.5" /><circle cx="5.6" cy="18.4" r="1.5" /><circle cx="3" cy="12" r="1.5" /><circle cx="5.6" cy="5.6" r="1.5" /><circle cx="12" cy="12" r="2" /></svg>
const icon = (Icon: typeof ArrowLeft) => <Icon width={20} height={20} strokeWidth={1.8} aria-hidden="true" />

function viewport() {
  const v = window.visualViewport
  return { width: v?.width ?? window.innerWidth, height: v?.height ?? window.innerHeight, offsetTop: v?.offsetTop ?? 0 }
}

/** 위치는 레이아웃 뷰포트의 우하단에서 잰다. */
function readPosition(): Offset {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) ?? '') as Partial<Offset> & { x?: unknown; y?: unknown }
    if (Number.isFinite(value.right) && Number.isFinite(value.bottom)) return { right: value.right!, bottom: value.bottom! }
    // 이전 절대좌표 저장분도 한 번만 우하단 기준으로 이관한다.
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) return { right: window.innerWidth - Number(value.x), bottom: window.innerHeight - Number(value.y) }
  } catch { /* default */ }
  return { right: 32, bottom: 32 }
}

/** 마우스는 바로 위치 이동, 터치는 방향 선택 또는 350ms 길게 눌러 위치 이동. */
export function FabMenu({
  onFullscreen, onToggleAgent, onNextWindowTab, onToggleTerminal, onPrevWindowTab, onOpenEditor, onToggleSidebar, onToggleBrowser,
}: {
  onFullscreen: () => void; onToggleAgent: () => void; onNextWindowTab: () => void; onToggleTerminal: () => void; onPrevWindowTab: () => void
  onOpenEditor: () => void; onToggleSidebar: () => void; onToggleBrowser: () => void
}) {
  const { t } = useI18n()
  const [locked, setLocked] = useState(() => {
    try { return localStorage.getItem(LOCK_KEY) === 'true' } catch { return false }
  })
  const [open, setOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [moveReady, setMoveReady] = useState(false)
  const [dragDirection, setDragDirection] = useState<number | null>(null)
  const [position, setPosition] = useState<Offset>(readPosition)
  const [keyboard, setKeyboard] = useState({ inset: 0, fixedToVisualViewport: false })
  const rootRef = useRef<HTMLDivElement>(null)
  // Android처럼 키보드가 레이아웃 뷰포트까지 줄이는 브라우저에서는 innerHeight도 함께
  // 작아진다. 키보드 전의 가장 큰 뷰포트를 기억해야 실제 키보드 높이를 잴 수 있다.
  const unobscuredViewportBottomRef = useRef(0)
  const viewportWidthRef = useRef(0)
  const pointerRef = useRef<{ id: number; startX: number; startY: number; mouse: boolean; moving: boolean; directional: boolean; wasOpen: boolean } | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressArmed = useRef(false)
  const actions: Action[] = [
    { label: t('fab.fullscreen'), icon: icon(Expand), run: onFullscreen }, { label: t('header.agent'), icon: icon(Brain), run: onToggleAgent },
    { label: t('fab.nextWindowTab'), icon: icon(ArrowRight), run: onNextWindowTab },
    { label: t('header.terminal'), icon: icon(Terminal), run: onToggleTerminal },
    { label: t('fab.editor'), icon: icon(EditPencil), run: onOpenEditor }, { label: t('fab.sidebar'), icon: icon(Folder), run: onToggleSidebar },
    { label: t('fab.prevWindowTab'), icon: icon(ArrowLeft), run: onPrevWindowTab },
    {
      label: t('header.browser'),
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></svg>,
      run: onToggleBrowser,
    },
  ]
  const clearLongPress = () => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null }
  useEffect(() => () => { clearLongPress() }, [])
  useEffect(() => {
    const updateKeyboard = () => {
      const v = viewport()
      const visibleBottom = v.height + v.offsetTop
      const active = document.activeElement
      const editing = active instanceof HTMLElement && (
        active.isContentEditable || active.matches('textarea, input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])')
      )
      // 배율·창 크기 변경을 키보드로 오인하지 않는다. 키보드는 입력 중에만
      // 감지하고, 가로 크기가 바뀌면 이전 배율에서 기억한 높이를 버린다.
      if (!editing || viewportWidthRef.current !== window.innerWidth) {
        unobscuredViewportBottomRef.current = visibleBottom
      }
      viewportWidthRef.current = window.innerWidth
      unobscuredViewportBottomRef.current = Math.max(unobscuredViewportBottomRef.current, visibleBottom, window.innerHeight)
      const inset = editing ? Math.max(0, unobscuredViewportBottomRef.current - visibleBottom) : 0
      // innerHeight와 visualViewport 높이가 같으면 키보드가 fixed의 기준 자체를 줄인 상태다.
      const fixedToVisualViewport = Math.abs(window.innerHeight - v.height) < 1
      setKeyboard({ inset, fixedToVisualViewport })
    }
    updateKeyboard()
    window.visualViewport?.addEventListener('resize', updateKeyboard)
    window.visualViewport?.addEventListener('scroll', updateKeyboard)
    window.addEventListener('resize', updateKeyboard)
    return () => { window.visualViewport?.removeEventListener('resize', updateKeyboard); window.visualViewport?.removeEventListener('scroll', updateKeyboard); window.removeEventListener('resize', updateKeyboard) }
  }, [])
  useOverlayDismiss(open && (() => { cancelPointer(); setOpen(false) }), { outside: () => rootRef.current })
  const directionAt = (dx: number, dy: number) => Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360) / 45) % 8
  const directionFor = (dx: number, dy: number) => {
    const distance = Math.hypot(dx, dy)
    return distance >= DIRECTION_MIN_DISTANCE && distance <= DIRECTION_MAX_DISTANCE ? directionAt(dx, dy) : null
  }
  const moveTo = (x: number, y: number) => {
    const centerX = Math.max(HANDLE_RADIUS, Math.min(window.innerWidth - HANDLE_RADIUS, x))
    const centerY = Math.max(HANDLE_RADIUS, Math.min(window.innerHeight - HANDLE_RADIUS, y))
    const next = {
      right: window.innerWidth - centerX - HANDLE_RADIUS,
      // 저장 좌표는 키보드가 닫힌 레이아웃 기준이므로 렌더링 때 빠지는
      // 자동 상승분을 되돌려 넣는다.
      bottom: window.innerHeight - centerY - HANDLE_RADIUS + (keyboard.fixedToVisualViewport ? keyboard.inset : 0),
    }
    setPosition(next)
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(next)) } catch { /* Keep moving when storage is unavailable. */ }
  }
  function run(index: number) {
    const action = actions[index]
    if (!action) return
    action.run()
  }
  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || pointerRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    longPressArmed.current = false
    setMoveReady(false)
    setDragDirection(null)
    clearLongPress()
    // 처음 0.35초 동안 가만히 눌러야만 위치 이동으로 승격한다. 먼저 방향 드래그를 시작한
    // 제스처는 이후 아무리 오래 누르고 있어도 절대 핸들 이동으로 바뀌지 않는다.
    if (event.pointerType !== 'mouse' && !locked) longPressTimer.current = window.setTimeout(() => {
      longPressArmed.current = true
      setMoveReady(true)
    }, 350)
    pointerRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, mouse: event.pointerType === 'mouse', moving: false, directional: false, wasOpen: open }
    setPressed(true)
    if (event.pointerType !== 'mouse') setOpen(true)
  }
  function pointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const state = pointerRef.current
    if (!state || state.id !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    const distance = Math.hypot(dx, dy)
    // 이미 방향 제스처를 시작했다면 중심으로 되돌아온 경우도 이전 포커스를
    // 유지하면 안 된다. 유효 고리 밖에서는 항상 포커스를 비운다.
    if (!state.moving && distance < 8) {
      if (state.directional) setDragDirection(null)
      return
    }
    if (state.mouse) {
      state.moving = true
      if (!locked) {
        setMoveReady(true)
        setOpen(false)
        moveTo(event.clientX, event.clientY)
      }
      return
    }
    if (!longPressArmed.current) {
      state.directional = true
      clearLongPress()
      setDragDirection(directionFor(dx, dy))
      return
    }
    if (state.directional) return
    state.moving = true
    // 위치 이동으로 승격된 뒤에는 누른 지점의 오프셋을 유지하지 않고 핸들 중심을
    // 현재 포인터에 맞춘다. 핸들 가장자리를 잡아도 포인터 아래로 처져 따라오지 않는다.
    moveTo(event.clientX, event.clientY)
  }
  function pointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const state = pointerRef.current
    if (!state || state.id !== event.pointerId) return
    const wasMoveReady = longPressArmed.current
    pointerRef.current = null
    clearLongPress()
    setPressed(false)
    setMoveReady(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (state.moving) {
      setDragDirection(null)
      return
    }
    if (state.mouse) { setOpen(!state.wasOpen); return }
    const dx = event.clientX - state.startX; const dy = event.clientY - state.startY
    const direction = directionFor(dx, dy)
    if (direction !== null) { run(direction); setOpen(false) }
    // 방향을 고르려다 중심으로 돌아오면 선택을 취소하고 펼친 팔도 접는다.
    // 처음 닫힌 상태에서 시작한 제스처도 포함해야 메뉴가 화면에 남지 않는다.
    else if (state.directional || (state.wasOpen && !wasMoveReady)) setOpen(false)
    setDragDirection(null)
  }
  const cancelPointer = () => { pointerRef.current = null; clearLongPress(); setPressed(false); setMoveReady(false); setDragDirection(null) }
  // 키보드에 가리지 않으면 닫혀 있을 때의 화면 좌표를 보존한다. 키보드가 fixed의
  // 기준 뷰포트까지 줄인 브라우저에서는 그 자동 상승분(inset)을 bottom에서 빼야 한다.
  // 가리면 브라우저별 기준에 맞춰 실제 키보드 상단 + 여백으로 고정한다.
  const coveredByKeyboard = keyboard.inset > 0 && position.bottom <= keyboard.inset + KEYBOARD_CLEARANCE
  const bottom = coveredByKeyboard
    ? (keyboard.fixedToVisualViewport ? KEYBOARD_CLEARANCE : keyboard.inset + KEYBOARD_CLEARANCE)
    : (keyboard.fixedToVisualViewport ? Math.max(0, position.bottom - keyboard.inset) : position.bottom)
  const toggleLock = () => {
    const next = !locked
    setLocked(next)
    try { localStorage.setItem(LOCK_KEY, String(next)) } catch { /* Session state still works. */ }
  }
  return <div ref={rootRef} className="fixed z-40" style={{
    right: `clamp(${open ? 64 : 0}px, ${position.right}px, calc(100vw - ${open ? 112 : 48}px))`,
    bottom: `clamp(${open ? 64 : 0}px, ${bottom}px, calc(var(--app-height, 100dvh) - ${open ? 164 : 48}px))`,
  }}>
    {open && <HoverTipLayer>
      <button type="button" onClick={toggleLock} aria-pressed={locked} className="absolute -top-[104px] left-1/2 flex h-9 -translate-x-1/2 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-edge-bright bg-surface-raised px-3 text-sm text-ink shadow-lg hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        {icon(locked ? Lock : LockSlash)}{t(locked ? 'fab.unlock' : 'fab.lock')}
      </button>
    {actions.map((action, index) => {
      const angle = (-90 + index * 45) * Math.PI / 180
      const focused = dragDirection === index
      const scale = open ? (focused ? 1.3 : dragDirection === null ? 1 : 0.82) : 0.6
      const transform = `translate(-50%, -50%) translate(${open ? Math.cos(angle) * RADIUS : 0}px, ${open ? Math.sin(angle) * RADIUS : 0}px) scale(${scale})`
      return <button key={action.label} type="button" onClick={() => { action.run(); setOpen(false) }} className={`absolute left-1/2 top-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink shadow-lg transition-[transform,opacity] duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${focused ? 'z-10 border-accent bg-surface text-ink-bright ring-2 ring-accent' : ''} ${open ? (dragDirection === null || focused ? 'pointer-events-auto opacity-100' : 'pointer-events-auto opacity-80') : 'pointer-events-none opacity-0'}`} style={{ transform }} aria-label={action.label} data-tip={action.label}>{action.icon}</button>
    })}
    </HoverTipLayer>}
    <button type="button" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer} onClick={(event) => { if (event.detail === 0) setOpen(value => !value) }} aria-expanded={open} className={`relative flex h-12 w-12 touch-none select-none items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink-bright shadow-xl transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${locked ? 'cursor-pointer' : moveReady ? 'cursor-grabbing' : 'cursor-grab'} ${moveReady ? 'opacity-100' : pressed ? 'opacity-90' : 'opacity-50 hover:opacity-90'}`} aria-label={t('fab.handle')}>{locked ? icon(Lock) : dots}</button>
  </div>
}
