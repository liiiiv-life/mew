// 에이전트 탭의 독립 감독 프로세스와 mew 쪽 유닉스 소켓 클라이언트.
//
// 브라우저 WS와 ACP 프로세스의 수명을 끊는 경계다. 탭마다 이 파일을 별도 Node 프로세스로 띄우고,
// mew 서버는 로컬 소켓으로만 명령·이벤트를 중계한다. 따라서 브라우저가 닫히거나 mew가 재시작돼도
// 감독과 그 아래 ACP/CLI는 그대로 작업을 마친다(ADR 0048).
import './config.ts'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net, { type Socket } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentSession, isRuntime, type AgentEvent, type TerminalAuthSpec } from './agentAcp.ts'
import { DATA_DIR } from './dataDir.ts'

const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/
const HOST_DIR = path.join(DATA_DIR, 'agent')
const HOST_FILE = fileURLToPath(import.meta.url)
const CONNECT_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 30_000
const MAX_LINE_BYTES = 64 * 1024 * 1024

export type AgentHostCommand =
  | { type: 'prompt'; text: string; promptText: string }
  | { type: 'cancel' }
  | { type: 'permission'; id: string; optionId: string | null }
  | { type: 'authenticate'; methodId: string; secret?: string }
  | { type: 'retry_auth' }
  | { type: 'auth_url_response'; id: string; action: 'accept' | 'decline' | 'cancel' }
  | { type: 'set_model'; modelId: string }
  | { type: 'set_mode'; modeId: string }
  | { type: 'unqueue'; index: number }
  | { type: 'move_queued'; from: number; to: number }
  | { type: 'edit_queued'; index: number; text: string; expect: string; promptText: string }
  | { type: 'load_session'; sessionId: string }
  | { type: 'close_session' }

type AgentHostRequest =
  | { type: 'list_sessions' }
  | { type: 'terminal_auth'; methodId: string }

type HostInbound =
  | { type: 'command'; command: AgentHostCommand }
  | { type: 'request'; id: string; request: AgentHostRequest }

type HostOutbound =
  | { type: 'hello'; runtime: string; tab: string; cwd: string }
  | { type: 'replay'; events: AgentEvent[] }
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
  socket: Socket
  detach: (() => void) | null
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
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

async function runHost(runtime: string, tab: string, cwd: string) {
  if (!isRuntime(runtime) || !TAB_ID.test(tab) || !path.isAbsolute(cwd)) {
    throw new Error('올바르지 않은 에이전트 감독 인자입니다')
  }
  const files = pathsFor(runtime, tab, cwd)
  const peers = new Set<Peer>()
  const early: Array<{ peer: Peer; message: HostInbound }> = []
  let session: AgentSession | null = null
  let stopping = false
  let ownsFiles = false

  const server = net.createServer((socket) => {
    const peer: Peer = { socket, detach: null }
    peers.add(peer)
    sendLine(socket, { type: 'hello', runtime, tab, cwd })

    const attach = () => {
      if (!session || socket.destroyed) return
      // snapshot과 attach 사이에는 await가 없어야 그 틈의 스트리밍 이벤트가 빠지지 않는다.
      sendLine(socket, { type: 'replay', events: session.snapshot() })
      peer.detach = session.attach((event) => sendLine(socket, { type: 'event', event }))
    }
    if (session) attach()

    const receive = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const message = raw as HostInbound
      if (message.type !== 'command' && message.type !== 'request') return
      if (!session) {
        // 프론트와 mew가 이 직후 모두 사라져도 이미 받은 프롬프트는 감독이 끝까지 실행한다.
        early.push({ peer, message })
        return
      }
      void handleHostMessage(session, peer, message, stop)
    }
    installLineReader(socket, receive, () => socket.destroy())
    socket.on('close', () => {
      peer.detach?.()
      peer.detach = null
      peers.delete(peer)
    })
    socket.on('error', () => {})
  })

  const cleanupFiles = () => {
    if (!ownsFiles) return
    ownsFiles = false
    fs.rmSync(files.socket, { force: true })
    fs.rmSync(files.meta, { force: true })
  }
  const stop = (code = 0) => {
    if (stopping) return
    stopping = true
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

  try {
    session = await AgentSession.start(runtime, undefined, cwd)
  } catch (err) {
    for (const peer of peers) sendLine(peer.socket, { type: 'fatal', message: describeError(err) })
    stop(1)
    return
  }
  session.onDispose(() => stop())
  for (const peer of peers) {
    if (peer.socket.destroyed) continue
    sendLine(peer.socket, { type: 'replay', events: session.snapshot() })
    peer.detach = session.attach((event) => sendLine(peer.socket, { type: 'event', event }))
  }
  for (const item of early.splice(0)) void handleHostMessage(session, item.peer, item.message, stop)
}

