// 에이전트 창 WS 릴레이 — ACP 세션의 이벤트를 브라우저로 흘리고, 브라우저의 프롬프트·취소·승인을 되돌려 준다.
//
// 셸 접근 = 보안 경계. authorize는 tmux와 **같은 집합**(owner/manager)이어야 한다 — 에이전트는 Bash를
// 쓸 수 있으므로 더 낮은 게이트로 열면 터미널 경계를 우회하는 것이 된다(ADR 0034).
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_RUNTIME, isRuntime, type AgentEvent } from './agentAcp.ts'
import { connectAgentHost, type AgentHostClient } from './agentHost.ts'
import { composeRuntimePrompt } from './agentRuntimes.ts'
import { listSessionsFromDisk } from './agentSessionList.ts'
import { WORKSPACE_ROOT } from './paths.ts'
import { listSkills } from './skills.ts'

export const AGENT_WS_PATH = '/api/agent/ws'

/** 탭 식별자 — 브라우저가 만들어 보내는 불투명한 값이다. 맵 열쇠로만 쓰지만 길이는 묶어 둔다 */
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/

type ClientMessage =
  | { type: 'prompt'; text: string; skills?: string[] }
  | { type: 'cancel' }
  | { type: 'permission'; id: string; optionId: string | null }
  | { type: 'authenticate'; methodId: string; secret?: string }
  | { type: 'retry_auth' }
  | { type: 'auth_url_response'; id: string; action: 'accept' | 'decline' | 'cancel' }
  | { type: 'set_model'; modelId: string }
  | { type: 'set_mode'; modeId: string }
  | { type: 'unqueue'; index: number }
  | { type: 'move_queued'; from: number; to: number }
  /** expect = 창이 보고 있던 원본 — 그 사이 큐가 당겨졌으면 서버가 무시한다 */
  | { type: 'edit_queued'; index: number; text: string; expect: string; skills?: string[] }
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

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const details = Object.fromEntries(
      Object.entries(err as Error & Record<string, unknown>).filter(([key]) => key !== 'name' && key !== 'message' && key !== 'stack'),
    )
    const extra = Object.keys(details).length > 0 ? `\n${JSON.stringify(details, null, 2)}` : ''
    return `${err.message}${extra}`
  }
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message
    const head = typeof message === 'string' ? message : '에이전트 오류'
    return `${head}\n${JSON.stringify(err, null, 2)}`
  }
  return String(err)
}

function promptForRuntime(runtime: string, text: string, skillNames: string[] | undefined): string {
  if (!Array.isArray(skillNames) || skillNames.length === 0) return text
  const wanted = new Set(skillNames.filter((name): name is string => typeof name === 'string'))
  const skills = listSkills().filter((skill) => wanted.has(skill.name))
  return composeRuntimePrompt(runtime, text, skills)
}

async function handleConnection(ws: WebSocket, runtime: string, tab: string) {
  const fail = (err: unknown) => send(ws, { type: 'error', message: describeError(err) })

  // 에이전트가 뜨는 데는 1초가 넘게 걸린다(spawn + initialize + newSession). 그동안 창을 세워 두지 않는다:
  // ready를 먼저 보낸다. 지난 세션 목록은 **창이 물어볼 때만** 간다 — 붙을 때마다 훑으면 탭 수만큼 곱해진다.
  send(ws, { type: 'ready' })

  // 대화가 오래 조용하면(에이전트가 긴 작업 중이거나 사용자가 읽고만 있을 때) 중간 장비가 유휴 소켓을
  // 끊는다 — 창은 되감기로 복구하지만 그때마다 화면이 한 번 출렁인다. 30초 핑으로 살아 있다고 알린다
  let alive = true
  ws.on('pong', () => { alive = true })
  const keepAlive = setInterval(() => {
    if (!alive) {
      ws.terminate()
      return
    }
    if (ws.readyState === ws.OPEN) {
      alive = false
      ws.ping()
    }
  }, 30_000)
  keepAlive.unref?.()
  ws.on('close', () => clearInterval(keepAlive))

  // 세션이 준비되기 전에 온 말은 버리지 않고 줄을 세운다 — 예전에는 조용히 사라졌다
  // (뜨는 데 몇 초가 걸리므로 그 사이에 보낸 첫 질문이 실제로 없어졌다)
  let session: AgentHostClient | null = null
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
      if (msg.type === 'prompt') live.send({ type: 'prompt', text: msg.text, promptText: promptForRuntime(runtime, msg.text, msg.skills) })
      else if (msg.type === 'cancel') live.send({ type: 'cancel' })
      else if (msg.type === 'permission') live.send({ type: 'permission', id: msg.id, optionId: msg.optionId })
      // 인증 실패는 대화 오류가 아니라 auth 상태의 error로 돌아간다. 여기서 error 이벤트를 하나 더 보내지 않는다.
      else if (msg.type === 'authenticate') live.send({ type: 'authenticate', methodId: msg.methodId, secret: msg.secret })
      else if (msg.type === 'retry_auth') live.send({ type: 'retry_auth' })
      else if (msg.type === 'auth_url_response') live.send({ type: 'auth_url_response', id: msg.id, action: msg.action })
      else if (msg.type === 'unqueue') live.send({ type: 'unqueue', index: msg.index })
      else if (msg.type === 'move_queued') live.send({ type: 'move_queued', from: msg.from, to: msg.to })
      else if (msg.type === 'edit_queued')
        live.send({
          type: 'edit_queued',
          index: msg.index,
          text: msg.text,
          expect: msg.expect,
          promptText: promptForRuntime(runtime, msg.text, msg.skills),
        })
      else if (msg.type === 'set_model') live.send({ type: 'set_model', modelId: msg.modelId })
      else if (msg.type === 'set_mode') live.send({ type: 'set_mode', modeId: msg.modeId })
      else if (msg.type === 'load_session') live.send({ type: 'load_session', sessionId: msg.sessionId })
      else if (msg.type === 'list_sessions')
        void live
          .request<{ sessionId: string; title?: string | null; updatedAt?: string | null }[]>({ type: 'list_sessions' })
          .then((sessions) => send(ws, { type: 'sessions', sessions }))
          .catch(fail)
      else if (msg.type === 'close_session') {
        live.send({ type: 'close_session' })
        live.close()
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

  let started: AgentHostClient
  try {
    started = await connectAgentHost(runtime, tab, WORKSPACE_ROOT, {
      onReplay: (events) => send(ws, { type: 'replay', events }),
      onEvent: (event) => send(ws, event),
      onFatal: (message) => {
        send(ws, { type: 'fatal', message })
        ws.close()
      },
      onClose: () => {
        if (ws.readyState !== ws.OPEN) return
        send(ws, { type: 'fatal', message: '에이전트 감독 연결이 끊겼습니다' })
        ws.close()
      },
    })
  } catch (err) {
    send(ws, { type: 'fatal', message: describeError(err) })
    ws.close()
    return
  }
  session = started
  // 준비 중 받은 프롬프트는 창이 그 사이 닫혔어도 감독에 먼저 인계한다. 프론트 종료가 이미 수락한
  // 작업을 취소하는 신호가 되어서는 안 된다.
  for (const msg of early.splice(0)) handle(msg)
  if (ws.readyState !== ws.OPEN) {
    started.close()
    return
  }
  detach = () => session?.close()
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
