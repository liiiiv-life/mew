import { useRef, useState } from 'react'

// Android 네이티브 컨텍스트 메뉴(~500ms)보다 먼저 드래그를 잡아야 길게누르기가 가로채진다
const LONG_PRESS_MS = 350
// 길게누르기 대기 중 이만큼 움직이면 스크롤 의도로 보고 드래그를 포기한다
const TOUCH_SLOP_PX = 8
// 마우스는 이만큼 끌면 바로 드래그 시작
const MOUSE_SLOP_PX = 4
// 드래그가 끝난 뒤 이 시간 안에 도착한 click만 무시한다
const CLICK_SUPPRESS_MS = 500

export type GridDrag = {
  /** 끌고 있는 타일이 원래 있던 칸 */
  slot: number
  /** 시작점 대비 이동량 — 타일을 손끝을 따라 옮기는 데 쓴다 */
  dx: number
  dy: number
  /** 지금 손이 올라가 있는 칸 — 격자 밖이면 null(제자리로 돌아간다) */
  target: number | null
}

export type GridDragTileProps = {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

type DragState = {
  pointerId: number
  slot: number
  startX: number
  startY: number
  isTouch: boolean
  el: HTMLElement
  // pending: 시작 판정 대기 / armed: 터치 길게누르기 완료(이동하면 드래그) / active: 드래그 중
  phase: 'pending' | 'armed' | 'active'
}

function blockTouchScroll(e: TouchEvent) {
  e.preventDefault()
}

// 격자(윈도우 바탕화면식) 드래그 훅 — 타일을 끌어 원하는 칸에 놓는다. 탭바의 useDragReorder와 달리
// 지나가는 중에 순서를 바꾸지 않고, 손을 뗀 칸에만 onMove(from, to)를 한 번 호출한다. 빈 칸으로
// 옮기면 그 자리에 놓이고, 다른 타일이 있는 칸이면 호출부가 서로 자리를 맞바꾼다.
export function useGridDrag({
  enabled,
  onMove,
  mouseHoldMs,
}: {
  enabled: boolean
  onMove: (from: number, to: number) => void
  /** 마우스도 이 시간(ms)만큼 눌러야 드래그가 시작된다 — 없으면 마우스는 슬롭만 넘기면 바로 */
  mouseHoldMs?: number
}) {
  const [drag, setDrag] = useState<GridDrag | null>(null)
  const cellsRef = useRef(new Map<number, HTMLElement>())
  const stateRef = useRef<DragState | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const clickSuppressedAt = useRef(0)

  function cleanup() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    document.removeEventListener('touchmove', blockTouchScroll)
    stateRef.current = null
    setDrag(null)
  }

  function capture(state: DragState) {
    try {
      state.el.setPointerCapture(state.pointerId)
    } catch {
      // 드래그 도중 요소가 사라진 경우 — 캡처 없이도 동작엔 지장 없다
    }
  }

  /** 손끝이 올라가 있는 칸 — 격자 밖이면 null */
  function cellAt(x: number, y: number): number | null {
    for (const [slot, el] of cellsRef.current) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return slot
    }
    return null
  }

  function onPointerDown(slot: number, e: React.PointerEvent) {
    if (!enabled || stateRef.current || e.button !== 0) return
    const state: DragState = {
      pointerId: e.pointerId,
      slot,
      startX: e.clientX,
      startY: e.clientY,
      isTouch: e.pointerType === 'touch',
      el: e.currentTarget as HTMLElement,
      phase: 'pending',
    }
    stateRef.current = state
    if (!state.isTouch && mouseHoldMs == null) {
      // 마우스는 누르는 즉시 포인터를 잡는다 — 빠르게 끌면 첫 pointermove가 타일 밖에서 일어나
      // 타일의 핸들러가 아예 호출되지 않고, 드래그가 시작되지 않는다
      capture(state)
    } else {
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null
        state.phase = 'armed'
        capture(state)
        // 손가락이 아직 슬롭 안에 있어 스크롤이 시작되지 않은 시점 — 여기서부터 touchmove를 막으면
        // 목록 스크롤과 공존한다 (touch-action: none을 정적으로 걸면 스크롤이 죽는다)
        if (state.isTouch) document.addEventListener('touchmove', blockTouchScroll, { passive: false })
        clickSuppressedAt.current = Date.now()
        setDrag({ slot, dx: 0, dy: 0, target: slot })
      }, state.isTouch ? LONG_PRESS_MS : mouseHoldMs)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const state = stateRef.current
    if (!state || e.pointerId !== state.pointerId) return
    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    const dist = Math.hypot(dx, dy)

    if (state.phase === 'pending') {
      if (state.isTouch || mouseHoldMs != null) {
        if (dist > TOUCH_SLOP_PX) cleanup() // 길게누르기 전에 움직임 — 스크롤·클릭에 양보
        return
      }
      if (dist <= MOUSE_SLOP_PX) return
      state.phase = 'active'
    }
    if (state.phase === 'armed') state.phase = 'active'

    setDrag({ slot: state.slot, dx, dy, target: cellAt(e.clientX, e.clientY) })
  }

  function onPointerEnd(e: React.PointerEvent) {
    const state = stateRef.current
    if (!state || e.pointerId !== state.pointerId) return
    if (state.phase !== 'pending') clickSuppressedAt.current = Date.now()
    if (state.phase === 'active') {
      const target = cellAt(e.clientX, e.clientY)
      if (target !== null && target !== state.slot) onMove(state.slot, target)
    }
    cleanup()
  }

  /** 드래그·길게누르기 직후 따라오는 click이면 true — 타일 click 핸들러 첫 줄에서 호출해 무시한다 */
  function consumeClick(): boolean {
    if (clickSuppressedAt.current === 0) return false
    const recent = Date.now() - clickSuppressedAt.current < CLICK_SUPPRESS_MS
    clickSuppressedAt.current = 0
    return recent
  }

  /** 칸(드롭 대상)을 등록한다 — 배치가 바뀌면 같은 번호에 다른 요소가 들어온다 */
  function registerCell(slot: number) {
    return (el: HTMLElement | null) => {
      if (el) cellsRef.current.set(slot, el)
      else cellsRef.current.delete(slot)
    }
  }

  function getTileProps(slot: number): GridDragTileProps {
    return {
      onPointerDown: (e) => onPointerDown(slot, e),
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    }
  }

  return { drag, registerCell, getTileProps, consumeClick }
}
