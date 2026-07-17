import * as pty from 'node-pty'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpServer } from 'vite'
import { DOCS_CWD, isValidSessionName } from './tmux'

const WS_PATH = '/api/tmux/ws'
const MIN_COLS = 10
const MAX_COLS = 500
const MIN_ROWS = 4
const MAX_ROWS = 200

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 편집용(read-write) dev 서버에만 붙인다 — 게스트에게 터널로 노출되는 읽기 전용 프리뷰
 * 서버(configurePreviewServer)에는 절대 연결하면 안 된다 (셸 접근 = 보안 경계).
 */
export function attachTmuxWebSocket(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    // 이 경로가 아니면 손대지 않고 통과시킨다 — Vite 자체 HMR 웹소켓 업그레이드와 공존해야 함
    if (url.pathname !== WS_PATH) return

    const session = url.searchParams.get('session') ?? ''
    if (!isValidSessionName(session)) {
      socket.destroy()
      return
    }
    const cols = clamp(Number(url.searchParams.get('cols')), MIN_COLS, MAX_COLS, 80)
    const rows = clamp(Number(url.searchParams.get('rows')), MIN_ROWS, MAX_ROWS, 24)

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, session, cols, rows)
    })
  })
}

function handleConnection(ws: WebSocket, session: string, cols: number, rows: number) {
  const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', session], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: DOCS_CWD,
    env: process.env as Record<string, string>,
  })

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
  })

  ptyProcess.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close()
  })

  ws.on('message', (raw) => {
    let msg: { type?: string; data?: string; cols?: number; rows?: number }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      ptyProcess.write(msg.data)
    } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
      ptyProcess.resize(clamp(msg.cols, MIN_COLS, MAX_COLS, cols), clamp(msg.rows, MIN_ROWS, MAX_ROWS, rows))
    }
  })

  // 연결이 끊기면 pty 프로세스(tmux attach 클라이언트)만 종료한다 — tmux는 attach 클라이언트가
  // SIGHUP으로 죽으면 detach만 하고 세션 자체는 살려두는 게 기본 동작이라 안전하다.
  ws.on('close', () => {
    ptyProcess.kill()
  })
}
