import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  EditPencil,
  Expand,
  Folder,
  MessageText,
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
const dots = <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="3" r="1.5" /><circle cx="18.4" cy="5.6" r="1.5" /><circle cx="21" cy="12" r="1.5" /><circle cx="18.4" cy="18.4" r="1.5" /><circle cx="12" cy="21" r="1.5" /><circle cx="5.6" cy="18.4" r="1.5" /><circle cx="3" cy="12" r="1.5" /><circle cx="5.6" cy="5.6" r="1.5" /><circle cx="12" cy="12" r="2" /></svg>
const icon = (Icon: typeof ArrowLeft) => <Icon width={20} height={20} strokeWidth={1.8} aria-hidden="true" />

function viewport() {
  const v = window.visualViewport
  return { width: v?.width ?? window.innerWidth, height: v?.height ?? window.innerHeight, offsetTop: v?.offsetTop ?? 0 }
}

/** 위치는 우하단에서 잰다. 키보드로 visual viewport가 줄면 같은 bottom이 키보드 위로 올라간다. */
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
  onFullscreen, onToggleAgent, onNextWindowTab, onPrevWindowTab, onToggleTerminal, onOpenEditor, onToggleSidebar, onToggleChat,
}: {
  onFullscreen: () => void; onToggleAgent: () => void; onNextWindowTab: () => void; onPrevWindowTab: () => void
  onToggleTerminal: () => void; onOpenEditor: () => void; onToggleSidebar: () => void; onToggleChat: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [moveReady, setMoveReady] = useState(false)
  const [dragDirection, setDragDirection] = useState<number | null>(null)
  const [position, setPosition] = useState<Offset>(readPosition)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<{ id: number; startX: number; startY: number; moving: boolean; directional: boolean; wasOpen: boolean } | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressArmed = useRef(false)
  const actions: Action[] = [
    { label: '전체화면', icon: icon(Expand), run: onFullscreen }, { label: '에이전트 창', icon: icon(Brain), run: onToggleAgent },
    { label: '오른쪽 탭', icon: icon(ArrowRight), run: onNextWindowTab }, { label: '터미널 창', icon: icon(Terminal), run: onToggleTerminal },
    { label: '에디터 화면', icon: icon(EditPencil), run: onOpenEditor }, { label: '사이드바', icon: icon(Folder), run: onToggleSidebar },
    { label: '왼쪽 탭', icon: icon(ArrowLeft), run: onPrevWindowTab },
    { label: '채팅창', icon: icon(MessageText), run: onToggleChat },
  ]
  const clearLongPress = () => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null }
  useEffect(() => () => { clearLongPress() }, [])
  useEffect(() => {
    const updateInset = () => { const v = viewport(); setKeyboardInset(Math.max(0, window.innerHeight - v.height - v.offsetTop)) }
    updateInset()
    window.visualViewport?.addEventListener('resize', updateInset)
    window.visualViewport?.addEventListener('scroll', updateInset)
    window.addEventListener('resize', updateInset)
    return () => { window.visualViewport?.removeEventListener('resize', updateInset); window.visualViewport?.removeEventListener('scroll', updateInset); window.removeEventListener('resize', updateInset) }
  }, [])
  useEffect(() => { const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }; document.addEventListener('pointerdown', close, true); return () => document.removeEventListener('pointerdown', close, true) }, [])
  const directionAt = (dx: number, dy: number) => Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360) / 45) % 8
  const directionFor = (dx: number, dy: number) => {
    const distance = Math.hypot(dx, dy)
    return distance >= DIRECTION_MIN_DISTANCE && distance <= DIRECTION_MAX_DISTANCE ? directionAt(dx, dy) : null
  }
  const moveTo = (x: number, y: number) => {
    const v = viewport()
    // fixed 컨테이너의 right/bottom은 핸들 **바깥 모서리** 기준이다. 반지름을 빼지 않으면
    // 중심이 포인터보다 24px 왼쪽 위로 가서, 길게 누른 뒤 위치가 뚝 끊겨 보인다.
    const centerX = Math.max(HANDLE_RADIUS, Math.min(v.width - HANDLE_RADIUS, x))
    const centerY = Math.max(HANDLE_RADIUS, Math.min(v.height - HANDLE_RADIUS, y))
    const next = {
      right: v.width - centerX - HANDLE_RADIUS,
      bottom: v.height + v.offsetTop - centerY - HANDLE_RADIUS,
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
    else if (state.wasOpen && !wasMoveReady) setOpen(false)
    setDragDirection(null)
  }
  const cancelPointer = () => { pointerRef.current = null; clearLongPress(); setPressed(false); setMoveReady(false); setDragDirection(null) }
  return <div ref={rootRef} className="fixed z-40" style={{ right: position.right, bottom: position.bottom + keyboardInset }}>
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
