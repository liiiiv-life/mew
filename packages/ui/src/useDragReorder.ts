import { useEffect, useRef, useState } from 'react'

// Android 네이티브 컨텍스트 메뉴(~500ms)보다 먼저 armed 상태에 들어가야 contextmenu를 가로챌 수 있다
const LONG_PRESS_MS = 350
// 길게누르기 대기 중 이만큼 움직이면 스크롤 의도로 보고 드래그를 포기한다
const TOUCH_SLOP_PX = 8
// 마우스는 이만큼 끌면 바로 드래그 시작
const MOUSE_SLOP_PX = 4
// 드래그·길게누르기가 끝난 뒤 이 시간 안에 도착한 click만 무시한다 (click이 안 오는 경로에서 플래그가 새지 않게)
const CLICK_SUPPRESS_MS = 500
// 드래그 중 탭바 좌우 이 폭 안으로 들어오면 줄이 저절로 굴러간다 — 이게 없으면 화면 밖의 자리로
// 옮길 때 "조금 끌고 놓고 → 스크롤 → 다시 끌고"를 반복해야 한다
const EDGE_PX = 44
// 가장자리에 막 닿았을 때 / 끝까지 밀어붙였을 때의 프레임당 스크롤 거리
const EDGE_SCROLL_MIN_PX = 3
const EDGE_SCROLL_MAX_PX = 18

export type DragItemProps = {
  ref: (el: HTMLElement | null) => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

type DragState = {
  pointerId: number
  index: number
  startX: number
  startY: number
  isTouch: boolean
  el: HTMLElement
  /** 탭들을 담은 가로 스크롤 상자 — 가장자리 자동 스크롤 대상. 넘치지 않으면 null */
  scroller: HTMLElement | null
  // pending: 시작 판정 대기 / armed: 터치 길게누르기 완료(이동하면 드래그) / active: 드래그 중
  phase: 'pending' | 'armed' | 'active'
}

function blockTouchScroll(e: TouchEvent) {
  e.preventDefault()
}

/** 탭을 감싼 가로 스크롤 상자를 찾는다 — 안 넘치면 굴릴 것도 없으므로 null */
function findScroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollWidth <= p.clientWidth) continue
    const overflowX = getComputedStyle(p).overflowX
    if (overflowX === 'auto' || overflowX === 'scroll') return p
  }
  return null
}

/** 가장자리에 얼마나 깊이 들어왔는지(px)를 프레임당 스크롤 거리로 — 깊을수록 빠르게 */
function edgeSpeed(depth: number): number {
  const t = Math.min(depth, EDGE_PX) / EDGE_PX
  return EDGE_SCROLL_MIN_PX + (EDGE_SCROLL_MAX_PX - EDGE_SCROLL_MIN_PX) * t
}

