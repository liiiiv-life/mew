// 에이전트 창 WS 릴레이 — ACP 세션의 이벤트를 브라우저로 흘리고, 브라우저의 프롬프트·취소·승인을 되돌려 준다.
//
// 셸 접근 = 보안 경계. authorize는 tmux와 **같은 집합**(owner/manager)이어야 한다 — 에이전트는 Bash를
// 쓸 수 있으므로 더 낮은 게이트로 열면 터미널 경계를 우회하는 것이 된다(ADR 0034).
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_RUNTIME, disposeSession, isRuntime, sessionFor, type AgentEvent, type AgentSession } from './agentAcp.ts'
import { listSessionsFromDisk } from './agentSessionList.ts'
import { WORKSPACE_ROOT } from './paths.ts'

export const AGENT_WS_PATH = '/api/agent/ws'

/** 탭 식별자 — 브라우저가 만들어 보내는 불투명한 값이다. 맵 열쇠로만 쓰지만 길이는 묶어 둔다 */
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/

type ClientMessage =
  | { type: 'prompt'; text: string }
  | { type: 'cancel' }
  | { type: 'permission'; id: string; optionId: string | null }
  | { type: 'set_model'; modelId: string }
  | { type: 'set_mode'; modeId: string }
  | { type: 'unqueue'; index: number }
  | { type: 'move_queued'; from: number; to: number }
  /** expect = 창이 보고 있던 원본 — 그 사이 큐가 당겨졌으면 서버가 무시한다 */
  | { type: 'edit_queued'; index: number; text: string; expect: string }
  | { type: 'list_sessions' }
  | { type: 'load_session'; sessionId: string }
  /** 탭을 닫았다 — 창만 닫은 것과 달리 세션도 여기서 끝난다 */
  | { type: 'close_session' }

type ServerMessage =
  | AgentEvent
  | { type: 'ready' | 'fatal'; message?: string }
  // 목록은 물어본 창에만 답한다 — 상태가 아니라 조회 결과라 이벤트 버퍼에 넣지 않는다
  | { type: 'sessions'; sessions: { sessionId: string; title?: string | null; updatedAt?: string | null }[] }
  // 지나간 대화는 한 덩어리로 간다 — 창은 이걸 받아 지금 그린 대화를 통째로 갈아끼운다
  | { type: 'replay'; events: AgentEvent[] }

function send(ws: WebSocket, payload: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

async function handleConnection(ws: WebSocket, runtime: string, tab: string) {
  const fail = (err: unknown) => send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) })

  // 에이전트가 뜨는 데는 1초가 넘게 걸린다(spawn + initialize + newSession). 그동안 창을 세워 두지 않는다:
  // ready를 먼저 보낸다. 지난 세션 목록은 **창이 물어볼 때만** 간다 — 붙을 때마다 훑으면 탭 수만큼 곱해진다.
  send(ws, { type: 'ready' })

  // 대화가 오래 조용하면(에이전트가 긴 작업 중이거나 사용자가 읽고만 있을 때) 중간 장비가 유휴 소켓을
  // 끊는다 — 창은 되감기로 복구하지만 그때마다 화면이 한 번 출렁인다. 30초 핑으로 살아 있다고 알린다
  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping()
  }, 30_000)
  keepAlive.unref?.()
  ws.on('close', () => clearInterval(keepAlive))

  // 세션이 준비되기 전에 온 말은 버리지 않고 줄을 세운다 — 예전에는 조용히 사라졌다
  // (뜨는 데 몇 초가 걸리므로 그 사이에 보낸 첫 질문이 실제로 없어졌다)
  let session: AgentSession | null = null
  const early: ClientMessage[] = []
  let detach = () => {}

  const handle = (msg: ClientMessage) => {
    // 목록은 디스크만 읽는다 — 자식 프로세스가 뜨기를 기다리지 않는다(세션의 listSessions와 같은 지름길)
    if (msg.type === 'list_sessions' && runtime === 'claude') {
      void listSessionsFromDisk(WORKSPACE_ROOT)
        .then((sessions) => send(ws, { type: 'sessions', sessions }))
        .catch(fail)
      return
    }
    if (!session) {
      early.push(msg)
      return
    }
    const live = session
    try {
      if (msg.type === 'prompt') live.prompt(msg.text)
      else if (msg.type === 'cancel') live.cancel()
      else if (msg.type === 'permission') live.answerPermission(msg.id, msg.optionId)
      else if (msg.type === 'unqueue') live.unqueue(msg.index)
      else if (msg.type === 'move_queued') live.moveQueued(msg.from, msg.to)
      else if (msg.type === 'edit_queued') live.editQueued(msg.index, msg.text, msg.expect)
      else if (msg.type === 'set_model') void live.setModel(msg.modelId).catch(fail)
      else if (msg.type === 'set_mode') void live.setMode(msg.modeId).catch(fail)
      else if (msg.type === 'load_session') void live.loadSession(msg.sessionId).catch(fail)
      else if (msg.type === 'list_sessions')
        void live
          .listSessions()
          .then((sessions) => send(ws, { type: 'sessions', sessions }))
          .catch(fail)
      else if (msg.type === 'close_session') {
        detach()
        disposeSession(runtime, tab)
        ws.close()
      }
    } catch (err) {
      fail(err)
    }
  }

  ws.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      return
    }
    handle(msg)
  })

  let started: AgentSession
  try {
    started = await sessionFor(runtime, tab)
  } catch (err) {
    send(ws, { type: 'fatal', message: err instanceof Error ? err.message : String(err) })
    ws.close()
    return
  }
  // 뜨는 동안 창이 닫혔다 — 세션은 그대로 두고(유휴 타이머가 정리) 여기서 손을 뗀다
  if (ws.readyState !== ws.OPEN) return
  session = started
  // 창을 닫아도 세션은 남는다(agentAcp의 유휴 타이머가 정리) — 재접속하면 지나간 대화를 되받는다.
  // 되감기는 **한 프레임**이다: 창이 그걸로 통째로 갈아끼우므로 재접속 순간에도 대화가 비지 않는다.
  // 스냅샷을 읽고 붙이는 사이에 await가 없어야 이벤트가 새지 않는다(둘 사이는 동기 코드여야 한다).
  send(ws, { type: 'replay', events: session.snapshot() })
  detach = session.attach((event) => send(ws, event))
  ws.on('close', () => detach())
  for (const msg of early.splice(0)) handle(msg)
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
    // 프로젝트가 아니라 런타임+탭으로 붙는다 — 세션 스코프는 워크스페이스고, 대화를 나누는 축은 탭이다(ADR 0043)
    const runtime = url.searchParams.get('runtime') || DEFAULT_RUNTIME
    const tab = url.searchParams.get('tab') || 'default'
    if (!isRuntime(runtime) || !TAB_ID.test(tab)) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, runtime, tab)
    })
  })
}
