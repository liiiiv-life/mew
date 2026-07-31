import { useEffect, useRef, useState } from 'react'

export const TOAST_VISIBLE_MS = 2600

/**
 * 화면 아래쪽에 잠깐 떴다 사라지는 알림 한 줄. 흐름을 끊지 않아야 하는 안내 전용이다 —
 * 답을 받아야 하는 것은 ConfirmDialog를 쓴다. 보통은 직접 쓰지 않고 `useToast()`로 띄운다.
 *
 * **오버레이 스택(useOverlayDismiss)에 등록하지 않는다.** 사용자가 닫는 물건이 아니고
 * `pointer-events-none`이라 아무것도 가로채지 않는다. 등록하면 안드로이드 뒤로가기 한 번이
 * 토스트를 "닫는" 데 쓰여, 정작 닫으려던 터미널·사이드바가 안 닫힌다.
 */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  const [shown, setShown] = useState(false)
  // 타이머가 렌더마다 다시 걸리지 않게 최신 콜백만 ref로 들고 있는다 (예약은 마운트 때 한 번)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    const timer = window.setTimeout(() => onDoneRef.current(), TOAST_VISIBLE_MS)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-8 z-[1100] flex justify-center px-4"
    >
      <div
        className={`max-w-[80vw] truncate rounded-full border border-edge-bright bg-surface-raised px-4 py-1.5 text-sm text-ink shadow-xl transition-opacity duration-150 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {message}
      </div>
    </div>
  )
}
