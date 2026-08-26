import { useEffect, useRef, useState, type ReactNode } from 'react'

type Action = { label: string; icon: ReactNode; run: () => void }
type Offset = { right: number; bottom: number }
const RADIUS = 72
const EDGE = 28
// 중심 핸들과 8방향 버튼 사이의 제스처 유효 고리. 의도치 않은 작은 흔들림이나
// 멀리 벗어난 스와이프가 명령으로 확정되는 것을 막는다.
const DIRECTION_MIN_DISTANCE = 36
const DIRECTION_MAX_DISTANCE = RADIUS + 30
const POSITION_KEY = 'mew:floating-handle-position'
const dots = <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="3" r="1.5" /><circle cx="18.4" cy="5.6" r="1.5" /><circle cx="21" cy="12" r="1.5" /><circle cx="18.4" cy="18.4" r="1.5" /><circle cx="12" cy="21" r="1.5" /><circle cx="5.6" cy="18.4" r="1.5" /><circle cx="3" cy="12" r="1.5" /><circle cx="5.6" cy="5.6" r="1.5" /><circle cx="12" cy="12" r="2" /></svg>
const arrow = (dir: 'up' | 'right' | 'down' | 'left') => <span className="text-lg leading-none">{{ up: '↑', right: '→', down: '↓', left: '←' }[dir]}</span>
const simple = (text: string) => <span className="text-[10px] font-semibold">{text}</span>

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

