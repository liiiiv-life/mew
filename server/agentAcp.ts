// ACP(Agent Client Protocol) 클라이언트 — 에이전트를 child process로 띄우고 **워크스페이스**에 묶는다.
// 벤더 전환은 spawn 대상 교체다(런타임 등록표 RUNTIMES). 자체 어댑터 인터페이스는 두지 않는다 — ACP가 인터페이스다.
// 결정 기준본: docs/decisions/0034-mew-agent-panel-acp-reintroduction.md,
// 워크스페이스 스코프·런타임 전환은 docs/decisions/0043-mew-agent-workspace-scope-and-runtimes.md
//
// 스코프는 프로젝트가 아니라 워크스페이스다 — 어느 프로젝트를 보고 있든 같은 세션이 뜬다. 레포를 오가며
// 시키는 일(문서는 docs에, 코드는 제품 레포에)이 창을 바꾸지 않고 한 대화에서 되게 하려는 것.
//
// 보안 경계 두 겹:
//  1. 이 모듈을 붙이는 WS가 owner/manager만 통과시킨다(server/agentWs.ts)
//  2. 파일 도구는 fs capability로 **mew 프로세스 안에서** 실행돼 워크스페이스 밖을 거부한다.
//     Bash는 경로 스코프가 되지 않는다 — 승인 프롬프트가 유일한 통제이고, 실질 격리는 OS 층(2단계)이다.
import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type Client,
  type PermissionOption,
  type ReadTextFileRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionInfo,
  type SessionModelState,
  type SessionModeState,
  type SessionNotification,
  type ToolCallUpdate,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk'
import { UnsafePathError, WORKSPACE_ROOT } from './paths.ts'
import { UsageReader, type Usage } from './agentUsage.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 기본 백엔드 — 버전 고정된 로컬 설치본. `npx @latest`로 띄우지 않는다(ADR 0034) */
const DEFAULT_AGENT_CMD = path.resolve(here, '../node_modules/.bin/claude-code-acp')

/**
 * 새 세션이 시작할 권한 모드. 기본이 `bypassPermissions`다 — 에이전트 창은 터미널과 같은 게이트를
 * 쓰는 owner/manager 전용 도구이고, 승인 프롬프트는 그 사람이 이미 가진 권한을 다시 묻는 것뿐이다
 * (ADR 0037). 되돌리려면 `MEW_AGENT_MODE=default`.
 */
const DEFAULT_MODE = process.env.MEW_AGENT_MODE || 'bypassPermissions'

/** 재접속(모바일 화면 꺼짐 등) 때 되돌려 줄 이벤트 개수 상한 */
const MAX_BUFFERED_EVENTS = 500

/** 붙어 있는 창이 하나도 없는 채로 이만큼 지나면 에이전트를 죽인다 */
const IDLE_KILL_MS = 10 * 60_000

/** 창 상단 정보줄이 그리는 값 — 이벤트 버퍼에 쌓지 않고 바뀔 때마다 현재 값을 통째로 보낸다 */
export type SessionMeta = {
  sessionId: string
  /** 세션이 시작된 시각(ISO). 히스토리를 불러오면 그 세션의 첫 기록 시각이다 */
  startedAt: string
  turns: number
  busy: boolean
  /** 진행 중인 턴이 끝나면 순서대로 실행될 대기 메시지 */
  queued: string[]
  usage: Usage | null
  canLoad: boolean
  canList: boolean
}

export type AgentEvent =
  | { type: 'update'; update: SessionNotification['update'] }
  | { type: 'permission'; id: string; toolCall: ToolCallUpdate; options: PermissionOption[] }
  | { type: 'permission_done'; id: string }
  | { type: 'turn_start' }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'error'; message: string }
  | { type: 'models'; models: SessionModelState }
  | { type: 'modes'; modes: SessionModeState }
  | { type: 'meta'; meta: SessionMeta }
  /** 대화가 갈아끼워졌다(새 세션·히스토리 불러오기) — 창은 지금까지 그린 것을 버린다 */
  | { type: 'reset' }

export interface SpawnSpec {
  cmd: string
  args: string[]
  env?: Record<string, string | undefined>
}

/** PATH에서 실행 파일을 찾는다. 없으면 null */
function findExecutable(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      /* 다음 디렉터리 */
    }
  }
  return null
}

function claudeSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_CMD || DEFAULT_AGENT_CMD
  const args = process.env.MEW_AGENT_ARGS ? process.env.MEW_AGENT_ARGS.split(' ').filter(Boolean) : []
  const env: Record<string, string | undefined> = {}
  // CLAUDE_CONFIG_DIR을 넘기면 에이전트가 mew 서버 사용자의 자격증명을 보지 않는다(2단계 준비).
  if (process.env.MEW_AGENT_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = process.env.MEW_AGENT_CONFIG_DIR
  // 어댑터가 번들한 CLI는 어댑터 버전 핀에 묶여 모델 목록이 낡는다(새 모델이 안 보인다).
  // 시스템에 설치된 claude가 있으면 그걸 쓰게 해 모델 목록이 사용자의 설치본을 따라가게 한다.
  if (!process.env.CLAUDE_CODE_EXECUTABLE) {
    const systemClaude = findExecutable('claude')
    if (systemClaude) env.CLAUDE_CODE_EXECUTABLE = systemClaude
  }
  return { cmd, args, env }
}

/** Hermes는 mew가 번들하지 않는다 — 사용자가 자기 기계에 깔아 둔 ACP 진입점을 가리키게만 한다.
 *  실행 파일이 없거나 ACP를 말하지 않으면 창에 "에이전트를 실행하지 못했습니다"로 그대로 드러난다. */
function hermesSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_HERMES_CMD || 'hermes'
  const raw = process.env.MEW_AGENT_HERMES_ARGS
  return { cmd, args: raw === undefined ? ['acp'] : raw.split(' ').filter(Boolean) }
}

/** 창에서 고를 수 있는 에이전트 런타임. 여기 없는 id는 서버가 거부한다 */
export const RUNTIMES: Record<string, { label: string; spec: () => SpawnSpec }> = {
  claude: { label: 'Claude Code', spec: claudeSpawnSpec },
  hermes: { label: 'Hermes', spec: hermesSpawnSpec },
}

export const DEFAULT_RUNTIME = 'claude'

export function isRuntime(id: string): boolean {
  return Object.hasOwn(RUNTIMES, id)
}

export class AgentSession {
  /** 어떤 백엔드로 떠 있는지(RUNTIMES의 키) — 창의 아이콘이 이것을 그린다 */
  readonly runtime: string
  readonly cwd: string
  #child: ChildProcess
  #conn: ClientSideConnection
  #sessionId = ''
  #events: AgentEvent[] = []
  #listeners = new Set<(event: AgentEvent) => void>()
  #pending = new Map<string, (response: RequestPermissionResponse) => void>()
  #idleTimer: NodeJS.Timeout | null = null
  #nextPermissionId = 1
  #disposed = false
  #models: SessionModelState | null = null
  #modes: SessionModeState | null = null
  #caps: AgentCapabilities = {}
  #startedAt = new Date().toISOString()
  #turns = 0
  #queue: string[] = []
  #reader: UsageReader | null = null
  #usage: Usage | null = null
  busy = false

