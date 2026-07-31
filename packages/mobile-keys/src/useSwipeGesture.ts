import { useRef } from 'react'
import type React from 'react'

const MIN_DISTANCE = 60 // 스와이프로 인정할 최소 수평 이동(px)
const MAX_OFF_AXIS = 0.6 // |dy|가 |dx|의 이 비율을 넘으면 수직 제스처로 보고 무시
const EDGE_SLACK = 2 // 서브픽셀 오차 때문에 끝 판정에 두는 여유(px)

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

type Zone = 'top' | 'bottom'
type ScrollEdges = { atLeft: boolean; atRight: boolean }
export const NO_SCROLLER: ScrollEdges = { atLeft: true, atRight: true }

// 손가락이 닿은 지점에서 위로 올라가며 가로로 스크롤되는 첫 조상을 찾아, 지금 양 끝에 붙어 있는지 본다.
// 가로 스크롤이 없으면 양쪽 끝에 다 있는 것으로 친다(= 제스처를 막지 않는다).
export function scrollEdges(target: EventTarget | null, boundary: Element): ScrollEdges {
  let el: Element | null = target instanceof Element ? target : null
  while (el) {
    if (el.scrollWidth > el.clientWidth + EDGE_SLACK) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') {
        return {
          atLeft: el.scrollLeft <= EDGE_SLACK,
          atRight: el.scrollLeft + el.clientWidth >= el.scrollWidth - EDGE_SLACK,
        }
      }
    }
    if (el === boundary) break
    el = el.parentElement
  }
  return NO_SCROLLER
}

type SwipeState = {
  zone: Zone
  edges: ScrollEdges
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
  // 스크롤 여유가 남은 방향이면 스와이프가 아니라 스크롤 의도였다고 본다
  if (dx > 0 ? !s.edges.atLeft : !s.edges.atRight) return null
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
// 위 반쪽: onTopLeft(우→좌)/onTopRight(좌→우) = 탭 전환 용도.
// 아래 반쪽: onBottomLeft(우→좌)/onBottomRight(좌→우) = 창(사이드바·터미널) 전환 용도.
// 한 손가락·두 손가락 모두 같게 취급한다(두 손가락은 중점으로 판정).
// preventDefault를 하지 않으므로 에디터 선택·터미널 스크롤 등 기존 터치 동작을 막지 않는다.
// 시작 시점에 구역을 확정하고, touchmove로 마지막 위치를 추적해 손가락이 떨어질 때 판정한다.
//
// options.scrollEdgeZones에 넣은 구역은 **가로 스크롤을 먼저 존중한다** — 손을 댄 곳이
// 가로 스크롤되는 영역(플레인 뷰의 코드, 넓은 표 등)이면 그 방향으로 스크롤 여유가 남아 있는 한
// 제스처를 무시한다. 좌→우는 왼쪽 끝에서, 우→좌는 오른쪽 끝에서만 통과한다.
// 판정은 반드시 **시작 시점**의 스크롤 위치로 한다 — 끝난 시점으로 보면 "스크롤해서 끝에 도달"한
// 경우까지 창 전환으로 오인한다.
export function useSwipeGesture(
  handlers: SwipeHandlers,
  options?: { scrollEdgeZones?: Zone[] },
): {
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
    // clientY는 뷰포트 기준이므로 같은 기준인 innerHeight로 반을 가른다
    const zone = p.y >= window.innerHeight / 2 ? 'bottom' : 'top'
    const edges = options?.scrollEdgeZones?.includes(zone)
      ? scrollEdges(e.target, e.currentTarget)
      : NO_SCROLLER
    state.current = { fingers, zone, edges, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y }
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
