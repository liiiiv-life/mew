import { useEffect, useState } from 'react'

const KEYBOARD_HEIGHT_THRESHOLD = 100
const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

/** 모바일에서 온스크린 키보드가 떠 있는지 — visualViewport가 layout viewport보다 충분히 작아지면 열린 것으로 본다 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function update() {
      setOpen(!isDesktop() && window.innerHeight - vv!.height > KEYBOARD_HEIGHT_THRESHOLD)
    }
    update()
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])

  return open
}