  private constructor(runtime: string, spec: SpawnSpec) {
    this.runtime = runtime
    this.cwd = WORKSPACE_ROOT
    const env = { ...process.env, ...spec.env }
    // CLAUDECODE가 켜져 있으면 Claude Code가 "중첩 세션"으로 보고 실행을 거부한다. mew 서버를 Claude Code
    // 터미널에서 띄우면 이 변수가 그대로 상속돼 에이전트 창이 통째로 죽는다 — 여기 세션은 중첩이 아니라
    // 별개 프로세스이므로 떼고 넘긴다.
    delete env.CLAUDECODE
    this.#child = spawn(spec.cmd, spec.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    this.#child.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[mew:agent:${runtime}]`, chunk.toString().trimEnd())
    })
    this.#child.on('error', (err) => this.#fail(`에이전트를 실행하지 못했습니다: ${err.message}`))
    this.#child.on('exit', (code, signal) => {
      if (!this.#disposed) this.#fail(`에이전트가 종료됐습니다 (code=${code} signal=${signal})`)
    })
    const stream = ndJsonStream(
      Writable.toWeb(this.#child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(this.#child.stdout!) as ReadableStream<Uint8Array>,
    )
    this.#conn = new ClientSideConnection(() => this.#client(), stream)
    this.#armIdleTimer()
  }

  static async start(runtime: string, spec: SpawnSpec = RUNTIMES[runtime].spec()): Promise<AgentSession> {
    const session = new AgentSession(runtime, spec)
    try {
      await session.#handshake()
    } catch (err) {
      session.dispose()
      throw err
    }
    return session
  }

  async #handshake() {
    // terminal capability는 광고하지 않는다 — 셸은 승인 프롬프트를 거쳐 에이전트 쪽에서 돈다.
    // fs는 광고한다: 이걸 켜야 Read/Write가 mew로 되돌아와 프로젝트 밖을 막을 수 있다.
    const init = await this.#conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    })
    this.#caps = init.agentCapabilities ?? {}
    const created = await this.#conn.newSession({ cwd: this.cwd, mcpServers: [] })
    this.#adopt(created.sessionId, created.models ?? null, created.modes ?? null)
    await this.#applyDefaultMode()
  }

  /** 새로 만들었거나 불러온 ACP 세션으로 갈아탄다 — 사용량 리더도 그 세션 파일을 보게 바꾼다 */
  #adopt(sessionId: string, models: SessionModelState | null, modes: SessionModeState | null) {
    this.#sessionId = sessionId
    this.#reader = new UsageReader(this.cwd, sessionId)
    this.#usage = null
    if (models) {
      this.#models = models
      this.#emit({ type: 'models', models })
    }
    if (modes) {
      this.#modes = modes
      this.#emit({ type: 'modes', modes })
    }
  }

  /**
   * 세션은 언제나 `default`로 시작한다(claude-code-acp). 원하는 모드는 세션을 새로 잡을 때마다
   * 다시 걸어 줘야 한다 — 백엔드가 그 모드를 광고하지 않으면(예: root로 돌면 bypass가 빠진다) 넘어간다.
   */
  async #applyDefaultMode() {
    const modes = this.#modes
    if (!modes || modes.currentModeId === DEFAULT_MODE) return
    if (!modes.availableModes.some((mode) => mode.id === DEFAULT_MODE)) return
    await this.setMode(DEFAULT_MODE)
  }

  #client(): Client {
    return {
      sessionUpdate: async (params: SessionNotification) => {
        // 에이전트가 스스로 모드를 바꾸기도 한다(계획 모드 종료 등) — 창의 선택기가 따라가야 한다
        if (params.update.sessionUpdate === 'current_mode_update' && this.#modes) {
          this.#modes = { ...this.#modes, currentModeId: params.update.currentModeId }
          this.#emit({ type: 'modes', modes: this.#modes })
        }
        this.#emit({ type: 'update', update: params.update })
      },
      requestPermission: (params: RequestPermissionRequest) => {
        const id = String(this.#nextPermissionId++)
        return new Promise<RequestPermissionResponse>((resolve) => {
          this.#pending.set(id, resolve)
          this.#emit({ type: 'permission', id, toolCall: params.toolCall, options: params.options })
        })
      },
      readTextFile: async (params: ReadTextFileRequest) => {
        const content = await fsp.readFile(this.#scoped(params.path), 'utf8')
        if (params.line == null && params.limit == null) return { content }
        const lines = content.split('\n')
        const from = Math.max(0, (params.line ?? 1) - 1)
        const to = params.limit == null ? undefined : from + params.limit
        return { content: lines.slice(from, to).join('\n') }
      },
      writeTextFile: async (params: WriteTextFileRequest) => {
        const target = this.#scoped(params.path)
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.writeFile(target, params.content, 'utf8')
        // appWrites 원장에 기록하지 않는다 — 에이전트의 쓰기는 열린 방에 주입돼야 하는 "외부 변경"이다
        return {}
      },
    }
  }

  /** 에이전트가 준 절대 경로를 워크스페이스 안으로 가둔다 — 밖이면 던진다.
   *  차단 경로(.git·node_modules·.data)는 여기서 막지 않는다: 에이전트는 워크스페이스 전체를 다루는
   *  owner/manager 전용 도구이고, 어차피 Bash로 같은 것을 할 수 있다(ADR 0043). */
  #scoped(absolutePath: string): string {
    const resolved = path.resolve(this.cwd, absolutePath)
    if (resolved !== this.cwd && !resolved.startsWith(this.cwd + path.sep)) {
      throw new UnsafePathError(`워크스페이스 밖입니다: ${absolutePath}`)
    }
    return resolved
  }

  attach(listener: (event: AgentEvent) => void): () => void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    for (const event of this.#events) listener(event)
    listener(this.#metaEvent())
    this.#listeners.add(listener)
    void this.#pushMeta()
    return () => {
      this.#listeners.delete(listener)
      this.#armIdleTimer()
    }
  }

  /** 진행 중인 턴이 있으면 줄을 세운다 — 끝나는 대로 순서대로 이어 돈다 */
  prompt(text: string) {
    if (this.busy) {
      this.#queue.push(text)
      this.#broadcast(this.#metaEvent())
      return
    }
    this.#run(text)
  }

  /** 대기 중인 메시지를 취소한다(진행 중인 턴은 건드리지 않는다) */
  unqueue(index: number) {
    if (index < 0 || index >= this.#queue.length) return
    this.#queue.splice(index, 1)
    this.#broadcast(this.#metaEvent())
  }

  #run(text: string) {
    this.busy = true
    this.#turns += 1
    // 사용자 발화도 이벤트 버퍼에 남긴다 — 재접속한 창이 대화를 그대로 복원하려면 여기 있어야 한다
    this.#emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } } })
    this.#emit({ type: 'turn_start' })
    this.#broadcast(this.#metaEvent())
    this.#conn
      .prompt({ sessionId: this.#sessionId, prompt: [{ type: 'text', text }] })
      .then((res) => this.#emit({ type: 'turn_end', stopReason: res.stopReason }))
      .catch((err: unknown) => {
        // ACP 오류는 JSON-RPC 오류 객체(plain object)로도 온다 — String()하면 "[object Object]"만 남는다
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null
              ? String((err as { message?: unknown }).message ?? JSON.stringify(err))
              : String(err)
        this.#emit({ type: 'error', message })
        this.#emit({ type: 'turn_end', stopReason: 'error' })
      })
      .finally(() => {
        this.busy = false
        const next = this.#queue.shift()
        if (next === undefined) void this.#pushMeta()
        else this.#run(next)
      })
  }

  /** 대화를 비우고 새 세션을 연다 — Claude Code CLI의 `/clear` */
  async newSession() {
    this.#resetConversation()
    const created = await this.#conn.newSession({ cwd: this.cwd, mcpServers: [] })
    this.#adopt(created.sessionId, created.models ?? null, created.modes ?? null)
    await this.#applyDefaultMode()
    await this.#pushMeta()
  }

  /** 지난 세션을 불러온다 — 에이전트가 히스토리를 session/update로 다시 흘려준다(`/resume`) */
  async loadSession(sessionId: string) {
    this.#resetConversation()
    this.#adopt(sessionId, null, null)
    await this.#pushMeta() // 세션 전환을 즉시 클라이언트에 반영 — ACP 히스토리 재생 전
    const loaded = await this.#conn.loadSession({ sessionId, cwd: this.cwd, mcpServers: [] })
    if (loaded.models) {
      this.#models = loaded.models
      this.#emit({ type: 'models', models: loaded.models })
    }
    if (loaded.modes) {
      this.#modes = loaded.modes
      this.#emit({ type: 'modes', modes: loaded.modes })
    }
    await this.#applyDefaultMode()
    await this.#pushMeta()
  }

  /** 이 프로젝트 폴더에서 돌았던 세션 목록 */
  async listSessions(): Promise<SessionInfo[]> {
    const res = await this.#conn.unstable_listSessions({ cwd: this.cwd })
    return res.sessions
  }

  #resetConversation() {
    this.cancel()
    this.#events = []
    this.#queue = []
    this.#turns = 0
    this.#startedAt = new Date().toISOString()
    this.#broadcast({ type: 'reset' })
  }

  get models(): SessionModelState | null {
    return this.#models
  }

  get modes(): SessionModeState | null {
    return this.#modes
  }

  /** 권한 모드 전환 — `bypassPermissions`면 승인 프롬프트 없이 돈다(ADR 0037) */
  async setMode(modeId: string) {
    await this.#conn.setSessionMode({ sessionId: this.#sessionId, modeId })
    if (this.#modes) {
      this.#modes = { ...this.#modes, currentModeId: modeId }
      this.#emit({ type: 'modes', modes: this.#modes })
    }
  }

  async setModel(modelId: string) {
    await this.#conn.unstable_setSessionModel({ sessionId: this.#sessionId, modelId })
    if (this.#models) {
      this.#models = { ...this.#models, currentModelId: modelId }
      this.#emit({ type: 'models', models: this.#models })
    }
  }

  /** 승인 대기 중인 요청은 취소 결과로 닫는다 — 스펙 요구사항(cancel 시 outcome: cancelled) */
  cancel() {
    for (const [id, resolve] of this.#pending) {
      resolve({ outcome: { outcome: 'cancelled' } })
      this.#emit({ type: 'permission_done', id })
    }
    this.#pending.clear()
    // 줄 서 있던 메시지도 같이 버린다 — 중단해 놓고 다음 것이 저절로 도는 건 놀라운 동작이다
    this.#queue = []
    void this.#conn.cancel({ sessionId: this.#sessionId }).catch(() => {})
  }

  answerPermission(id: string, optionId: string | null) {
    const resolve = this.#pending.get(id)
    if (!resolve) return
    this.#pending.delete(id)
    resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
    this.#emit({ type: 'permission_done', id })
  }

  #emit(event: AgentEvent) {
    this.#events.push(event)
    if (this.#events.length > MAX_BUFFERED_EVENTS) this.#events.splice(0, this.#events.length - MAX_BUFFERED_EVENTS)
    this.#broadcast(event)
  }

  /** 버퍼에 남기지 않고 지금 붙어 있는 창에만 보낸다 — 상태 스냅샷은 쌓을 이유가 없다 */
  #broadcast(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event)
  }

  #metaEvent(): AgentEvent {
    return {
      type: 'meta',
      meta: {
        sessionId: this.#sessionId,
        startedAt: this.#usage?.startedAt ?? this.#startedAt,
        // 불러온 세션은 지난 턴까지 세야 한다 — 그 수는 세션 기록에만 있다
        turns: this.#usage?.turns ?? this.#turns,
        busy: this.busy,
        queued: [...this.#queue],
        usage: this.#usage,
        canLoad: this.#caps.loadSession === true,
        canList: this.#caps.sessionCapabilities?.list != null,
      },
    }
  }

  async #pushMeta() {
    if (this.#disposed) return
    this.#usage = (await this.#reader?.read()) ?? null
    this.#broadcast(this.#metaEvent())
  }

  #fail(message: string) {
    this.#emit({ type: 'error', message })
    this.dispose()
  }

  #armIdleTimer() {
    if (this.#listeners.size > 0 || this.#idleTimer || this.#disposed) return
    this.#idleTimer = setTimeout(() => {
      sessions.delete(this.runtime)
      this.dispose()
    }, IDLE_KILL_MS)
    this.#idleTimer.unref?.()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    for (const resolve of this.#pending.values()) resolve({ outcome: { outcome: 'cancelled' } })
    this.#pending.clear()
    this.#listeners.clear()
    this.#child.kill()
  }
}

// 워크스페이스에 런타임당 하나 — 프로젝트별로 나누지 않는다. 런타임을 바꿔 갔다 돌아오면 그쪽 대화가 그대로 남아 있다.
const sessions = new Map<string, Promise<AgentSession>>()

/** 창을 닫았다 다시 열어도 같은 대화가 이어진다(IDLE_KILL_MS까지) */
export function sessionFor(runtime: string): Promise<AgentSession> {
  const existing = sessions.get(runtime)
  if (existing) return existing
  const started = AgentSession.start(runtime).catch((err: unknown) => {
    sessions.delete(runtime)
    throw err
  })
  sessions.set(runtime, started)
  return started
}

export function disposeSession(runtime: string) {
  const pending = sessions.get(runtime)
  if (!pending) return
  sessions.delete(runtime)
  void pending.then((session) => session.dispose()).catch(() => {})
}

/** 워크스페이스가 바뀌면 전부 접는다 — 세션의 cwd는 뜰 때 정해지므로 옛 폴더에 매여 있다 */
export function disposeAllSessions() {
  for (const runtime of [...sessions.keys()]) disposeSession(runtime)
}
