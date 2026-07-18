import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpServer } from 'vite'

const WS_PATH = '/api/presence'

const wss = new WebSocketServer({ noServer: true })
// 연결(세션)마다 "지금 포커스 중인 문서 경로 하나" — 탭으로 열어만 둔 문서는 세지 않는다.
// 협업 중 같은 문서를 실제로 동시에 보고/편집하는지 알려주기 위함이라
// 편집(readWrite)·게스트(readOnly) 서버 둘 다에 붙는다.
const focusedPathByClient = new Map<WebSocket, string | null>()

function computeCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of focusedPathByClient.values()) {
    if (p) counts[p] = (counts[p] ?? 0) + 1
  }
  return counts
}

/** presence 소켓에 연결된 모든 세션에 메시지를 보낸다 — 트리 변경 알림(watcher) 등에도 재사용 */
export function broadcast(msg: object) {
  const payload = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

function broadcastCounts() {
  broadcast({ type: 'counts', counts: computeCounts() })
}

wss.on('connection', (ws: WebSocket) => {
  focusedPathByClient.set(ws, null)
  broadcastCounts()

  ws.on('message', (raw) => {
    let msg: { type?: string; path?: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'focus' && (typeof msg.path === 'string' || msg.path === null)) {
      focusedPathByClient.set(ws, msg.path || null)
      broadcastCounts()
    }
  })

  ws.on('close', () => {
    focusedPathByClient.delete(ws)
    broadcastCounts()
  })
})

export function attachPresenceWebSocket(httpServer: HttpServer) {
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    // 이 경로가 아니면 손대지 않고 통과시킨다 — tmux·Vite HMR 웹소켓 업그레이드와 공존해야 함
    if (url.pathname !== WS_PATH) return
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })
}
