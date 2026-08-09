// 에이전트 창 WS 릴레이 — ACP 세션의 이벤트를 브라우저로 흘리고, 브라우저의 프롬프트·취소·승인을 되돌려 준다.
//
// 셸 접근 = 보안 경계. authorize는 tmux와 **같은 집합**(owner/manager)이어야 한다 — 에이전트는 Bash를
// 쓸 수 있으므로 더 낮은 게이트로 열면 터미널 경계를 우회하는 것이 된다(ADR 0034).
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_RUNTIME, isRuntime, sessionFor, type AgentEvent, type AgentSession } from './agentAcp.ts'

export const AGENT_WS_PATH = '/api/agent/ws'

type ClientMessage =
  | { type: 'prompt'; text: string }
  | { type: 'cancel' }
  | { type: 'permission'; id: string; optionId: string | null }
  | { type: 'set_model'; modelId: string }
  | { type: 'set_mode'; modeId: string }
  | { type: 'unqueue'; index: number }
  | { type: 'new_session' }
  | { type: 'list_sessions' }
  | { type: 'load_session'; sessionId: string }

type ServerMessage =
  | AgentEvent
  | { type: 'ready' | 'fatal'; message?: string }
  // 목록은 물어본 창에만 답한다 — 상태가 아니라 조회 결과라 이벤트 버퍼에 넣지 않는다
  | { type: 'sessions'; sessions: { sessionId: string; title?: string | null; updatedAt?: string | null }[] }

function send(ws: WebSocket, payload: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

async function handleConnection(ws: WebSocket, runtime: string) {
  let session: AgentSession
  try {
    session = await sessionFor(runtime)
  } catch (err) {
    send(ws, { type: 'fatal', message: err instanceof Error ? err.message : String(err) })
    ws.close()
    return
  }
  // 창을 닫아도 세션은 남는다(agentAcp의 유휴 타이머가 정리) — 재접속하면 지나간 이벤트를 되받는다
  send(ws, { type: 'ready' })
  const detach = session.attach((event) => send(ws, event))

  ws.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      return
    }
    const fail = (err: unknown) => send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) })
    try {
      if (msg.type === 'prompt') session.prompt(msg.text)
      else if (msg.type === 'cancel') session.cancel()
      else if (msg.type === 'permission') session.answerPermission(msg.id, msg.optionId)
      else if (msg.type === 'unqueue') session.unqueue(msg.index)
      else if (msg.type === 'set_model') void session.setModel(msg.modelId).catch(fail)
      else if (msg.type === 'set_mode') void session.setMode(msg.modeId).catch(fail)
      else if (msg.type === 'new_session') void session.newSession().catch(fail)
      else if (msg.type === 'load_session') void session.loadSession(msg.sessionId).catch(fail)
      else if (msg.type === 'list_sessions')
        void session
          .listSessions()
          .then((sessions) => send(ws, { type: 'sessions', sessions }))
          .catch(fail)
    } catch (err) {
      fail(err)
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
    // 프로젝트가 아니라 런타임으로 붙는다 — 세션 스코프는 워크스페이스다(ADR 0043)
    const runtime = url.searchParams.get('runtime') || DEFAULT_RUNTIME
    if (!isRuntime(runtime)) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, runtime)
    })
  })
}
