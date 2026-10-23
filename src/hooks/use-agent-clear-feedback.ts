import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

type ClearFeedback = 'clearing' | 'cleared' | 'queued' | null

export function useAgentClearFeedback() {
  const [feedback, setFeedback] = useState<ClearFeedback>(null)
  const pending = useRef(false)
  const queueCount = useRef(0)
  const baseline = useRef(0)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancel = useCallback(() => {
    clearTimeout(dismissTimer.current)
    pending.current = false
    setFeedback(null)
  }, [])

  const complete = useCallback((result: 'cleared' | 'queued') => {
    if (!pending.current) return
    pending.current = false
    setFeedback(result)
    dismissTimer.current = setTimeout(() => setFeedback(null), 1200)
  }, [])

  const observeQueue = useCallback((queued: string[], kinds?: string[]) => {
    queueCount.current = queued.filter((text, index) => kinds?.[index] === 'clear' || (!kinds?.[index] && text === '/clear')).length
    if (queueCount.current > baseline.current) complete('queued')
  }, [complete])

  const request = useCallback((socket: WebSocket) => {
    if (socket.readyState !== WebSocket.OPEN || pending.current) return
    clearTimeout(dismissTimer.current)
    pending.current = true
    baseline.current = queueCount.current
    flushSync(() => setFeedback('clearing'))
    socket.send(JSON.stringify({ type: 'clear_session' }))
  }, [])

  useEffect(() => () => {
    clearTimeout(dismissTimer.current)
  }, [])

  return { feedback, request, complete, observeQueue, cancel }
}
