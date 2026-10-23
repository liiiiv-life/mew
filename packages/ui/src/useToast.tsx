import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Toast } from './Toast'

/**
 * 토스트 하나를 띄우는 상태 + 그릴 노드. 호출부는 `{toast}`를 렌더하고 `showToast('…')`만 부르면 된다.
 * 여러 번 부르면 마지막 것만 남는다 — id가 바뀌며 리마운트되므로 표시 시간도 그때부터 다시 센다.
 */
export function useToast(): { toast: ReactNode; showToast: (message: string) => void } {
  const [current, setCurrent] = useState<{ id: number; message: string } | null>(null)
  const nextId = useRef(0)

  const showToast = useCallback((message: string) => {
    setCurrent({ id: nextId.current++, message })
  }, [])

  const toast = current ? <Toast key={current.id} message={current.message} onDone={() => setCurrent(null)} /> : null
  return { toast, showToast }
}
