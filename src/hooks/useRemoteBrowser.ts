import { useCallback, useEffect, useRef, useState } from 'react'

export type RemoteBrowserState = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type BrowserServerMessage =
  | { type: 'ready' }
  | ({ type: 'state' } & RemoteBrowserState)
  | { type: 'dialog'; dialogType: string; message: string; defaultPrompt: string }
  | { type: 'popup'; tab: { id: string; url: string; title: string } }
  | { type: 'fatal'; message: string }

type Viewport = { width: number; height: number }

function boundedViewport(width: number, height: number): Viewport {
  return {
    width: Math.max(320, Math.min(1920, Math.round(width))),
    height: Math.max(240, Math.min(1200, Math.round(height))),
  }
}

export function useRemoteBrowser(
  tabId: string,
  initialUrl: string,
  onState: (state: RemoteBrowserState) => void,
  onPopup: (tab: { id: string; url: string; title: string }) => void,
) {
  const socketRef = useRef<WebSocket | null>(null)
  const viewportRef = useRef<Viewport>({ width: 1280, height: 800 })
  const initialUrlRef = useRef(initialUrl)
  const stateHandlerRef = useRef(onState)
  const popupHandlerRef = useRef(onPopup)
  const frameUrlRef = useRef<string | null>(null)
  const [frame, setFrame] = useState<{ src: string; width: number; height: number } | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [error, setError] = useState<string | null>(null)

  stateHandlerRef.current = onState
  popupHandlerRef.current = onPopup
  initialUrlRef.current = initialUrl

  const send = useCallback((message: object): boolean => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }, [])

  useEffect(() => {
    if (!tabId) return
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0

    const connect = () => {
      if (disposed) return
      setConnection('connecting')
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${location.host}/api/browser/ws`)
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket
      socket.onopen = () => {
        attempts = 0
        socket.send(JSON.stringify({ type: 'hello', tabId, url: initialUrlRef.current, ...viewportRef.current }))
      }
      socket.onmessage = (event) => {
        if (disposed || socketRef.current !== socket) return
        if (event.data instanceof ArrayBuffer) {
          if (event.data.byteLength <= 8) return
          const header = new DataView(event.data, 0, 8)
          const width = header.getUint32(0)
          const height = header.getUint32(4)
          const src = URL.createObjectURL(new Blob([event.data.slice(8)], { type: 'image/jpeg' }))
          if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
          frameUrlRef.current = src
          setFrame({ src, width, height })
          return
        }
        let message: BrowserServerMessage
        try { message = JSON.parse(String(event.data)) as BrowserServerMessage } catch { return }
        if (message.type === 'ready') { setConnection('connected'); setError(null) }
        else if (message.type === 'state') stateHandlerRef.current(message)
        else if (message.type === 'fatal') {
          setError(message.message)
          setConnection('disconnected')
        } else if (message.type === 'popup') {
          popupHandlerRef.current(message.tab)
        } else if (message.type === 'dialog') {
          if (message.dialogType === 'prompt') {
            const answer = window.prompt(message.message, message.defaultPrompt)
            send({ type: 'dialog', accept: answer !== null, ...(answer === null ? {} : { promptText: answer }) })
          } else {
            const accept = message.dialogType === 'alert' ? (window.alert(message.message), true) : window.confirm(message.message)
            send({ type: 'dialog', accept })
          }
        }
      }
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (disposed) return
        setConnection('disconnected')
        const wait = Math.min(5_000, 400 * (2 ** Math.min(attempts++, 4)))
        retry = setTimeout(connect, wait)
      }
      socket.onerror = () => {
        // close에서 재연결한다. 브라우저 API는 구체 오류를 fatal 메시지로 보낸다.
      }
    }

    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
    frameUrlRef.current = null
    setFrame(null)
    setError(null)
    connect()
    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      const socket = socketRef.current
      if (socket) {
        socketRef.current = null
        socket.close()
      }
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
      frameUrlRef.current = null
    }
    // URL은 서버 탭이 처음 생길 때만 쓴다. 원격 탐색으로 URL이 바뀌어도 소켓을 다시 열면 안 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  const resize = useCallback((width: number, height: number) => {
    const next = boundedViewport(width, height)
    if (next.width === viewportRef.current.width && next.height === viewportRef.current.height) return
    viewportRef.current = next
    send({ type: 'resize', ...next })
  }, [send])

  return {
    frame,
    connection,
    error,
    resize,
    navigate: (url: string) => send({ type: 'navigate', url }),
    back: () => send({ type: 'history', direction: 'back' }),
    forward: () => send({ type: 'history', direction: 'forward' }),
    reload: () => send({ type: 'reload' }),
    stop: () => send({ type: 'stop' }),
    pointer: (event: 'down' | 'up' | 'move', payload: object) => send({ type: 'pointer', event, ...payload }),
    wheel: (payload: object) => send({ type: 'wheel', ...payload }),
    key: (event: 'down' | 'up', payload: object) => send({ type: 'key', event, ...payload }),
    insertText: (text: string) => send({ type: 'insert_text', text }),
    closeTab: (closeTabId: string) => send({ type: 'close_tab', tabId: closeTabId }),
  }
}
