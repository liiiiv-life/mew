import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  EditPencil,
  Expand,
  Folder,
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

/** 빠른 방향 드래그는 버튼을 고르고, 350ms 정지 후 끌기는 화면 어디로든 위치 이동이다. */
export function FabMenu({
  onFullscreen, onToggleAgent, onNextWindowTab, onPrevWindowTab, onOpenEditor, onToggleSidebar, onToggleBrowser,
}: {
  onFullscreen: () => void; onToggleAgent: () => void; onNextWindowTab: () => void; onPrevWindowTab: () => void
  onOpenEditor: () => void; onToggleSidebar: () => void; onToggleBrowser: () => void
}) {
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
  const pointerRef = useRef<{ id: number; startX: number; startY: number; moving: boolean; directional: boolean; wasOpen: boolean } | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressArmed = useRef(false)
  const actions: Action[] = [
    { label: '전체화면', icon: icon(Expand), run: onFullscreen }, { label: '터미널•에이전트패널', icon: icon(Brain), run: onToggleAgent },
    { label: '오른쪽 탭', icon: icon(ArrowRight), run: onNextWindowTab },
    { label: '에디터 화면', icon: icon(EditPencil), run: onOpenEditor }, { label: '사이드바', icon: icon(Folder), run: onToggleSidebar },
    { label: '왼쪽 탭', icon: icon(ArrowLeft), run: onPrevWindowTab },
    {
      label: '브라우저 팝업',
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
      unobscuredViewportBottomRef.current = Math.max(unobscuredViewportBottomRef.current, visibleBottom, window.innerHeight)
      const inset = Math.max(0, unobscuredViewportBottomRef.current - visibleBottom)
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
  useEffect(() => { const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }; document.addEventListener('pointerdown', close, true); return () => document.removeEventListener('pointerdown', close, true) }, [])
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
      bottom: window.innerHeight - centerY - HANDLE_RADIUS,
    }
    setPosition(next)
    localStorage.setItem(POSITION_KEY, JSON.stringify(next))
  }
  function run(index: number) {
    const action = actions[index]
    if (!action) return
    action.run()
  }
  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    longPressArmed.current = false
    setMoveReady(false)
    setDragDirection(null)
    clearLongPress()
    // 처음 0.35초 동안 가만히 눌러야만 위치 이동으로 승격한다. 먼저 방향 드래그를 시작한
    // 제스처는 이후 아무리 오래 누르고 있어도 절대 핸들 이동으로 바뀌지 않는다.
    longPressTimer.current = window.setTimeout(() => {
      longPressArmed.current = true
      setMoveReady(true)
    }, 350)
    pointerRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moving: false, directional: false, wasOpen: open }
    setPressed(true)
    setOpen(true)
  }
  function pointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const state = pointerRef.current
    if (!state || state.id !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    const distance = Math.hypot(dx, dy)
    // 이미 방향 제스처를 시작했다면 중심으로 되돌아온 경우도 이전 포커스를
    // 유지하면 안 된다. 유효 고리 밖에서는 항상 포커스를 비운다.
    if (distance < 8) {
      if (state.directional) setDragDirection(null)
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
    const wasMoveReady = longPressArmed.current
    pointerRef.current = null
    clearLongPress()
    setPressed(false)
    setMoveReady(false)
    if (!state || state.id !== event.pointerId || state.moving) {
      setDragDirection(null)
      return
    }
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
  return <div ref={rootRef} className="fixed z-40" style={{ right: position.right, bottom }}>
    {actions.map((action, index) => {
      const angle = (-90 + index * 45) * Math.PI / 180
      const focused = dragDirection === index
      const scale = open ? (focused ? 1.3 : dragDirection === null ? 1 : 0.82) : 0.6
      const transform = `translate(-50%, -50%) translate(${open ? Math.cos(angle) * RADIUS : 0}px, ${open ? Math.sin(angle) * RADIUS : 0}px) scale(${scale})`
      return <button key={action.label} type="button" onClick={() => { action.run(); setOpen(false) }} className={`absolute left-1/2 top-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink shadow-lg transition-all duration-150 ${focused ? 'z-10 border-accent bg-surface text-ink-bright ring-2 ring-accent' : ''} ${open ? (dragDirection === null || focused ? 'pointer-events-auto opacity-100' : 'pointer-events-auto opacity-80') : 'pointer-events-none opacity-0'}`} style={{ transform }} aria-label={action.label} title={action.label}>{action.icon}</button>
    })}
    <button type="button" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer} className={`relative flex h-12 w-12 touch-none select-none items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink-bright shadow-xl transition-opacity ${moveReady ? 'opacity-100' : pressed ? 'opacity-90' : 'opacity-50 hover:opacity-90'}`} aria-label="플로팅 핸들" title="플로팅 핸들">{dots}</button>
  </div>
}
