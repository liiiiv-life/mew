import { useCallback, useState } from 'react'

// 좌우 도킹 패널의 드래그 리사이즈 + localStorage 폭 유지.
// invert=true면 핸들을 왼쪽으로 끌수록 넓어진다 — 화면 오른쪽에 붙은 패널용 (tmux 등).
export function usePanelWidth(
  storageKey: string,
  opts: { min: number; max: number; initial: number; invert?: boolean },
): { width: number; startResize: (e: React.PointerEvent) => void } {
  const { min, max, initial, invert } = opts
  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, w)), [min, max])
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey))
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : initial
  })

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      function onMove(ev: PointerEvent) {
        const dx = ev.clientX - startX
        setWidth(clamp(invert ? startWidth - dx : startWidth + dx))
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setWidth((w) => {
          localStorage.setItem(storageKey, String(w))
          return w
        })
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [width, clamp, invert, storageKey],
  )

  return { width, startResize }
}
