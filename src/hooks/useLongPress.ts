// 꾹 누르기(모바일) = 우클릭(데스크톱). 순서를 바꾸지 않는 단순한 버튼용 — 끌어서 옮기는 것까지
// 필요하면 useDragReorder(@mew/ui)를 쓴다.
//
// 꾹 눌러 창을 연 뒤 손을 떼면 click이 뒤따라 온다. 그 한 번은 consumeClick()으로 흘려야
// 창을 열자마자 탭까지 열리는 일이 없다.
import { useCallback, useEffect, useRef } from 'react'

const LONG_PRESS_MS = 500

export function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<number | null>(null)
  const firedRef = useRef(false)
  const handlerRef = useRef(onLongPress)
  handlerRef.current = onLongPress

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => cancel, [cancel])

  const consumeClick = useCallback(() => {
    if (!firedRef.current) return false
    firedRef.current = false
    return true
  }, [])

  const pressProps = {
    onPointerDown: () => {
      firedRef.current = false
      cancel()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        firedRef.current = true
        handlerRef.current()
      }, LONG_PRESS_MS)
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      // 모바일 롱프레스가 부르는 네이티브 메뉴도 여기서 막는다
      e.preventDefault()
      if (!firedRef.current) handlerRef.current()
    },
  }

  return { pressProps, consumeClick }
}