/** 빠른 방향 드래그는 해당 방향 명령, 500ms 정지 후 끌기는 화면 어디로든 위치 이동이다. */
export function FabMenu({
  onFullscreen, onToggleAgent, onNextWindowTab, onPrevWindowTab, onToggleTerminal, onToggleTabBars, onToggleChat, onToggleAgentSet,
  onArrow, onHistoryBack, onHistoryForward, onUndo, onRedo,
}: {
  onFullscreen: () => void; onToggleAgent: () => void; onNextWindowTab: () => void; onPrevWindowTab: () => void
  onToggleTerminal: () => void; onToggleTabBars: () => void; onToggleChat: () => void; onToggleAgentSet: () => void
  onArrow: (dir: 'up' | 'right' | 'down' | 'left') => void; onHistoryBack: () => void; onHistoryForward: () => void; onUndo: () => void; onRedo: () => void
}) {
  const [type, setType] = useState<1 | 2>(() => localStorage.getItem('mew:floating-handle-type') === '2' ? 2 : 1)
  const [open, setOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [dragDirection, setDragDirection] = useState<number | null>(null)
  const [position, setPosition] = useState<Offset>(readPosition)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<{ id: number; startX: number; startY: number; moving: boolean; directional: boolean } | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressArmed = useRef(false)
  const repeatRef = useRef<number | null>(null)
  const lastTapRef = useRef(0)
  const actions: Action[] = type === 1 ? [
    { label: '전체화면', icon: simple('⛶'), run: onFullscreen }, { label: '에이전트 창', icon: simple('AI'), run: onToggleAgent },
    { label: '오른쪽 탭', icon: arrow('right'), run: onNextWindowTab }, { label: '터미널 창', icon: simple('⌘'), run: onToggleTerminal },
    { label: '탭바 숨기기', icon: simple('TB'), run: onToggleTabBars }, { label: '채팅 창', icon: simple('채팅'), run: onToggleChat },
    { label: '왼쪽 탭', icon: arrow('left'), run: onPrevWindowTab }, { label: '에이전트셋', icon: simple('SET'), run: onToggleAgentSet },
  ] : [
    { label: '위', icon: arrow('up'), run: () => onArrow('up') }, { label: '앞으로', icon: simple('앞'), run: onHistoryForward },
    { label: '오른쪽', icon: arrow('right'), run: () => onArrow('right') }, { label: '다시 실행', icon: simple('↷'), run: onRedo },
    { label: '아래', icon: arrow('down'), run: () => onArrow('down') }, { label: '되돌리기', icon: simple('↶'), run: onUndo },
    { label: '왼쪽', icon: arrow('left'), run: () => onArrow('left') }, { label: '뒤로', icon: simple('뒤'), run: onHistoryBack },
  ]
  const clearLongPress = () => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null }
  const stopRepeat = () => { if (repeatRef.current !== null) window.clearInterval(repeatRef.current); repeatRef.current = null }
  useEffect(() => () => { clearLongPress(); stopRepeat() }, [])
  useEffect(() => {
    const updateInset = () => { const v = viewport(); setKeyboardInset(Math.max(0, window.innerHeight - v.height - v.offsetTop)) }
    updateInset()
    window.visualViewport?.addEventListener('resize', updateInset)
    window.visualViewport?.addEventListener('scroll', updateInset)
    window.addEventListener('resize', updateInset)
    return () => { window.visualViewport?.removeEventListener('resize', updateInset); window.visualViewport?.removeEventListener('scroll', updateInset); window.removeEventListener('resize', updateInset) }
  }, [])
  useEffect(() => { const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }; document.addEventListener('pointerdown', close, true); return () => document.removeEventListener('pointerdown', close, true) }, [])
  const setHandleType = () => { const next = type === 1 ? 2 : 1; setType(next); localStorage.setItem('mew:floating-handle-type', String(next)); setOpen(false) }
  const directionAt = (dx: number, dy: number) => Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360) / 45) % 8
  const directionFor = (dx: number, dy: number) => {
    const distance = Math.hypot(dx, dy)
    return distance >= DIRECTION_MIN_DISTANCE && distance <= DIRECTION_MAX_DISTANCE ? directionAt(dx, dy) : null
  }
  const moveTo = (x: number, y: number) => {
    const v = viewport()
    const next = { right: Math.max(EDGE, Math.min(v.width - EDGE, v.width - x)), bottom: Math.max(EDGE, Math.min(v.height - EDGE, v.height + v.offsetTop - y)) }
    setPosition(next)
    localStorage.setItem(POSITION_KEY, JSON.stringify(next))
  }
  function run(index: number, repeat = false) {
    const action = actions[index]
    if (!action) return
    action.run()
    if (type === 2 && [0, 2, 4, 6].includes(index) && !repeat) {
      const dirs: Array<'up' | 'right' | 'down' | 'left'> = ['up', 'right', 'down', 'left']
      const dir = dirs[index / 2]
      stopRepeat()
      repeatRef.current = window.setInterval(() => onArrow(dir), 100)
    }
  }
  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const now = performance.now()
    if (now - lastTapRef.current < 280) { lastTapRef.current = 0; setHandleType(); return }
    lastTapRef.current = now
    longPressArmed.current = false
    setDragDirection(null)
    clearLongPress()
    // 처음 0.5초 동안 가만히 눌러야만 위치 이동으로 승격한다. 먼저 방향 드래그를 시작한
    // 제스처는 이후 아무리 오래 누르고 있어도 절대 핸들 이동으로 바뀌지 않는다.
    longPressTimer.current = window.setTimeout(() => { longPressArmed.current = true }, 500)
    pointerRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moving: false, directional: false }
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
    pointerRef.current = null
    clearLongPress()
    setPressed(false)
    stopRepeat()
    if (!state || state.id !== event.pointerId || state.moving) {
      setDragDirection(null)
      return
    }
    const dx = event.clientX - state.startX; const dy = event.clientY - state.startY
    const direction = directionFor(dx, dy)
    if (direction !== null) { run(direction); setOpen(false) }
    setDragDirection(null)
  }
  const cancelPointer = () => { pointerRef.current = null; clearLongPress(); setPressed(false); setDragDirection(null); stopRepeat() }
  return <div ref={rootRef} className="fixed z-40" style={{ right: position.right, bottom: position.bottom + keyboardInset }}>
    {actions.map((action, index) => {
      const angle = (-90 + index * 45) * Math.PI / 180
      const focused = dragDirection === index
      const scale = open ? (focused ? 1.3 : dragDirection === null ? 1 : 0.82) : 0.6
      const transform = `translate(-50%, -50%) translate(${open ? Math.cos(angle) * RADIUS : 0}px, ${open ? Math.sin(angle) * RADIUS : 0}px) scale(${scale})`
      return <button key={action.label} type="button" onPointerDown={() => { if (type === 2) run(index) }} onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onClick={() => { if (type === 1) { action.run(); setOpen(false) } }} className={`absolute left-1/2 top-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink shadow-lg transition-all duration-150 ${focused ? 'z-10 border-accent bg-surface text-ink-bright ring-2 ring-accent' : ''} ${open ? (dragDirection === null || focused ? 'pointer-events-auto opacity-100' : 'pointer-events-auto opacity-80') : 'pointer-events-none opacity-0'}`} style={{ transform }} aria-label={action.label} title={action.label}>{action.icon}</button>
    })}
    <button type="button" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer} className={`relative flex h-12 w-12 touch-none select-none items-center justify-center rounded-full border border-edge-bright bg-surface-raised text-ink-bright shadow-xl transition-opacity ${pressed ? 'opacity-90' : 'opacity-50 hover:opacity-90'}`} aria-label={`플로팅 핸들 타입 ${type}`} title="두 번 누르면 핸들 타입 전환">{dots}<span className="absolute -bottom-3 rounded bg-surface px-1 text-[9px] text-ink-muted">{type}</span></button>
  </div>
}
