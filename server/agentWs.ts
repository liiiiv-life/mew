import { withWorkspaceUpgrade } from './reqAuth.ts'
import { bindMewcat, type MewcatBinding } from './mewcat-assistant.ts'
import { resolveAuth } from './reqAuth.ts'
import type { MewcatClientMessage, MewcatActionRequest } from '../shared/mewcat-assistant.ts'
import { validHistoryRequest, type HistoryRequest, type HistoryPage, type HistoryPosition } from '../shared/agent-history.ts'
import { attachmentPrompt, type AgentAttachmentInput } from '../shared/agent-attachment.ts'
import { watchSocketAccess } from './access-socket.ts'
// 에이전트 창 WS 릴레이 — ACP 세션의 이벤트를 브라우저로 흘리고, 브라우저의 프롬프트·취소·승인을 되돌려 준다.
//
// 에이전트는 셸 도구를 사용할 수 있다. authorize는 계정별 agent 기능을 검사한다(ADR 0150).
// 파일 ACL은 에이전트 도구를 샌드박싱하지 않는다.
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_RUNTIME, isAcpRuntime, type AgentEvent, type AgentImageRef, type AgentMessageSettings } from './agentAcp.ts'
import { connectAgentHost, type AgentHostClient } from './agentHost.ts'
import { composeRuntimePrompt } from './agentRuntimes.ts'
import { listSessionsFromDisk } from './agentSessionList.ts'
import { workspacePaths } from './paths.ts'
import { listSkills } from './skills.ts'
import { resolveAgentCwd } from './agentCwd.ts'

export const AGENT_WS_PATH = '/api/agent/ws'

/** 탭 식별자 — 브라우저가 만들어 보내는 불투명한 값이다. 맵 열쇠로만 쓰지만 길이는 묶어 둔다 */
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

type ClientMessage = MewcatClientMessage
  | { type: 'history'; range: HistoryRequest }
  | { type: 'prompt'; text: string; displayText?: string; images?: AgentImage[]; imageRefs?: AgentImageRef[]; skills?: string[]; settings?: AgentMessageSettings; attachments?: AgentAttachmentInput[] }
  | { type: 'cancel' }
  | { type: 'permission'; id: string; optionId: string | null }
  | { type: 'authenticate'; methodId: string; secret?: string }
  | { type: 'retry_auth'; methodId?: string }
  | { type: 'auth_url_response'; id: string; action: 'accept' | 'decline' | 'cancel' }
  | { type: 'set_model'; modelId: string }
  | { type: 'set_mode'; modeId: string }
  | { type: 'set_thinking'; configId: string; value: string }
  | { type: 'unqueue'; index: number }
  | { type: 'move_queued'; from: number; to: number }
  | { type: 'begin_edit_queued'; index: number; expect: string }
  | { type: 'cancel_edit_queued'; index: number; expect: string }
  /** expect = 창이 보고 있던 원본 — 그 사이 큐가 당겨졌으면 서버가 무시한다 */
  | { type: 'edit_queued'; index: number; text: string; expect: string; skills?: string[]; attachments?: AgentAttachmentInput[]; settings?: AgentMessageSettings }
  /** `/clear`: 앞선 작업 뒤 새 ACP 세션을 여는 큐 경계 */
  | { type: 'clear_session' }
  | { type: 'list_sessions' }
  | { type: 'load_session'; sessionId: string }
  /** 탭을 닫았다 — 창만 닫은 것과 달리 세션도 여기서 끝난다 */
  | { type: 'close_session' }

type AgentImage = { data: string; mimeType: string }

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_AGENT_IMAGE_DATA_CHARS = Math.ceil(10 * 1024 * 1024 * 4 / 3)
const MAX_AGENT_IMAGE_TOTAL_CHARS = Math.ceil(20 * 1024 * 1024 * 4 / 3)

function validImages(value: unknown): AgentImage[] {
  if (!Array.isArray(value)) return []
  const images = value.filter((image): image is AgentImage =>
    typeof image?.data === 'string'
    && image.data.length <= MAX_AGENT_IMAGE_DATA_CHARS
    && typeof image?.mimeType === 'string'
    && IMAGE_MIME_TYPES.has(image.mimeType),
  )
  return images.reduce((total, image) => total + image.data.length, 0) <= MAX_AGENT_IMAGE_TOTAL_CHARS ? images : []
}

