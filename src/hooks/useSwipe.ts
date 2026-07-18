import { useRef } from 'react'

const MIN_DISTANCE = 60
// 수평 이동 대비 수직 드리프트가 이 비율을 넘으면 스크롤로 보고 무시한다
const MAX_VERTICAL_RATIO = 0.6

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

// 모바일 전용 좌우 스와이프 감지 — 반환된 핸들러를 컨테이너에 스프레드해서 쓴다.
// onLeft = 손가락이 우→좌로 이동, onRight = 좌→우로 이동.
export function useSwipe(handlers: { onLeft?: () => void; onRight?: () => void }): {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
} {
  const start = useRef<{ x: number; y: number } | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    // 멀티터치(핀치 줌 등)는 제스처로 취급하지 않는다
    if (isDesktop() || e.touches.length > 1) {
      start.current = null
      return
    }
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const s = start.current
    start.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dy) > Math.abs(dx) * MAX_VERTICAL_RATIO) return
    if (dx < 0) handlers.onLeft?.()
    else handlers.onRight?.()
  }

  return { onTouchStart, onTouchEnd }
}
