// 에이전트 창 WS 릴레이 — ACP 세션의 이벤트를 브라우저로 흘리고, 브라우저의 프롬프트·취소·승인을 되돌려 준다.
//
// 셸 접근 = 보안 경계. authorize는 tmux와 **같은 집합**(owner/manager)이어야 한다 — 에이전트는 Bash를
// 쓸 수 있으므로 더 낮은 게이트로 열면 터미널 경계를 우회하는 것이 된다(ADR 0034).
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { sessionFor, type AgentEvent, type AgentSession } from './agentAcp.ts'

export const AGENT_WS_PATH = '/api/agent/ws'

type ClientMessage =
  | { type: 'prompt'; text: string }
  | { type: 'cancel' }
  | { type: 'permission'; id: string; optionId: string | null }

function send(ws: WebSocket, payload: AgentEvent | { type: 'ready' | 'fatal'; message?: string }) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

async function handleConnection(ws: WebSocket, project: string) {
  let session: AgentSession
  try {
    session = await sessionFor(project)
  } catch (err) {
    send(ws, { type: 'fatal', message: err instanceof Error ? err.message : String(err) })
    ws.close()
    return
  }
  // 창을 닫아도 세션은 남는다(agentAcp의 유휴 타이머가 정리) — 재접속하면 지나간 이벤트를 되받는다
  const detach = session.attach((event) => send(ws, event))
  send(ws, { type: 'ready' })

  ws.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      return
    }
    try {
      if (msg.type === 'prompt') session.prompt(msg.text)
      else if (msg.type === 'cancel') session.cancel()
      else if (msg.type === 'permission') session.answerPermission(msg.id, msg.optionId)
    } catch (err) {
      send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })
  ws.on('close', detach)
}

export function attachAgentWebSocket(
  httpServer: HttpServer | Http2SecureServer,
  opts: { authorize?: (req: IncomingMessage) => boolean } = {},
) {
  const wss = new WebSocketServer({ noServer: true })
  httpServer.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== AGENT_WS_PATH) return
    if (opts.authorize && !opts.authorize(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const project = url.searchParams.get('project') ?? ''
    if (!project) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, project)
    })
  })
}
