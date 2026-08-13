// 에이전트셋 창 WS 릴레이 — 그리드 상태를 흘리고, 창의 프롬프트·큐 편집·승인을 러너로 되돌려 준다.
//
// 에이전트 창(agentWs.ts)과 달리 **연결이 세션을 만들지 않는다**. 세션을 들고 있는 것은 러너이고,
// 이 소켓은 구경창일 뿐이다 — 창을 닫아도 돌던 작업은 그대로 간다.
//
// 셸 접근 = 보안 경계. 에이전트 창·tmux와 **같은 집합**(owner/manager)이다 — 셋도 Bash를 쓴다.
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { isRuntime, modelsByRuntime, probeModels } from './agentAcp.ts'
import {
  answerPermission,
  cancelTask,
  pushState,
  queueOp,
  stopSet,
  submit,
  subscribeSets,
  taskDetail,
  viewSets,
  type SetServerMessage,
} from './agentSetRunner.ts'

export const AGENT_SET_WS_PATH = '/api/agentset/ws'

type ClientMessage =
  | { type: 'submit'; text: string; setId?: string | null }
  | { type: 'open_task'; taskId: string | null }
  | { type: 'cancel_task'; taskId: string }
  | { type: 'queue'; setId: string; op: { type: 'unqueue' | 'move' | 'edit'; [k: string]: unknown } }
  | { type: 'permission'; setId: string; id: string; optionId: string | null }
  | { type: 'stop_set'; setId: string }
  /** 그 런타임의 모델 후보를 모를 때 — 세션을 잠깐 띄워 알아본다(셋 편집 창이 열릴 때만 온다) */
  | { type: 'probe_models'; runtime: string }

function send(ws: WebSocket, payload: SetServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

function handleConnection(ws: WebSocket) {
  // 창이 지금 펼쳐 둔 작업 — 이벤트 델타는 이 하나만 흘려 보낸다(전부 보내면 그리드만 보는 창에도
  // 스트리밍 청크가 통째로 쏟아진다)
  let openTaskId: string | null = null

  const unsubscribe = subscribeSets((msg) => {
    if (msg.type === 'task_events' && msg.taskId !== openTaskId) return
    send(ws, msg)
  })
  ws.on('close', unsubscribe)

  // 붙자마자 지금 상태를 통째로 준다 — 그리드는 이걸로 바로 그려진다
  send(ws, { type: 'state', sets: viewSets(), models: modelsByRuntime() })

  // 유휴 소켓을 끊는 중간 장비 대비(에이전트 창과 같은 30초 핑)
  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping()
  }, 30_000)
  keepAlive.unref?.()
  ws.on('close', () => clearInterval(keepAlive))

  ws.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      return
    }
    try {
      if (msg.type === 'submit') {
        const result = submit(String(msg.text ?? ''), msg.setId ?? null)
        if (!result.ok) send(ws, { type: 'error', message: result.message ?? '보내지 못했습니다' })
      } else if (msg.type === 'open_task') {
        openTaskId = msg.taskId
        if (msg.taskId) {
          const detail = taskDetail(msg.taskId)
          if (detail) send(ws, detail)
        }
      } else if (msg.type === 'cancel_task') cancelTask(String(msg.taskId))
      else if (msg.type === 'queue') queueOp(String(msg.setId), msg.op)
      else if (msg.type === 'permission') answerPermission(String(msg.setId), String(msg.id), msg.optionId ?? null)
      else if (msg.type === 'stop_set') stopSet(String(msg.setId))
      else if (msg.type === 'probe_models') {
        const runtime = String(msg.runtime)
        if (!isRuntime(runtime)) return
        // 결과는 다음 state에 실려 모든 창으로 간다 — 물어본 창만 받을 이유가 없다
        void probeModels(runtime)
          .then(() => pushState())
          .catch((err: unknown) =>
            send(ws, {
              type: 'error',
              message: `${runtime} 모델 목록을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
            }),
          )
      }
    } catch (err) {
      send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })
}

export function attachAgentSetWebSocket(
  httpServer: HttpServer | Http2SecureServer,
  opts: { authorize?: (req: IncomingMessage) => boolean } = {},
) {
  const wss = new WebSocketServer({ noServer: true })
  httpServer.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== AGENT_SET_WS_PATH) return
    if (opts.authorize && !opts.authorize(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws))
  })
}
