// 에이전트 탭의 독립 감독 프로세스와 mew 쪽 유닉스 소켓 클라이언트.
//
// 브라우저 WS와 ACP 프로세스의 수명을 끊는 경계다. 탭마다 이 파일을 별도 Node 프로세스로 띄우고,
// mew 서버는 로컬 소켓으로만 명령·이벤트를 중계한다. 따라서 브라우저가 닫히거나 mew가 재시작돼도
// 감독과 그 아래 ACP/CLI는 그대로 작업을 마친다(ADR 0048).
import './config.ts'
import { captureAgentContext } from './agent-context.ts'
import type { AgentContextBinding } from '../shared/project-agent-context.ts'
import crypto from 'node:crypto'
import { execFile, execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net, { type Socket } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AGENT_IDLE_MS,
  AgentSession,
  isAcpRuntime,
  runtimeLoginAuthEvent,
  type AgentEvent,
  type AgentImageRef,
  type AgentMessageSettings,
  type TerminalAuthSpec,
} from './agentAcp.ts'
import { isRuntimeLoginMethod, runtimeLoginSpec } from './agentRuntimes.ts'
import { DATA_DIR } from './dataDir.ts'
import { createTmuxManager } from '@mew/tmux-term/server'
import { AgentCommandStore, type AgentCommandInput } from './agent-commands.ts'
import { queueAgentCommand } from './agent-command-queue.ts'
import type { AgentCommandRecord } from '../shared/agent-command.ts'

const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const HOST_DIR = path.join(DATA_DIR, 'agent')
const HOST_FILE = fileURLToPath(import.meta.url)
const CONNECT_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 30_000
const MAX_LINE_BYTES = 64 * 1024 * 1024

export type AgentHostCommand =
  | { type: 'prompt'; text: string; promptText: string; images?: AgentImage[]; imageRefs?: AgentImageRef[]; settings?: AgentMessageSettings }
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
  | { type: 'edit_queued'; index: number; text: string; expect: string; promptText: string }
  | { type: 'clear_session' }
  | { type: 'load_session'; sessionId: string }
  | { type: 'close_session' }

type AgentImage = { data: string; mimeType: string }

type AgentHostRequest =
  | { type: 'queue_command'; owner: string; input: AgentCommandInput }
  | { type: 'list_sessions' }
  | { type: 'terminal_auth'; methodId: string }

type HostInbound =
  | { type: 'command'; command: AgentHostCommand }
  | { type: 'request'; id: string; request: AgentHostRequest }

type HostOutbound =
  | { type: 'hello'; runtime: string; tab: string; cwd: string }
  | { type: 'replay'; events: AgentEvent[]; restored?: boolean; restoreFailure?: { sessionId: string; message: string } }
  | { type: 'event'; event: AgentEvent }
  | { type: 'response'; id: string; ok: true; value: unknown }
  | { type: 'response'; id: string; ok: false; error: string }
  | { type: 'fatal'; message: string }

type HostMeta = {
  pid: number
  runtime: string
  tab: string
  cwd: string
  socket: string
  startedAt: string
}

type Peer = {
  id: string
  socket: Socket
  detach: (() => void) | null
}

