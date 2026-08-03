import { useRef } from 'react'
import type React from 'react'

const MIN_DISTANCE = 60 // 스와이프로 인정할 최소 수평 이동(px)
const MAX_OFF_AXIS = 0.6 // |dy|가 |dx|의 이 비율을 넘으면 수직 제스처로 보고 무시
const TOP_ZONE = 0.4 // 화면 위에서 이 비율까지가 탭 전환 구역
const BOTTOM_ZONE = 0.2 // 화면 맨 아래 이 비율이 창 전환 구역
// 그 사이(40~80%)는 죽은 구역이다 — 에디터 가로 스크롤을 제스처가 가로채지 않게 일부러 비워 둔다

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

type Zone = 'top' | 'bottom'

/** 손가락이 닿은 높이로 구역을 가른다 — 어느 구역도 아니면 null(제스처 없음, 스크롤 그대로) */
export function zoneForY(clientY: number, viewportHeight: number): Zone | null {
  if (clientY < viewportHeight * TOP_ZONE) return 'top'
  if (clientY >= viewportHeight * (1 - BOTTOM_ZONE)) return 'bottom'
  return null
}

type SwipeState = {
  zone: Zone
  startX: number
  startY: number
  lastX: number
  lastY: number
}

// 끝난 제스처가 어느 핸들러에 해당하는지 — 아무것도 아니면 null. 판정 규칙은 전부 여기 모여 있다.
export function resolveSwipe(s: SwipeState): keyof SwipeHandlers | null {
  const dx = s.lastX - s.startX
  const dy = s.lastY - s.startY
  if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dy) > Math.abs(dx) * MAX_OFF_AXIS) return null
  if (s.zone === 'bottom') return dx < 0 ? 'onBottomLeft' : 'onBottomRight'
  return dx < 0 ? 'onTopLeft' : 'onTopRight'
}

type SwipeHandlers = {
  onTopLeft?: () => void
  onTopRight?: () => void
  onBottomLeft?: () => void
  onBottomRight?: () => void
}

// 좌우 스와이프를 한 요소에서 감지 — 반환된 핸들러를 컨테이너에 스프레드해서 쓴다.
// 손가락 수가 아니라 **손가락이 처음 닿은 화면 높이**로 종류가 갈린다:
// 위 40%: onTopLeft(우→좌)/onTopRight(좌→우) = 탭 전환 용도.
// 가운데 40%: 아무 제스처도 아니다 — 에디터의 가로 스크롤을 그대로 쓰라고 비워 둔 구역.
// 아래 20%: onBottomLeft(우→좌)/onBottomRight(좌→우) = 창(사이드바·터미널) 전환 용도.
// 한 손가락·두 손가락 모두 같게 취급한다(두 손가락은 중점으로 판정).
// preventDefault를 하지 않으므로 에디터 선택·터미널 스크롤 등 기존 터치 동작을 막지 않는다.
// 시작 시점에 구역을 확정하고, touchmove로 마지막 위치를 추적해 손가락이 떨어질 때 판정한다.
//
// 구역 안에서는 가로 스크롤 위치를 따지지 않고 바로 전환한다 — 긴 줄·넓은 표를 끄는 손짓은
// 가운데 구역에서 하면 되므로, "맨 끝에 닿아야 통과"하는 옛 규칙은 없앴다.
export function useSwipeGesture(handlers: SwipeHandlers): {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
} {
  const state = useRef<(SwipeState & { fingers: 1 | 2 }) | null>(null)

  function pos(touches: React.TouchList, fingers: 1 | 2): { x: number; y: number } {
    if (fingers === 2) {
      return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 }
    }
    return { x: touches[0].clientX, y: touches[0].clientY }
  }

  function onTouchStart(e: React.TouchEvent) {
    if (isDesktop() || (e.touches.length !== 1 && e.touches.length !== 2)) {
      state.current = null
      return
    }
    const fingers = e.touches.length as 1 | 2
    const p = pos(e.touches, fingers)
    // clientY는 뷰포트 기준이므로 같은 기준인 innerHeight로 구역을 가른다
    const zone = zoneForY(p.y, window.innerHeight)
    if (!zone) {
      state.current = null
      return
    }
    state.current = { fingers, zone, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y }
  }

  function onTouchMove(e: React.TouchEvent) {
    const s = state.current
    if (!s || e.touches.length !== s.fingers) return
    const p = pos(e.touches, s.fingers)
    s.lastX = p.x
    s.lastY = p.y
  }

  function onTouchEnd() {
    // 두 손가락 중 하나가 떨어지는 시점(또는 한 손가락이 떨어질 때) 한 번만 판정한다
    const s = state.current
    state.current = null
    if (!s) return
    const hit = resolveSwipe(s)
    if (hit) handlers[hit]?.()
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}
