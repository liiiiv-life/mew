import { AsyncLocalStorage } from 'node:async_hooks'
import { withWorkspaceUpgrade } from '../reqAuth.ts'
import { watchSocketAccess } from '../access-socket.ts'
// /db 실시간 협업 소켓 — 클라이언트가 특정 데이터베이스 룸을 구독하면 그 룸의 변경 이벤트를 받는다.
// presence.ts/collab.ts와 같은 noServer 업그레이드 패턴. 변경은 REST(인증 필요)로만 일어나고,
// 이 소켓은 hub의 이벤트를 중계만 한다. 접속 자격은 collab과 동일(인증 사용자) — 게스트에게 행 데이터가 새지 않도록.
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HttpServer } from 'vite'
import { subscribeDb, type DbEvent } from './hub.ts'

const WS_PATH = '/api/db/ws'
const MAX_SUBS_PER_CONN = 50 // 한 연결이 여는 룸 수 상한 (메모리 DoS 방지)

const wss = new WebSocketServer({ noServer: true })

function roomKey(project: string, dbId: string): string {
  return `${project}:${dbId}`
}

function registerClient(ws: WebSocket, allowed: (project: string) => boolean) {
  // 한 문서에 여러 /db 노드가 있을 수 있어 연결 하나가 여러 룸을 구독한다 (roomKey → 구독 해제 함수).
  const subs = new Map<string, () => void>()

  ws.on('message', AsyncLocalStorage.bind((raw) => {
    let msg: { type?: string; project?: unknown; dbId?: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    const project = typeof msg.project === 'string' ? msg.project : null
    const dbId = typeof msg.dbId === 'string' ? msg.dbId : null
    if (!project || !dbId) return
    if (!allowed(project)) { ws.terminate(); return }
    const key = roomKey(project, dbId)

    if (msg.type === 'subscribe') {
      if (subs.has(key) || subs.size >= MAX_SUBS_PER_CONN) return
      const unsub = subscribeDb(project, dbId, (event: DbEvent) => {
        if (!allowed(project)) { ws.terminate(); return }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'db.event', project, dbId, event }))
        }
      })
      subs.set(key, unsub)
    } else if (msg.type === 'unsubscribe') {
      const unsub = subs.get(key)
      if (unsub) {
        unsub()
        subs.delete(key)
      }
    }
  }))

  ws.on('close', () => {
    for (const unsub of subs.values()) unsub()
    subs.clear()
  })
}

export function attachDbWebSocket(
  httpServer: HttpServer,
  opts: { authorize?: (req: IncomingMessage) => boolean; authorizeProject?: (req: IncomingMessage, project: string) => boolean } = {},
) {
  httpServer.on('upgrade', withWorkspaceUpgrade((req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    // 이 경로가 아니면 손대지 않고 통과 — tmux·presence·collab 업그레이드와 공존해야 함
    if (url.pathname !== WS_PATH) return
    if (opts.authorize && !opts.authorize(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      watchSocketAccess(ws, req, opts.authorize)
      registerClient(ws, AsyncLocalStorage.bind(project => (opts.authorize?.(req) ?? true) && (opts.authorizeProject?.(req, project) ?? true)))
    })
  }))
}
