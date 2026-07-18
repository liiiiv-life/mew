import { useEffect, useState } from 'react'

const KEYBOARD_HEIGHT_THRESHOLD = 100
const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

// index.html의 interactive-widget=resizes-content 설정 때문에 키보드가 뜨면 layout
// viewport(window.innerHeight)도 visualViewport와 함께 줄어든다 — 그래서 둘의 차이로 감지하면
// 항상 0에 가까워 절대 안 걸린다. 대신 회전 전까지 계속 갱신되는 "키보드 없을 때 최대 높이"
// 기준선과 현재 visualViewport 높이를 비교한다.
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let maxHeight = vv.height
    let baseWidth = vv.width

    function update() {
      if (isDesktop()) {
        setOpen(false)
        return
      }
      if (vv!.width !== baseWidth) {
        // 화면 회전 등으로 폭이 바뀌면 기준 높이를 리셋
        baseWidth = vv!.width
        maxHeight = vv!.height
      } else {
        maxHeight = Math.max(maxHeight, vv!.height)
      }
      setOpen(maxHeight - vv!.height > KEYBOARD_HEIGHT_THRESHOLD)
    }
    update()
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])

  return open
}
