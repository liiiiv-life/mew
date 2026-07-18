import { useEffect, useRef, useState } from 'react'

// 서버 presence 소켓 연결 관리.
// - 지금 포커스 중인 문서 경로(focusedPath) 하나를 서버에 알린다 — 열어만 둔 탭은 세지 않는다.
// - 서버가 보내는 counts(경로별 포커스 세션 수)와 tree(파일시스템 변경 — watcher) 메시지를 받는다.
export function usePresence(focusedPath: string | null, onTreeChange: () => void): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const focusedPathRef = useRef<string | null>(null)
  // 연결 이펙트를 재실행하지 않고도 항상 최신 콜백을 부르기 위한 ref
  const onTreeChangeRef = useRef(onTreeChange)
  onTreeChangeRef.current = onTreeChange

  useEffect(() => {
    focusedPathRef.current = focusedPath
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'focus', path: focusedPath }))
    }
  }, [focusedPath])

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (cancelled) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${protocol}//${location.host}/api/presence`)
      wsRef.current = ws
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'focus', path: focusedPathRef.current }))
      }
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const msg = JSON.parse(event.data) as { type?: string; counts?: Record<string, number> }
          if (msg.type === 'counts' && msg.counts) setCounts(msg.counts)
          else if (msg.type === 'tree') onTreeChangeRef.current()
        } catch {
          // 잘못된 메시지는 무시
        }
      }
      ws.onclose = () => {
        if (!cancelled) retryTimer = setTimeout(connect, 3000)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

  return counts
}
