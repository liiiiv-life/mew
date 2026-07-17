import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function TmuxTerminal({ sessionName, activeFilePath }: { sessionName: string; activeFilePath?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeFilePathRef = useRef(activeFilePath)

  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const containerEl = container

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
      },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    // Ctrl+L: 마지막으로 열려있던 파일의 절대경로를 셸 입력에 그대로 꽂아준다
    // (열린 파일이 없으면 원래 동작인 화면 지우기로 그대로 통과시킴)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'l') return true
      const path = activeFilePathRef.current
      if (!path) return true
      event.preventDefault()
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: path }))
      return false
    })

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${location.host}/api/tmux/ws?session=${encodeURIComponent(sessionName)}&cols=${term.cols}&rows=${term.rows}`,
    )

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') term.write(event.data)
    }
    ws.onclose = () => {
      term.write('\r\n\x1b[90m[연결 종료 — 세션은 백그라운드에서 계속 실행됩니다]\x1b[0m\r\n')
    }
    ws.onerror = () => {
      term.write('\r\n\x1b[31m[연결 오류]\x1b[0m\r\n')
    }

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
    })

    // fitAddon.fit()이 실제로 cols/rows를 바꿀 때만 발생 — 여기서 서버에 리사이즈를 알린다
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    })

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)

    // tmux는 attach 시 마우스 트래킹을 켜므로(예: `mouse on`), 그 상태에선 xterm.js가 자체
    // 스크롤백을 쓰지 않고 휠 입력을 SGR 마우스 코드로 tmux에 그대로 전달해야 스크롤이 된다.
    // 터치는 네이티브 wheel 이벤트가 없어서, 드래그를 직접 SGR 시퀀스로 인코딩해 PTY에 써준다
    // (term.modes.mouseTrackingMode로 활성 여부를 매번 확인 — 꺼져 있으면 xterm 자체 스크롤백 사용).
    const WHEEL_TICK_PX = 24
    function sendWheelTick(direction: 'up' | 'down', clientX: number, clientY: number) {
      if (term.modes.mouseTrackingMode === 'none') {
        term.scrollLines(direction === 'up' ? -3 : 3)
        return
      }
      if (ws.readyState !== WebSocket.OPEN) return
      const rect = containerEl.getBoundingClientRect()
      const col = Math.min(term.cols, Math.max(1, Math.floor(((clientX - rect.left) / rect.width) * term.cols) + 1))
      const row = Math.min(term.rows, Math.max(1, Math.floor(((clientY - rect.top) / rect.height) * term.rows) + 1))
      const button = direction === 'up' ? 64 : 65
      ws.send(JSON.stringify({ type: 'input', data: `\x1b[<${button};${col};${row}M` }))
    }
    let lastTouchY: number | null = null
    let pendingDeltaY = 0
    function onTouchStart(e: TouchEvent) {
      lastTouchY = e.touches.length === 1 ? e.touches[0].clientY : null
      pendingDeltaY = 0
    }
    function onTouchMove(e: TouchEvent) {
      if (lastTouchY === null || e.touches.length !== 1) return
      // 브라우저가 이 드래그를 페이지 스크롤 제스처로 채가지 못하도록 매 이동마다 막는다
      // (임계값을 넘긴 뒤에만 막으면 이미 네이티브 스크롤이 시작된 뒤일 수 있음)
      e.preventDefault()
      const touch = e.touches[0]
      // 위로 스와이프(값 감소) = 최신 쪽으로 스크롤(down), 아래로 스와이프 = 과거 기록으로(up)
      pendingDeltaY += lastTouchY - touch.clientY
      lastTouchY = touch.clientY
      while (Math.abs(pendingDeltaY) >= WHEEL_TICK_PX) {
        sendWheelTick(pendingDeltaY > 0 ? 'down' : 'up', touch.clientX, touch.clientY)
        pendingDeltaY -= Math.sign(pendingDeltaY) * WHEEL_TICK_PX
      }
    }
    function onTouchEnd() {
      lastTouchY = null
      pendingDeltaY = 0
    }
    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      resizeObserver.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      ws.close()
      term.dispose()
    }
  }, [sessionName])

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-surface-deep p-1" />
}