export function describeError(err: unknown): string {
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

function pathsFor(runtime: string, tab: string, cwd: string) {
  // sockaddr_un은 대개 108바이트 제한이라 tab/cwd를 파일명에 그대로 넣지 않는다.
  const digest = crypto.createHash('sha256').update(`${cwd}\0${runtime}\0${tab}`).digest('hex').slice(0, 24)
  const base = `${runtime}-${digest}`
  return {
    socket: path.join(HOST_DIR, `${base}.sock`),
    meta: path.join(HOST_DIR, `${base}.json`),
    log: path.join(HOST_DIR, `${base}.log`),
  }
}

function sendLine(socket: Socket, message: HostOutbound) {
  if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(message)}\n`)
}

function installLineReader(socket: Socket, receive: (message: unknown) => void, overflow: () => void) {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      overflow()
      return
    }
    while (true) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try {
        receive(JSON.parse(line))
      } catch {
        // 같은 유닉스 사용자만 붙는 내부 채널이다. 깨진 한 줄만 버리고 다음 프레임은 계속 받는다.
      }
    }
  })
}

async function listenOnSocket(server: net.Server, socketPath: string): Promise<void> {
  fs.mkdirSync(HOST_DIR, { recursive: true, mode: 0o700 })
  fs.chmodSync(HOST_DIR, 0o700)

  const listen = () => new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(socketPath)
  })

  try {
    await listen()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    // 살아 있는 감독이 먼저 자리를 잡은 경합이면 그쪽을 남긴다. 연결조차 안 되는 파일만 stale이다.
    const occupied = await new Promise<boolean>((resolve) => {
      const probe = net.createConnection(socketPath)
      probe.once('connect', () => {
        probe.end()
        resolve(true)
      })
      probe.once('error', () => resolve(false))
    })
    if (occupied) throw new Error('AGENT_HOST_ALREADY_RUNNING')
    fs.rmSync(socketPath, { force: true })
    await listen()
  }
  fs.chmodSync(socketPath, 0o600)
}

async function runHost(runtime: string, tab: string, cwd: string, resumeSessionId: string | null = null) {
  if (!isAcpRuntime(runtime) || !TAB_ID.test(tab) || !path.isAbsolute(cwd)
    || (resumeSessionId !== null && !SESSION_ID.test(resumeSessionId))) {
    throw new Error('올바르지 않은 에이전트 감독 인자입니다')
  }
  const files = pathsFor(runtime, tab, cwd)
  const peers = new Set<Peer>()
  const early: Array<{ peer: Peer; message: HostInbound }> = []
  let session: AgentSession | null = null
  let sessionStarting = false
  let startupError: string | null = null
  let startupIdleTimer: NodeJS.Timeout | null = null
  let stopping = false
  let ownsFiles = false
  // 유휴 종료 후 새 감독이 뜨는 첫 한 번만 탭의 마지막 ACP 세션을 이어받는다.
  let initialResumeSessionId = resumeSessionId
  // 복원 실패 뒤 만든 빈 세션이 원래 탭 포인터를 덮지 않도록 브라우저에 실패한 ID를 함께 알린다.
  let restoreFailure: { sessionId: string; message: string } | null = null

  const fallbackTerminalSpec = (methodId: string): TerminalAuthSpec => {
    const { cmd, args, env, label, completionFile } = runtimeLoginSpec(runtime, methodId)
    return { cmd, args, env, label, completionFile }
  }

  const registeredAcpMethodId = (methodId: string): string | undefined => (
    isRuntimeLoginMethod(runtime, methodId) ? runtimeLoginSpec(runtime, methodId).acpMethodId : undefined
  )

  const broadcastEvent = (event: AgentEvent) => {
    for (const peer of peers) sendLine(peer.socket, { type: 'event', event })
  }

  const clearStartupIdle = () => {
    if (!startupIdleTimer) return
    clearTimeout(startupIdleTimer)
    startupIdleTimer = null
  }

  let startSession: (acpMethodId?: string) => Promise<void>
  let restartSession: () => Promise<void>
  let switchSession: (sessionId: string, peer: Peer) => Promise<void>
  let armStartupIdle: () => void
  let stop: (code?: number) => void

  const server = net.createServer((socket) => {
    const peer: Peer = { id: crypto.randomUUID(), socket, detach: null }
    peers.add(peer)
    clearStartupIdle()
    sendLine(socket, { type: 'hello', runtime, tab, cwd })

    const attach = () => {
      if (!session || socket.destroyed) return
      // snapshot과 attach 사이에는 await가 없어야 그 틈의 스트리밍 이벤트가 빠지지 않는다.
      sendLine(socket, { type: 'replay', events: session.snapshot(), ...(restoreFailure ? { restoreFailure } : {}) })
      peer.detach = session.attach((event) => sendLine(socket, { type: 'event', event }))
    }
    if (session) attach()
    else if (startupError) {
      sendLine(socket, {
        type: 'event',
        event: runtimeLoginAuthEvent(runtime, sessionStarting ? null : startupError, sessionStarting),
      })
    }

    const receive = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const message = raw as HostInbound
      if (message.type !== 'command' && message.type !== 'request') return
      if (!session) {
        if (message.type === 'request') {
          if (message.request.type === 'terminal_auth'
            && isRuntimeLoginMethod(runtime, String(message.request.methodId))) {
            sendLine(socket, { type: 'response', id: String(message.id), ok: true, value: fallbackTerminalSpec(String(message.request.methodId)) })
          } else if (sessionStarting && !startupError) {
            early.push({ peer, message })
          } else {
            sendLine(socket, {
              type: 'response',
              id: String(message.id),
              ok: false,
              error: '에이전트 로그인 후 다시 시도하세요',
            })
          }
          return
        }

        const command = message.command
        if (command.type === 'close_session') {
          stop()
        } else if (command.type === 'retry_auth') {
          void startSession(registeredAcpMethodId(String(command.methodId ?? '')))
        } else if (sessionStarting && !startupError) {
          // 프론트와 mew가 이 직후 모두 사라져도 시작 전에 받은 프롬프트는 인증 뒤까지 보존한다.
          // 비밀값은 실패 상태에서 쌓지 않는다. authenticate는 ACP가 뜬 경우에만 도달한다.
          if (command.type !== 'authenticate') early.push({ peer, message })
        } else {
          sendLine(socket, {
            type: 'event',
            event: { type: 'error', message: '로그인 터미널을 완료한 뒤 다시 확인하세요' },
          })
        }
        return
      }
      // 별도 CLI가 자격증명만 쓴 경우에는 ACP를 다시 initialize한다. 일부 런타임처럼 ACP authenticate가
      // 선택한 방식까지 설정에 저장하는 런타임은 살아 있는 연결에서 그 마지막 단계도 마친다.
      if (message.type === 'command' && message.command.type === 'retry_auth') {
        const methodId = String(message.command.methodId ?? '')
        const acpMethodId = registeredAcpMethodId(methodId)
        if (acpMethodId) void session.retryAuthentication(acpMethodId).catch(() => {})
        else void restartSession()
        return
      }
      void handleHostMessage(session, peer, message, stop, () => { restoreFailure = null }, switchSession)
    }
    installLineReader(socket, receive, () => socket.destroy())
    socket.on('close', () => {
      peer.detach?.()
      peer.detach = null
      session?.releaseQueuedEdits(peer.id)
      peers.delete(peer)
      armStartupIdle()
    })
    socket.on('error', () => {})
  })

  const cleanupFiles = () => {
    if (!ownsFiles) return
    ownsFiles = false
    fs.rmSync(files.socket, { force: true })
    fs.rmSync(files.meta, { force: true })
  }
  stop = (code = 0) => {
    if (stopping) return
    stopping = true
    clearStartupIdle()
    for (const peer of peers) {
      peer.detach?.()
      peer.socket.end()
    }
    peers.clear()
    server.close()
    cleanupFiles()
    if (session && !session.disposed) session.dispose()
    // 소켓의 마지막 프레임을 flush할 한 틱을 주되, 고장 난 peer 때문에 종료가 매달리지는 않게 한다.
    setTimeout(() => process.exit(code), 10)
  }

  armStartupIdle = () => {
    if (session || sessionStarting || peers.size > 0 || startupIdleTimer || stopping) return
    startupIdleTimer = setTimeout(() => stop(), AGENT_IDLE_MS)
    startupIdleTimer.unref?.()
  }

  startSession = async (acpMethodId) => {
    if (session || sessionStarting || stopping) return
    const recovering = startupError !== null
    sessionStarting = true
    clearStartupIdle()
    if (recovering) broadcastEvent(runtimeLoginAuthEvent(runtime, null, true))
    try {
      let started = await AgentSession.start(runtime, undefined, cwd)
      if (acpMethodId) await started.retryAuthentication(acpMethodId)
      const wantedSessionId = initialResumeSessionId
      initialResumeSessionId = null
      let restored = false
      if (wantedSessionId && started.canLoadSession) {
        try {
          await started.loadSession(wantedSessionId)
          restored = true
        } catch (err) {
          // 삭제·손상된 백엔드 기록 하나가 탭 전체를 못 열게 하지 않는다.
          console.error(`[mew:agent-host:${runtime}] 세션 ${wantedSessionId} 자동 복원 실패:`, err)
          restoreFailure = { sessionId: wantedSessionId, message: describeError(err) }
          await started.disposeAndWait()
          started = await AgentSession.start(runtime, undefined, cwd)
        }
      }
      if (stopping) {
        started.dispose()
        return
      }
      session = started
      startupError = null
      started.onDispose(() => {
        if (session === started) stop()
      })
      if (recovering) broadcastEvent({ type: 'auth_complete' })
      for (const peer of peers) {
        if (peer.socket.destroyed) continue
        // ACP session/load 전사는 살아 있던 감독의 이벤트 replay와 형식이 다르다.
        // 첫 접속이 브라우저 캐시와 합치지 않고 교체하도록 복원 표식을 내려보낸다.
        sendLine(peer.socket, {
          type: 'replay',
          events: started.snapshot(),
          ...(restored ? { restored: true } : {}),
          ...(restoreFailure ? { restoreFailure } : {}),
        })
        peer.detach = started.attach((event) => sendLine(peer.socket, { type: 'event', event }))
      }
      for (const item of early.splice(0)) void handleHostMessage(started, item.peer, item.message, stop, () => { restoreFailure = null }, switchSession)
    } catch (err) {
      startupError = describeError(err)
      broadcastEvent(runtimeLoginAuthEvent(runtime, startupError))
    } finally {
      sessionStarting = false
      armStartupIdle()
    }
  }

  restartSession = async () => {
    if (!session || sessionStarting || stopping) return
    const previous = session
    session = null
    startupError = '로그인 뒤 에이전트 연결을 다시 확인합니다'
    for (const peer of peers) {
      peer.detach?.()
      peer.detach = null
    }
    // onDispose는 `session === previous`일 때만 감독을 닫으므로 의도적인 재시작은 감독을 살린다.
    await previous.disposeAndWait()
    await startSession()
  }

  switchSession = async (sessionId, peer) => {
    if (!session || sessionStarting || stopping) return
    // Codex app-server는 session/new 뒤에도 이 어댑터가 열었던 thread의 writer를
    // 붙든다. 같은 프로세스에서 그 thread를 다시 load하면 자기 writer와 충돌하므로,
    // 히스토리를 갈아탈 때 프로세스를 내려 writer를 반납한 뒤 새 프로세스에서 load한다.
    session.assertCanLoadSession()
    const previous = session
    const previousSessionId = previous.sessionId
    session = null
    sessionStarting = true
    clearStartupIdle()
    for (const attached of peers) {
      attached.detach?.()
      attached.detach = null
    }
    try {
      await previous.disposeAndWait()
      try {
        let started = await AgentSession.start(runtime, undefined, cwd)
        let loadError: string | null = null
        try {
          await started.loadSession(sessionId)
        } catch (err) {
          console.error(`[mew:agent-host:${runtime}] 세션 ${sessionId} 불러오기 실패:`, err)
          // load는 writer를 얻은 뒤 전사 재생에서 실패할 수도 있다. 복구도 종료를 기다린다.
          await started.disposeAndWait()
          loadError = describeError(err)
          // 선택한 기록이 다른 창에 점유됐거나 손상됐으면, 방금 보던 대화를 새
          // writer로 다시 잡는다. 복구까지 실패해도 탭을 종료하지 않고 빈 세션을 남긴다.
          started = await AgentSession.start(runtime, undefined, cwd)
          try {
            await started.loadSession(previousSessionId)
          } catch (recoveryError) {
            console.error(`[mew:agent-host:${runtime}] 세션 ${previousSessionId} 복구 실패:`, recoveryError)
          }
        }

        if (stopping) {
          started.dispose()
          return
        }
        session = started
        startupError = null
        restoreFailure = null
        started.onDispose(() => {
          if (session === started) stop()
        })
        for (const attached of peers) {
          if (attached.socket.destroyed) continue
          sendLine(attached.socket, { type: 'replay', events: started.snapshot(), restored: true })
          attached.detach = started.attach((event) => sendLine(attached.socket, { type: 'event', event }))
        }
        if (loadError && !peer.socket.destroyed) {
          sendLine(peer.socket, { type: 'event', event: { type: 'error', message: loadError } })
        }
      } catch (err) {
        startupError = describeError(err)
        if (!peer.socket.destroyed) {
          sendLine(peer.socket, { type: 'event', event: { type: 'error', message: startupError } })
        }
      }
    } finally {
      sessionStarting = false
      if (session) {
        for (const item of early.splice(0)) {
          void handleHostMessage(session, item.peer, item.message, stop, () => { restoreFailure = null }, switchSession)
        }
      }
      armStartupIdle()
    }
  }

  try {
    await listenOnSocket(server, files.socket)
  } catch (err) {
    if (describeError(err) === 'AGENT_HOST_ALREADY_RUNNING') return
    throw err
  }
  ownsFiles = true

  // 소켓 소유권을 얻은 프로세스만 파일을 지운다. 경합에서 진 프로세스가 이 훅을 먼저 달면
  // 정상 감독의 소켓까지 지우게 된다.
  process.once('SIGINT', () => stop())
  process.once('SIGTERM', () => stop())
  process.once('SIGHUP', () => stop())
  process.once('exit', cleanupFiles)

  const meta: HostMeta = { pid: process.pid, runtime, tab, cwd, socket: files.socket, startedAt: new Date().toISOString() }
  fs.writeFileSync(files.meta, JSON.stringify(meta), { mode: 0o600 })

  await startSession()
}

async function handleHostMessage(
  session: AgentSession,
  peer: Peer,
  message: HostInbound,
  stop: (code?: number) => void,
  chooseFallback: () => void,
  switchSession: (sessionId: string, peer: Peer) => Promise<void>,
) {
  if (message.type === 'request') {
    try {
      const request = message.request
      const value = request.type === 'list_sessions'
        ? await session.listSessions()
        : request.type === 'queue_command'
          ? queueAgentCommand(session, new AgentCommandStore(createTmuxManager({ cwd: session.cwd })), request.owner, request.input)
          : session.terminalAuthSpec(String(request.methodId ?? ''))
      sendLine(peer.socket, { type: 'response', id: String(message.id), ok: true, value })
    } catch (err) {
      sendLine(peer.socket, { type: 'response', id: String(message.id), ok: false, error: describeError(err) })
    }
    return
  }

  const command = message.command
  if (!command || typeof command !== 'object' || typeof command.type !== 'string') return
  try {
    if (command.type === 'prompt') {
      chooseFallback()
      session.prompt(String(command.text), String(command.promptText), command.images, command.imageRefs, command.settings)
    }
    else if (command.type === 'cancel') session.cancel()
    else if (command.type === 'permission') session.answerPermission(String(command.id), command.optionId ?? null)
    else if (command.type === 'authenticate') void session.authenticate(String(command.methodId), command.secret).catch(() => {})
    else if (command.type === 'retry_auth') {
      const methodId = String(command.methodId ?? '')
      const acpMethodId = isRuntimeLoginMethod(session.runtime, methodId)
        ? runtimeLoginSpec(session.runtime, methodId).acpMethodId
        : undefined
      void session.retryAuthentication(acpMethodId).catch(() => {})
    }
    else if (command.type === 'auth_url_response') session.answerElicitation(String(command.id), command.action)
    else if (command.type === 'set_model') await session.setModel(String(command.modelId))
    else if (command.type === 'set_mode') await session.setMode(String(command.modeId))
    else if (command.type === 'set_thinking') await session.setThinking(String(command.configId), String(command.value))
    else if (command.type === 'unqueue') session.unqueue(Number(command.index))
    else if (command.type === 'move_queued') session.moveQueued(Number(command.from), Number(command.to))
    else if (command.type === 'begin_edit_queued')
      session.beginQueuedEdit(Number(command.index), String(command.expect), peer.id)
    else if (command.type === 'cancel_edit_queued')
      session.cancelQueuedEdit(Number(command.index), String(command.expect), peer.id)
    else if (command.type === 'edit_queued')
      session.editQueued(Number(command.index), String(command.text), String(command.expect), String(command.promptText), peer.id)
    else if (command.type === 'clear_session') {
      chooseFallback()
      session.clearAfterQueue()
    }
    else if (command.type === 'load_session') {
      if (session.runtime === 'codex') await switchSession(String(command.sessionId), peer)
      else await session.loadSession(String(command.sessionId))
      chooseFallback()
    }
    else if (command.type === 'close_session') stop()
  } catch (err) {
    // 인증 실패는 AgentSession의 auth 상태로 이미 방송된다. 나머지만 요청한 화면에 오류로 돌린다.
    if (command.type !== 'authenticate' && command.type !== 'retry_auth') {
      sendLine(peer.socket, { type: 'event', event: { type: 'error', message: describeError(err) } })
    }
  }
}

export type AgentHostCallbacks = {
  onReplay?: (events: AgentEvent[], restored: boolean, restoreFailure: { sessionId: string; message: string } | null) => void
  onEvent?: (event: AgentEvent) => void
  onFatal?: (message: string) => void
  onClose?: () => void
}

export class AgentHostClient {
  readonly runtime: string
  readonly tab: string
  readonly cwd: string
  #socket: Socket
  #callbacks: AgentHostCallbacks
  #nextRequest = 1
  #pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
  #closed = false

  constructor(runtime: string, tab: string, cwd: string, socket: Socket, callbacks: AgentHostCallbacks) {
    this.runtime = runtime
    this.tab = tab
    this.cwd = cwd
    this.#socket = socket
    this.#callbacks = callbacks
    socket.on('close', () => {
      if (this.#closed) return
      this.#closed = true
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('에이전트 감독 연결이 끊겼습니다'))
      }
      this.#pending.clear()
      callbacks.onClose?.()
    })
    socket.on('error', () => {})
  }

  /** openSocket의 단일 line reader가 hello 다음 프레임도 같은 chunk에서 빠뜨리지 않고 넘긴다. */
  receive(raw: unknown) {
    if (!raw || typeof raw !== 'object') return
    const message = raw as HostOutbound
    if (message.type === 'replay') this.#callbacks.onReplay?.(message.events, message.restored === true, message.restoreFailure ?? null)
    else if (message.type === 'event') this.#callbacks.onEvent?.(message.event)
    else if (message.type === 'fatal') this.#callbacks.onFatal?.(message.message)
    else if (message.type === 'response') {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.value)
      else pending.reject(new Error(message.error))
    }
  }

  send(command: AgentHostCommand) {
    if (this.#closed) throw new Error('에이전트 감독 연결이 닫혔습니다')
    this.#socket.write(`${JSON.stringify({ type: 'command', command } satisfies HostInbound)}\n`)
  }

  request<T>(request: AgentHostRequest): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('에이전트 감독 연결이 닫혔습니다'))
    const id = String(this.#nextRequest++)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error('에이전트 감독 응답 시간 초과'))
      }, REQUEST_TIMEOUT_MS)
      timer.unref?.()
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.#socket.write(`${JSON.stringify({ type: 'request', id, request } satisfies HostInbound)}\n`)
    })
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#socket.end()
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('에이전트 감독 연결을 닫았습니다'))
    }
    this.#pending.clear()
  }
}

function openSocket(
  socketPath: string,
  runtime: string,
  tab: string,
  cwd: string,
  callbacks: AgentHostCallbacks,
): Promise<AgentHostClient> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let settled = false
    let client: AgentHostClient | null = null
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error('에이전트 감독 연결 시간 초과'))
    }, CONNECT_TIMEOUT_MS)
    timer.unref?.()

    installLineReader(socket, (raw) => {
      if (client) {
        client.receive(raw)
        return
      }
      if (settled || !raw || typeof raw !== 'object') return
      const hello = raw as Partial<Extract<HostOutbound, { type: 'hello' }>>
      if (hello.type !== 'hello') return
      if (hello.runtime !== runtime || hello.tab !== tab || hello.cwd !== cwd) {
        settled = true
        clearTimeout(timer)
        socket.destroy()
        reject(new Error('다른 워크스페이스의 에이전트 감독 소켓입니다'))
        return
      }
      settled = true
      clearTimeout(timer)
      client = new AgentHostClient(runtime, tab, cwd, socket, callbacks)
      resolve(client)
    }, () => socket.destroy())
    socket.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    socket.once('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('에이전트 감독이 인사 전에 연결을 닫았습니다'))
    })
  })
}

const spawning = new Map<string, Promise<void>>()

/** Reattach for task recovery without starting a new agent or replaying a prompt. */
export function connectExistingAgentHost(runtime: string, tab: string, cwd: string, callbacks: AgentHostCallbacks = {}): Promise<AgentHostClient> {
  if (!isAcpRuntime(runtime) || !TAB_ID.test(tab) || !path.isAbsolute(cwd)) return Promise.reject(new Error('올바르지 않은 에이전트 탭입니다'))
  return openSocket(pathsFor(runtime, tab, cwd).socket, runtime, tab, cwd, callbacks)
}

function spawnHost(
  runtime: string,
  tab: string,
  cwd: string,
  files: ReturnType<typeof pathsFor>,
  resumeSessionId: string | null,
  context?: AgentContextBinding,
): Promise<void> {
  const existing = spawning.get(files.socket)
  if (existing) return existing
  const started = new Promise<void>((resolve, reject) => {
    fs.mkdirSync(HOST_DIR, { recursive: true, mode: 0o700 })
    fs.chmodSync(HOST_DIR, 0o700)
    const logFd = fs.openSync(files.log, 'a', 0o600)
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, MEW_WORKSPACE: cwd, MEW_AGENT_CONTEXT: JSON.stringify(context ?? captureAgentContext(cwd)) }
      if (resumeSessionId) env.MEW_AGENT_RESUME_SESSION = resumeSessionId
      else delete env.MEW_AGENT_RESUME_SESSION
      const child = spawn(process.execPath, [HOST_FILE, '--host', runtime, tab, cwd], {
        cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env,
      })
      child.once('spawn', resolve)
      child.once('error', reject)
      child.unref()
    } finally {
      fs.closeSync(logFd)
    }
  }).finally(() => spawning.delete(files.socket))
  spawning.set(files.socket, started)
  return started
}

/** 같은 탭 감독에 붙는다. 없으면 mew와 다른 프로세스 그룹으로 새로 띄운다. */
export async function connectAgentHost(
  runtime: string,
  tab: string,
  cwd: string,
  callbacks: AgentHostCallbacks = {},
  resumeSessionId: string | null = null,
  context?: AgentContextBinding,
): Promise<AgentHostClient> {
  if (!isAcpRuntime(runtime) || !TAB_ID.test(tab) || !path.isAbsolute(cwd)
    || (resumeSessionId !== null && !SESSION_ID.test(resumeSessionId))) {
    throw new Error('올바르지 않은 에이전트 탭입니다')
  }
  const files = pathsFor(runtime, tab, cwd)
  try {
    return await openSocket(files.socket, runtime, tab, cwd, callbacks)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ECONNREFUSED') throw err
  }

  await spawnHost(runtime, tab, cwd, files, resumeSessionId, context)
  const deadline = Date.now() + CONNECT_TIMEOUT_MS
  let lastError: unknown = new Error('에이전트 감독이 시작되지 않았습니다')
  while (Date.now() < deadline) {
    try {
      return await openSocket(files.socket, runtime, tab, cwd, callbacks)
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError
}

/** terminal auth API가 탭 감독에서 ACP 광고 또는 런타임 등록표의 고정 실행 spec만 읽는다. */
export async function terminalAuthFromHost(runtime: string, tab: string, cwd: string, methodId: string) {
  const client = await connectAgentHost(runtime, tab, cwd)
  try {
    return await client.request<TerminalAuthSpec>({ type: 'terminal_auth', methodId })
  } finally {
    client.close()
  }
}

/** The same host that serializes AI turns accepts CLI jobs into that queue. */
export async function queueCommandInHost(owner: string, input: AgentCommandInput): Promise<AgentCommandRecord> {
  const client = await connectAgentHost(input.runtime, input.tab, input.cwd, {}, input.sessionId)
  try {
    return await client.request<AgentCommandRecord>({ type: 'queue_command', owner, input })
  } finally { client.close() }
}

/** 워크스페이스 교체는 cwd가 고정된 기존 감독을 명시적으로 접는다. mew 종료에는 호출하지 않는다. */
export function shutdownAgentHostsForWorkspace(cwd: string) {
  let names: string[]
  try {
    names = fs.readdirSync(HOST_DIR).filter((name) => name.endsWith('.json'))
  } catch {
    return
  }
  for (const name of names) {
    let meta: HostMeta
    try {
      meta = JSON.parse(fs.readFileSync(path.join(HOST_DIR, name), 'utf8')) as HostMeta
    } catch {
      continue
    }
    if (meta.cwd !== cwd || !Number.isInteger(meta.pid) || meta.pid <= 1) continue
    try {
      // 크래시 뒤 남은 메타의 pid가 다른 프로세스에 재사용됐을 수 있다. 명령행이 실제 감독인지
      // 확인하지 못하면 죽이지 않는다.
      const args = execFileSync('ps', ['-p', String(meta.pid), '-o', 'args='], { encoding: 'utf8' })
      if (!args.includes(HOST_FILE) || !args.includes(' --host ')) continue
      process.kill(meta.pid, 'SIGTERM')
    } catch {
      // 이미 끝난 감독의 메타는 다음 시작이 소켓과 함께 정리한다.
    }
  }
}

/**
 * 워크스페이스 전환의 응답 경로는 기존 감독 수만큼 `ps`를 동기로 기다리지 않는다.
 * pid 재사용 방지는 그대로 유지하되 확인과 SIGTERM을 다음 이벤트 루프로 넘긴다. 호출자는
 * cwd 문자열을 미리 넘기므로 전환 뒤 라이브 WORKSPACE_ROOT가 바뀌어도 옛 감독만 정리한다.
 */
export function shutdownAgentHostsForWorkspaceSoon(cwd: string) {
  fs.promises.readdir(HOST_DIR)
    .then((names) => Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
      let meta: HostMeta
      try {
        meta = JSON.parse(await fs.promises.readFile(path.join(HOST_DIR, name), 'utf8')) as HostMeta
      } catch {
        return
      }
      if (meta.cwd !== cwd || !Number.isInteger(meta.pid) || meta.pid <= 1) return
      execFile('ps', ['-p', String(meta.pid), '-o', 'args='], { encoding: 'utf8' }, (err, stdout) => {
        if (err || !stdout.includes(HOST_FILE) || !stdout.includes(' --host ')) return
        try { process.kill(meta.pid, 'SIGTERM') } catch { /* already gone */ }
      })
    })))
    .catch(() => {})
}

if (process.argv[1] && path.resolve(process.argv[1]) === HOST_FILE && process.argv[2] === '--host') {
  const [, , , runtime = '', tab = '', cwd = ''] = process.argv
  const resumeSessionId = process.env.MEW_AGENT_RESUME_SESSION || null
  void runHost(runtime, tab, cwd, resumeSessionId).catch((err) => {
    console.error('[mew:agent-host]', err)
    process.exit(1)
  })
}
