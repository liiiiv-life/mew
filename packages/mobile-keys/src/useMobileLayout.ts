import { useEffect, useState } from 'react'

const DESKTOP_QUERY = '(min-width: 768px)'

// 보조키 바는 소프트 키보드가 떠 있을 때만 쓰는 게 아니다 — 키보드를 내린 채 방향키로 스크롤하거나
// Esc를 보내는 일이 더 많다. 그래서 "키보드가 떴는가"가 아니라 "모바일 폭인가"로 띄운다.
export function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(() => !window.matchMedia(DESKTOP_QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const update = () => setMobile(!mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return mobile
}
