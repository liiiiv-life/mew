import * as pty from 'node-pty'
import { execFile } from 'node:child_process'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { isValidSessionName } from './tmux.ts'

const DEFAULT_WS_PATH = '/api/tmux/ws'
const MIN_COLS = 10
const MAX_COLS = 500
const MIN_ROWS = 4
const MAX_ROWS = 200

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 셸 접근 = 보안 경계 — 프로덕션(5000)에서는 authorize로 owner/manager만 통과시켜야 한다.
 * 게스트·member는 절대 연결하면 안 된다.
 */
export function attachTmuxWebSocket(
  httpServer: HttpServer | Http2SecureServer,
  opts: {
    /** pty(tmux attach)가 시작할 작업 디렉터리 */
    cwd: string
    authorize?: (req: IncomingMessage) => boolean
    wsPath?: string
  },
) {
  const wsPath = opts.wsPath ?? DEFAULT_WS_PATH
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    // 이 경로가 아니면 손대지 않고 통과시킨다 — Vite 자체 HMR 웹소켓 업그레이드와 공존해야 함
    if (url.pathname !== wsPath) return

    if (opts.authorize && !opts.authorize(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    const session = url.searchParams.get('session') ?? ''
    if (!isValidSessionName(session)) {
      socket.destroy()
      return
    }
    const cols = clamp(Number(url.searchParams.get('cols')), MIN_COLS, MAX_COLS, 80)
    const rows = clamp(Number(url.searchParams.get('rows')), MIN_ROWS, MAX_ROWS, 24)

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, session, cols, rows, opts.cwd)
    })
  })
}

function handleConnection(ws: WebSocket, session: string, cols: number, rows: number, cwd: string) {
  // copy-mode 복사(기본값 external)에 더해 내부 애플리케이션의 OSC 52까지 바깥(xterm.js)으로
  // 통과시킨다 — 클라이언트의 OSC 52 핸들러가 브라우저 클립보드로 옮긴다. 멱등이라 attach마다 실행해도 안전.
  execFile('tmux', ['set-option', '-s', 'set-clipboard', 'on'], () => {})

  const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', session], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
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
    } else if (msg.type === 'exitCopyMode') {
      // 클라이언트의 "맨 아래" 버튼 — 위로 스크롤하면 tmux가 copy-mode로 들어가 라이브 출력이
      // 멈춘 것처럼 보인다. copy-mode -q는 모드에 있을 때만 취소하고 아니면 아무 일도 하지 않으므로
      // (멱등) 상태를 먼저 조회할 필요가 없다. PTY에 키를 쓰지 않는 이유도 이것 — 모드가 아닐 때
      // q나 Esc를 보내면 실행 중인 TUI(Claude Code 등)에 그대로 입력돼 버린다.
      execFile('tmux', ['copy-mode', '-q', '-t', session], () => {})
    }
  })

  // 연결이 끊기면 pty 프로세스(tmux attach 클라이언트)만 종료한다 — tmux는 attach 클라이언트가
  // SIGHUP으로 죽으면 detach만 하고 세션 자체는 살려두는 게 기본 동작이라 안전하다.
  ws.on('close', () => {
    ptyProcess.kill()
  })
}