function validImageRefs(value: unknown): AgentImageRef[] {
  if (!Array.isArray(value)) return []
  return value.filter((image): image is AgentImageRef =>
    typeof image?.path === 'string'
    && image.path.startsWith('.mew/files/')
    && typeof image?.mimeType === 'string'
    && IMAGE_MIME_TYPES.has(image.mimeType),
  )
}

function validAttachments(value: unknown, runtime: string): AgentAttachmentInput[] | undefined {
  if (!Array.isArray(value)) return undefined
  const files: AgentAttachmentInput[] = value.filter(file =>
    typeof file?.project === 'string' && typeof file?.path === 'string'
    && file.path.startsWith('.mew/files/') && typeof file?.mimeType === 'string',
  ).map(file => ({
    project: file.project, path: file.path, mimeType: file.mimeType,
    image: runtime === 'codex' ? validImages([file.image])[0] : undefined,
  }))
  if (validImages(files.flatMap(file => file.image ? [file.image] : [])).length !== files.filter(file => file.image).length) {
    throw new Error('첨부 사진의 전체 크기가 제한을 초과했습니다')
  }
  return files
}

function validSettings(value: unknown): AgentMessageSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { model, thinking, permission } = value as Partial<AgentMessageSettings>
  if (typeof model !== 'string' || typeof thinking !== 'string' || typeof permission !== 'string') return undefined
  if (model.length > 160 || thinking.length > 160 || permission.length > 160) return undefined
  const ids: Partial<AgentMessageSettings> = {}
  for (const key of ['modelId', 'thinkingId', 'thinkingConfigId', 'modeId'] as const) {
    const id = (value as AgentMessageSettings)[key]
    if (id !== undefined) {
      if (typeof id !== 'string' || id.length > 300) return undefined
      ids[key] = id
    }
  }
  return { model, thinking, permission, ...ids }
}

type ServerMessage =
  | { type: 'history'; page: HistoryPage<AgentEvent>; restoreFailure?: { sessionId: string; message: string } }
  | { type: 'history_event'; event: AgentEvent; position: HistoryPosition }
  | AgentEvent
  | MewcatActionRequest
  | { type: 'ready'; cwd: string }
  | { type: 'fatal'; message?: string }
  // 목록은 물어본 창에만 답한다 — 상태가 아니라 조회 결과라 이벤트 버퍼에 넣지 않는다
  | { type: 'sessions'; sessions: { sessionId: string; title?: string | null; updatedAt?: string | null }[] }
  // 지나간 대화는 한 덩어리로 간다 — 창은 이걸 받아 지금 그린 대화를 통째로 갈아끼운다
  | { type: 'replay'; events: AgentEvent[]; restored?: boolean; restoreFailure?: { sessionId: string; message: string } }

