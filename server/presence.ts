import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpServer } from 'vite'

const WS_PATH = '/api/presence'

const wss = new WebSocketServer({ noServer: true })
// 연결(세션)마다 "지금 열려 있는 문서 탭 경로들" — 협업 중 같은 문서를 여러 세션이 동시에
// 열고 있는지 알려주기 위함이라 편집(readWrite)·게스트(readOnly) 서버 둘 다에 붙는다.
const openPathsByClient = new Map<WebSocket, Set<string>>()

function computeCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const paths of openPathsByClient.values()) {
    for (const p of paths) counts[p] = (counts[p] ?? 0) + 1
  }
  return counts
}

function broadcastCounts() {
  const payload = JSON.stringify({ type: 'counts', counts: computeCounts() })
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

wss.on('connection', (ws: WebSocket) => {
  openPathsByClient.set(ws, new Set())
  broadcastCounts()

  ws.on('message', (raw) => {
    let msg: { type?: string; paths?: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'open' && Array.isArray(msg.paths)) {
      openPathsByClient.set(ws, new Set(msg.paths.filter((p): p is string => typeof p === 'string')))
      broadcastCounts()
    }
  })

  ws.on('close', () => {
    openPathsByClient.delete(ws)
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