// 가로 탭바 공용 드래그 재정렬 훅 — 마우스는 슬롭을 넘기면 바로, 터치는 길게 누른 뒤 움직이면
// 드래그가 시작된다. 드래그 중 다른 탭의 가운데를 지날 때마다 onReorder(from, to)를 즉시
// 호출하는 라이브 재정렬 방식이라 드롭 시점 처리가 따로 없다.
export function useDragReorder({
  onReorder,
  onLongPress,
  onDragStart,
}: {
  onReorder: (from: number, to: number) => void
  /** 터치 길게누르기 시점(이동 전) — 컨텍스트 메뉴 열기 등에 쓴다 */
  onLongPress?: (index: number, x: number, y: number) => void
  /** 실제 드래그 이동이 시작될 때 — 길게누르기로 연 메뉴 닫기 등에 쓴다 */
  onDragStart?: () => void
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const itemsRef = useRef(new Map<number, HTMLElement>())
  const stateRef = useRef<DragState | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const clickSuppressedAt = useRef(0)
  const autoScrollRaf = useRef<number | null>(null)
  // 자동 스크롤은 손가락이 멈춰 있어도 도는 루프라 마지막 포인터 위치를 따로 들고 있어야 한다
  const pointerXRef = useRef(0)

  function stopAutoScroll() {
    if (autoScrollRaf.current !== null) {
      cancelAnimationFrame(autoScrollRaf.current)
      autoScrollRaf.current = null
    }
  }

  function cleanup() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    stopAutoScroll()
    document.removeEventListener('touchmove', blockTouchScroll)
    stateRef.current = null
    setDragIndex(null)
  }

  useEffect(() => stopAutoScroll, [])

  function capture(state: DragState) {
    try {
      state.el.setPointerCapture(state.pointerId)
    } catch {
      // 드래그 도중 요소가 사라진 경우(세션 종료 등) — 캡처 없이도 동작엔 지장 없다
    }
  }

  // 드래그 중인 탭이 다른 탭의 가운데를 지났으면 그 방향의 가장 먼 탭 자리를 목표로 삼는다
  function targetIndexFor(clientX: number, cur: number): number {
    let target = cur
    for (const [idx, el] of itemsRef.current) {
      if (idx === cur) continue
      const r = el.getBoundingClientRect()
      const mid = r.left + r.width / 2
      if (idx < cur && clientX < mid) target = Math.min(target, idx)
      if (idx > cur && clientX > mid) target = Math.max(target, idx)
    }
    return target
  }

  /** 지금 포인터 위치 기준으로 자리를 다시 재고, 달라졌으면 그만큼 옮긴다 */
  function applyTarget(clientX: number) {
    const state = stateRef.current
    if (!state || state.phase !== 'active') return
    const target = targetIndexFor(clientX, state.index)
    if (target === state.index) return
    onReorder(state.index, target)
    state.index = target
    setDragIndex(target)
  }

  // rAF 콜백은 루프를 시작한 렌더의 클로저에 갇힌다 — 항상 최신 onReorder를 타도록 ref로 건너 잡는다
  const applyTargetRef = useRef(applyTarget)
  applyTargetRef.current = applyTarget

  function autoScrollStep() {
    autoScrollRaf.current = null
    const state = stateRef.current
    if (!state || state.phase !== 'active' || !state.scroller) return
    const box = state.scroller.getBoundingClientRect()
    const x = pointerXRef.current
    let dx = 0
    if (x < box.left + EDGE_PX) dx = -edgeSpeed(box.left + EDGE_PX - x)
    else if (x > box.right - EDGE_PX) dx = edgeSpeed(x - (box.right - EDGE_PX))
    if (dx !== 0) {
      const before = state.scroller.scrollLeft
      state.scroller.scrollLeft = before + dx
      // 굴러간 만큼 탭들이 멈춰 있는 손끝 아래를 지나간다 — 그 자리를 다시 재야 계속 밀린다
      if (state.scroller.scrollLeft !== before) applyTargetRef.current(x)
    }
    // 끝에 닿았거나 가장자리를 벗어나도 루프는 유지한다 — 다시 들어오면 곧바로 이어서 굴러야 한다
    autoScrollRaf.current = requestAnimationFrame(autoScrollStep)
  }

  function activate(state: DragState) {
    state.phase = 'active'
    state.scroller = findScroller(state.el)
    setDragIndex(state.index)
    onDragStart?.()
    if (state.scroller && autoScrollRaf.current === null) {
      autoScrollRaf.current = requestAnimationFrame(autoScrollStep)
    }
  }

  function onPointerDown(index: number, e: React.PointerEvent) {
    if (stateRef.current || e.button !== 0) return
    const state: DragState = {
      pointerId: e.pointerId,
      index,
      startX: e.clientX,
      startY: e.clientY,
      isTouch: e.pointerType === 'touch',
      el: e.currentTarget as HTMLElement,
      scroller: null,
      phase: 'pending',
    }
    pointerXRef.current = e.clientX
    stateRef.current = state
    if (state.isTouch) {
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null
        state.phase = 'armed'
        capture(state)
        // 손가락이 슬롭 안에 머물러 스크롤이 아직 시작되지 않은 시점 — 이후 touchmove만 막으면
        // 탭바의 overflow 스크롤과 공존한다 (touch-action: none을 정적으로 걸면 스크롤이 죽는다)
        document.addEventListener('touchmove', blockTouchScroll, { passive: false })
        setDragIndex(state.index)
        clickSuppressedAt.current = Date.now()
        onLongPress?.(state.index, state.startX, state.startY)
      }, LONG_PRESS_MS)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const state = stateRef.current
    if (!state || e.pointerId !== state.pointerId) return
    pointerXRef.current = e.clientX
    const dist = Math.hypot(e.clientX - state.startX, e.clientY - state.startY)

    if (state.phase === 'pending') {
      if (state.isTouch) {
        if (dist > TOUCH_SLOP_PX) cleanup() // 길게누르기 전에 움직임 — 스크롤에 양보
      } else if (dist > MOUSE_SLOP_PX) {
        capture(state)
        activate(state)
      }
      return
    }
    if (state.phase === 'armed' && dist > TOUCH_SLOP_PX / 2) activate(state)
    if (state.phase !== 'active') return

    applyTarget(e.clientX)
  }

  function onPointerEnd(e: React.PointerEvent) {
    const state = stateRef.current
    if (!state || e.pointerId !== state.pointerId) return
    if (state.phase !== 'pending') clickSuppressedAt.current = Date.now()
    cleanup()
  }

  /** 드래그·길게누르기 직후 따라오는 click이면 true — 탭의 click 핸들러 첫 줄에서 호출해 무시한다 */
  function consumeClick(): boolean {
    if (clickSuppressedAt.current === 0) return false
    const recent = Date.now() - clickSuppressedAt.current < CLICK_SUPPRESS_MS
    clickSuppressedAt.current = 0
    return recent
  }

  function getItemProps(index: number): DragItemProps {
    return {
      ref: (el) => {
        if (el) itemsRef.current.set(index, el)
        else itemsRef.current.delete(index)
      },
      onPointerDown: (e) => onPointerDown(index, e),
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    }
  }

  return { dragIndex, getItemProps, consumeClick }
}