const accessChecks = new WeakMap<WebSocket, () => boolean>()
function send(ws: WebSocket, payload: ServerMessage) {
  if (accessChecks.get(ws)?.() === false) { ws.terminate(); return }
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

function promptForRuntime(runtime: string, cwd: string, text: string, skillNames: string[] | undefined): string {
  if (!Array.isArray(skillNames) || skillNames.length === 0) return text
  const wanted = new Set(skillNames.filter((name): name is string => typeof name === 'string'))
  const skills = listSkills(cwd, runtime).filter((skill) => wanted.has(skill.name))
  return composeRuntimePrompt(runtime, text, skills)
}

async function handleConnection(
  ws: WebSocket,
  runtime: string,
  tab: string,
  cwd: string,
  resumeSessionId: string | null,
  preset: { modelId: string; role: string; thinkingId: string; thinkingConfigId: string },
  history?: HistoryRequest,
  assistant?: MewcatBinding,
) {
  const fail = (err: unknown) => send(ws, { type: 'error', message: describeError(err) })

  // 에이전트가 뜨는 데는 1초가 넘게 걸린다(spawn + initialize + newSession). 그동안 창을 세워 두지 않는다:
  // ready를 먼저 보낸다. 지난 세션 목록은 **창이 물어볼 때만** 간다 — 붙을 때마다 훑으면 탭 수만큼 곱해진다.
  send(ws, { type: 'ready', cwd })

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
  let rolePending = !resumeSessionId && preset.role.length > 0
  const early: ClientMessage[] = []
  let detach = () => {}

  const handle = (msg: ClientMessage) => {
    if (accessChecks.get(ws)?.() === false) { ws.terminate(); return }
    if (msg.type === 'mewcat_context' || msg.type === 'mewcat_action_result') {
      try { assistant?.handle(msg) } catch { ws.close() }
      return
    }
    // 목록은 디스크만 읽는다 — 자식 프로세스가 뜨기를 기다리지 않는다(세션의 listSessions와 같은 지름길)
    if (msg.type === 'list_sessions' && runtime === 'claude') {
      void listSessionsFromDisk(cwd)
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
      if (msg.type === 'history') {
        if (history) void live.request<HistoryPage<AgentEvent>>({ type: 'history', range: validHistoryRequest(msg.range) })
          .then(page => send(ws, { type: 'history', page })).catch(fail)
      }
      else if (msg.type === 'prompt') {
        const prompt = rolePending ? `${preset.role}\n\n---\n\n${msg.text}` : msg.text
        rolePending = false
        // Codex ACP는 이미지 블록을 지원한다. 다른 런타임에는 파일 경로 참조만 보낸다.
        const images = runtime === 'codex' ? validImages(msg.images) : []
        const imageRefs = validImageRefs(msg.imageRefs)
        // 첨부 경로는 에이전트가 읽게 하되, 대화 창에는 사용자가 쓴 프롬프트만 남긴다.
        const displayText = typeof msg.displayText === 'string' ? msg.displayText : msg.text
        const attachments = validAttachments(msg.attachments, runtime)?.map(({ project, path, mimeType }) => ({ project, path, mimeType }))
        live.send({ type: 'prompt', text: displayText, promptText: assistant ? assistant.prompt(prompt) : promptForRuntime(runtime, cwd, prompt, msg.skills), images, imageRefs, settings: validSettings(msg.settings), attachments })
      }
      else if (msg.type === 'cancel') live.send({ type: 'cancel' })
      else if (msg.type === 'permission') live.send({ type: 'permission', id: msg.id, optionId: msg.optionId })
      // 인증 실패는 대화 오류가 아니라 auth 상태의 error로 돌아간다. 여기서 error 이벤트를 하나 더 보내지 않는다.
      else if (msg.type === 'authenticate') live.send({ type: 'authenticate', methodId: msg.methodId, secret: msg.secret })
      else if (msg.type === 'retry_auth') live.send({ type: 'retry_auth', methodId: msg.methodId })
      else if (msg.type === 'auth_url_response') live.send({ type: 'auth_url_response', id: msg.id, action: msg.action })
      else if (msg.type === 'unqueue') live.send({ type: 'unqueue', index: msg.index })
      else if (msg.type === 'move_queued') live.send({ type: 'move_queued', from: msg.from, to: msg.to })
      else if (msg.type === 'begin_edit_queued') live.send({ type: 'begin_edit_queued', index: msg.index, expect: msg.expect })
      else if (msg.type === 'cancel_edit_queued') live.send({ type: 'cancel_edit_queued', index: msg.index, expect: msg.expect })
      else if (msg.type === 'edit_queued') {
        const attachments = validAttachments(msg.attachments, runtime)
        live.send({
          type: 'edit_queued',
          settings: validSettings(msg.settings),
          index: msg.index,
          text: msg.text,
          expect: msg.expect,
          promptText: promptForRuntime(runtime, cwd, attachments ? attachmentPrompt(msg.text, attachments) : msg.text, msg.skills),
          attachments,
        })
      }
      else if (msg.type === 'clear_session') live.send({ type: 'clear_session' })
      else if (msg.type === 'set_model') live.send({ type: 'set_model', modelId: msg.modelId })
      else if (msg.type === 'set_mode') live.send({ type: 'set_mode', modeId: msg.modeId })
      else if (msg.type === 'set_thinking') live.send({ type: 'set_thinking', configId: msg.configId, value: msg.value })
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
    started = await connectAgentHost(runtime, tab, cwd, {
      history,
      onHistory: (page, restoreFailure) => send(ws, { type: 'history', page, ...(restoreFailure ? { restoreFailure } : {}) }),
      onReplay: (events, restored, restoreFailure) => send(ws, {
        type: 'replay',
        events,
        ...(restored ? { restored: true } : {}),
        ...(restoreFailure ? { restoreFailure } : {}),
      }),
      onEvent: (event, _replayed, position) => send(ws, position ? { type: 'history_event', event, position } : event),
      onFatal: (message) => {
        send(ws, { type: 'fatal', message })
        ws.close()
      },
      onClose: () => {
        if (ws.readyState !== ws.OPEN) return
        // 유휴 종료도 이 길을 탄다. 재접속할 일시 단절을 대화 오류로 남기지 않는다.
        ws.close()
      },
    }, resumeSessionId, undefined, assistant?.mcpServers)
  } catch (err) {
    send(ws, { type: 'fatal', message: describeError(err) })
    ws.close()
    return
  }
  session = started
  if (preset.modelId) {
    // 이 탭이 큐에 넣은 첫 프롬프트보다 앞에서 적용한다. 없는 모델은 런타임 기본값으로 조용히 계속한다.
    started.send({ type: 'set_model', modelId: preset.modelId })
  }
  if (runtime !== 'codex' && preset.thinkingId && preset.thinkingConfigId) {
    started.send({ type: 'set_thinking', configId: preset.thinkingConfigId, value: preset.thinkingId })
  }
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
  httpServer.on('upgrade', withWorkspaceUpgrade((req, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== AGENT_WS_PATH) return
    if (opts.authorize && !opts.authorize(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    // 런타임+탭+cwd로 붙는다. cwd는 워크스페이스 밖도 가능하지만 실제 폴더인지 먼저 검사한다(ADR 0077).
    const runtime = url.searchParams.get('runtime') || DEFAULT_RUNTIME
    let tab = url.searchParams.get('tab') || 'default'
    const browser = url.searchParams.get('mewcat')
    const resumeSessionId = url.searchParams.get('resume')
    const modelId = url.searchParams.get('model') ?? ''
    const role = url.searchParams.get('role') ?? ''
    const thinkingId = url.searchParams.get('thinking') ?? ''
    const thinkingConfigId = url.searchParams.get('thinkingConfig') ?? ''
    let cwd: string
    try {
      cwd = resolveAgentCwd(url.searchParams.get('cwd') ?? '', workspacePaths.root)
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (!isAcpRuntime(runtime) || !TAB_ID.test(tab)
      || (resumeSessionId !== null && !SESSION_ID.test(resumeSessionId))
      || (browser !== null && !TAB_ID.test(browser))
      || modelId.length > 120 || role.length > 4_000 || thinkingId.length > 120 || thinkingConfigId.length > 120) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      accessChecks.set(ws, () => opts.authorize?.(req) ?? true)
      watchSocketAccess(ws, req, opts.authorize)
      void (async () => {
        let assistant: MewcatBinding | undefined
        if (browser) {
          const account = resolveAuth(req).email
          if (!account) { ws.close(); return }
          const bindingOptions = { account, browser, runtime,
            authorized: () => ws.readyState === ws.OPEN && (opts.authorize?.(req) ?? false),
            owner: () => resolveAuth(req).role === 'owner',
            superseded: () => ws.close(),
            send: (message: MewcatActionRequest) => send(ws, message),
          }
          assistant = await bindMewcat(bindingOptions)
          tab = assistant.tab
          cwd = assistant.cwd
          ws.on('close', () => { if (assistant?.options === bindingOptions) assistant.disconnect() })
          if (ws.readyState !== ws.OPEN) { assistant.disconnect(); return }
        }
        await handleConnection(ws, runtime, tab, cwd, resumeSessionId, { modelId, role, thinkingId, thinkingConfigId }, url.searchParams.get('history') === '1'
          ? validHistoryRequest({ generation: url.searchParams.get('generation'), after: url.searchParams.has('after') ? Number(url.searchParams.get('after')) : undefined }) : undefined, assistant)
      })().catch(() => { send(ws, { type: 'fatal', message: 'MEWCAT_CONNECTION_FAILED' }); ws.close() })
    })
  }))
}