async function handleHostMessage(
  session: AgentSession,
  peer: Peer,
  message: HostInbound,
  stop: (code?: number) => void,
) {
  if (message.type === 'request') {
    try {
      const value = message.request.type === 'list_sessions'
        ? await session.listSessions()
        : session.terminalAuthSpec(String(message.request.methodId ?? ''))
      sendLine(peer.socket, { type: 'response', id: String(message.id), ok: true, value })
    } catch (err) {
      sendLine(peer.socket, { type: 'response', id: String(message.id), ok: false, error: describeError(err) })
    }
    return
  }

  const command = message.command
  if (!command || typeof command !== 'object' || typeof command.type !== 'string') return
  try {
    if (command.type === 'prompt') session.prompt(String(command.text), String(command.promptText))
    else if (command.type === 'cancel') session.cancel()
    else if (command.type === 'permission') session.answerPermission(String(command.id), command.optionId ?? null)
    else if (command.type === 'authenticate') void session.authenticate(String(command.methodId), command.secret).catch(() => {})
    else if (command.type === 'retry_auth') void session.retryAuthentication().catch(() => {})
    else if (command.type === 'auth_url_response') session.answerElicitation(String(command.id), command.action)
    else if (command.type === 'set_model') await session.setModel(String(command.modelId))
    else if (command.type === 'set_mode') await session.setMode(String(command.modeId))
    else if (command.type === 'unqueue') session.unqueue(Number(command.index))
    else if (command.type === 'move_queued') session.moveQueued(Number(command.from), Number(command.to))
    else if (command.type === 'edit_queued')
      session.editQueued(Number(command.index), String(command.text), String(command.expect), String(command.promptText))
    else if (command.type === 'load_session') await session.loadSession(String(command.sessionId))
    else if (command.type === 'close_session') stop()
  } catch (err) {
    // 인증 실패는 AgentSession의 auth 상태로 이미 방송된다. 나머지만 요청한 화면에 오류로 돌린다.
    if (command.type !== 'authenticate' && command.type !== 'retry_auth') {
      sendLine(peer.socket, { type: 'event', event: { type: 'error', message: describeError(err) } })
    }
  }
}

export type AgentHostCallbacks = {
  onReplay?: (events: AgentEvent[]) => void
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
    if (message.type === 'replay') this.#callbacks.onReplay?.(message.events)
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

function spawnHost(runtime: string, tab: string, cwd: string, files: ReturnType<typeof pathsFor>): Promise<void> {
  const existing = spawning.get(files.socket)
  if (existing) return existing
  const started = new Promise<void>((resolve, reject) => {
    fs.mkdirSync(HOST_DIR, { recursive: true, mode: 0o700 })
    fs.chmodSync(HOST_DIR, 0o700)
    const logFd = fs.openSync(files.log, 'a', 0o600)
    try {
      const child = spawn(process.execPath, [HOST_FILE, '--host', runtime, tab, cwd], {
        cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, MEW_WORKSPACE: cwd },
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
): Promise<AgentHostClient> {
  if (!isRuntime(runtime) || !TAB_ID.test(tab) || !path.isAbsolute(cwd)) throw new Error('올바르지 않은 에이전트 탭입니다')
  const files = pathsFor(runtime, tab, cwd)
  try {
    return await openSocket(files.socket, runtime, tab, cwd, callbacks)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ECONNREFUSED') throw err
  }

  await spawnHost(runtime, tab, cwd, files)
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

/** terminal auth API가 살아 있는 탭 감독에서 고정 실행 spec만 읽는다. */
export async function terminalAuthFromHost(runtime: string, tab: string, cwd: string, methodId: string) {
  const client = await connectAgentHost(runtime, tab, cwd)
  try {
    return await client.request<TerminalAuthSpec>({ type: 'terminal_auth', methodId })
  } finally {
    client.close()
  }
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

if (process.argv[1] && path.resolve(process.argv[1]) === HOST_FILE && process.argv[2] === '--host') {
  const [, , , runtime = '', tab = '', cwd = ''] = process.argv
  void runHost(runtime, tab, cwd).catch((err) => {
    console.error('[mew:agent-host]', err)
    process.exit(1)
  })
}
