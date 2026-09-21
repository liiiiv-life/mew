// ACP(Agent Client Protocol) 클라이언트 — 에이전트를 child process로 띄우고 **워크스페이스**에 묶는다.
// 벤더 전환은 spawn 대상 교체다(런타임 등록표 RUNTIMES). 자체 어댑터 인터페이스는 두지 않는다 — ACP가 인터페이스다.
// 결정 기준본: docs/decisions/0034-mew-agent-panel-acp-reintroduction.md,
// 워크스페이스 스코프·런타임 전환은 docs/decisions/0043-mew-agent-workspace-scope-and-runtimes.md
//
// 스코프는 프로젝트가 아니라 워크스페이스다 — 어느 프로젝트를 보고 있든 같은 창이 뜬다. 레포를 오가며
// 시키는 일(문서는 docs에, 코드는 제품 레포에)이 창을 바꾸지 않고 한 대화에서 되게 하려는 것.
// 대화를 여럿 굴리는 축은 프로젝트가 아니라 **창의 탭**이다 — 탭 하나에 세션 하나, 자식 프로세스 하나.
//
// 보안 경계는 한 겹이다 — 이 모듈을 붙이는 WS가 owner/manager만 통과시킨다(server/agentWs.ts).
// 파일 도구도 Bash도 mew 서버와 같은 유닉스 사용자 권한으로 돌고 경로 스코프가 없다. 창을 열어 주는 것은
// 무인 셸을 주는 것과 같다(ADR 0044). 실질 격리는 OS 층이며 아직 없다.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import fs from 'node:fs'
import { killMemoryScope, memoryPressure, memoryScopeCommand, readAgentMemory, type MemoryReader } from './agent-memory.ts'
import { agentContextText, captureAgentContext, refreshAgentContext, restoreAgentContext, saveAgentContext } from './agent-context.ts'
import { stripMewContext } from './project-context-text.ts'
import type { AgentContextBinding } from '../shared/project-agent-context.ts'
import { antigravityAuthUrl } from './antigravityAcp.ts'
import { accessIssueFromError, type AccessIssue } from '../shared/agent-access.ts'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type ContentBlock,
  type AuthMethod,
  type AuthenticateRequest,
  type Client,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionInfo,
  type SessionModelState,
  type SessionModeState,
  type SessionConfigOption,
  type SessionNotification,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import { WORKSPACE_ROOT } from './paths.ts'
import { UsageReader, type Usage } from './agentUsage.ts'
import { readAgentTranscript, reconcileAgentTranscript, writeAgentTranscript } from './agentTranscript.ts'
import { listSessionsFromDisk, stripLocalCommandMeta } from './agentSessionList.ts'
import { readAgentDefault, type AgentRuntimeDefault } from './agentDefaults.ts'
export {
  acpRuntimeList,
  agentSetRuntimeList,
  DEFAULT_RUNTIME,
  isAcpRuntime,
  isRuntime,
  isRuntimeLoginMethod,
  RUNTIMES,
  RUNTIME_LOGIN_METHOD_ID,
  runtimeLoginSpec,
  type SpawnSpec,
} from './agentRuntimes.ts'
import {
  resolvedSpec,
  RUNTIMES,
  isRuntimeLoginMethod,
  runtimeLoginSpec,
  type SpawnSpec,
} from './agentRuntimes.ts'

/** 에이전트와 그 자손에 심는 주인 표식 — 값은 AgentSession을 소유한 프로세스 pid다(reapOrphanAgents가 읽는다) */
const OWNER_ENV = 'MEW_AGENT_OWNER'

/**
 * 새 세션은 그 런타임에서 **가장 많이 열린 모드**로 시작한다 — 에이전트 창은 터미널과 같은 게이트를
 * 쓰는 owner/manager 전용 도구이고, 승인 프롬프트는 그 사람이 이미 가진 권한을 다시 묻는 것뿐이다
 * (ADR 0037). 한 가지 값으로 못 박지 않는 이유는 런타임마다 이름이 다르기 때문이다:
 * claude는 `bypassPermissions`, codex는 `agent-full-access`, hermes는 `dont_ask`가 그 자리다
 * (claude에도 `dontAsk`가 있지만 그쪽은 "미리 승인 안 된 건 거절"이라 뜻이 반대다 — 순서로 갈린다).
 * 앞에서부터 그 세션이 광고한 것 중 처음 맞는 것을 고른다. 되돌리려면 `MEW_AGENT_MODE=default`처럼
 * 모드 id를 박아 준다(그 하나만 시도한다).
 */
const MODE_OVERRIDE = process.env.MEW_AGENT_MODE || null
const FULL_ACCESS_MODES = [
  'bypassPermissions',
  'agent-full-access',
  'full-access',
  'full_access',
  'fullAccess',
  'yolo',
  'dont_ask',
  'dontAsk',
]

/** 작업이 끝났고 붙어 있는 창도 없는 채로 이만큼 지나면 에이전트를 죽인다 */
export const AGENT_IDLE_MS = 30 * 60_000

/** 어댑터를 띄운 뒤 ACP 핸드셰이크가 이만큼 걸리면 포기한다 — 정상이면 몇 초다 */
const HANDSHAKE_TIMEOUT_MS = 30_000

type QueuedPrompt = {
  kind: 'prompt'
  /** 창에 보여 줄 원문 */
  text: string
  /** ACP 런타임에 실제로 보낼 프롬프트 */
  promptText: string
  images: AgentImage[]
  imageRefs: AgentImageRef[]
  settings?: AgentMessageSettings
}

type AgentImage = { data: string; mimeType: string }
/** 대화 전사에는 바이트 대신 프로젝트 안의 업로드 경로만 남긴다. */
export type AgentImageRef = { path: string; mimeType: string }
/** 사용자가 전송을 누른 순간의 실행 설정. 대화 전사에 남겨 각 질문의 조건을 재현한다. */
export type AgentMessageSettings = { model: string; thinking: string; permission: string }

/** 큐 안의 세션 경계. 뒤의 프롬프트는 새 ACP 세션에 전달한다. */
type QueuedClear = { kind: 'clear'; text: '/clear' }
/** Non-AI work shares queue ordering but never enters the ACP prompt or transcript. */
export type AgentQueuedTask = {
  id: string
  text: string
  run: (context: { sessionId: string; afterUserCount: number }) => Promise<void>
  cancel: () => void
}
type QueuedCli = AgentQueuedTask & { kind: 'cli' }
type QueuedItem = (QueuedPrompt | QueuedClear | QueuedCli) & {
  /** 이 연결에서 내용을 고치는 동안 큐 실행을 멈추는 소유자 표식. */
  editOwner?: string
}

/** 창 상단 정보줄이 그리는 값 — 이벤트 버퍼에 쌓지 않고 바뀔 때마다 현재 값을 통째로 보낸다 */
export type SessionMeta = {
  sessionId: string
  /** 세션이 시작된 시각(ISO). 히스토리를 불러오면 그 세션의 첫 기록 시각이다 */
  startedAt: string
  turns: number
  busy: boolean
  /** 진행 중인 턴이 끝나면 순서대로 실행될 대기 메시지 */
  queued: string[]
  queuedKinds?: ('prompt' | 'clear' | 'cli')[]
  activeTask?: 'cli' | null
  accessIssue?: AccessIssue | null
  memoryPaused?: boolean
  usage: Usage | null
  canLoad: boolean
  canList: boolean
}

/** 브라우저에 보여 줄 인증 방법. 비밀값과 실행 명령은 서버 밖으로 내보내지 않는다. */
export type AgentAuthMethod = {
  id: string
  name: string
  description?: string | null
  kind: 'agent' | 'api-key' | 'terminal'
  surface?: 'browser' | 'terminal'
  browserInput?: 'authorization-code'
  serverBrowser?: boolean
}

export type TerminalAuthSpec = SpawnSpec & { label: string; completionFile?: string }

type AuthMethodInternal = AgentAuthMethod & { terminal?: TerminalAuthSpec }

export type AgentEvent =
  | { type: 'update'; update: SessionNotification['update']; settings?: AgentMessageSettings }
  | { type: 'user_images'; images: AgentImageRef[] }
  | { type: 'permission'; id: string; toolCall: ToolCallUpdate; options: PermissionOption[] }
  | { type: 'permission_done'; id: string }
  | { type: 'turn_start'; startedAt: number }
  | { type: 'turn_end'; stopReason: string; durationMs: number }
  | { type: 'error'; message: string; accessIssue?: AccessIssue }
  | { type: 'models'; models: SessionModelState }
  | { type: 'modes'; modes: SessionModeState }
  | { type: 'thinking'; thinking: ThinkingState | null }
  | { type: 'meta'; meta: SessionMeta }
  | { type: 'auth'; methods: AgentAuthMethod[]; authenticating: boolean; error: string | null }
  | { type: 'auth_url'; id: string; url: string; message: string }
  | { type: 'auth_url_done'; id: string }
  | { type: 'auth_complete' }
  /** 대화가 갈아끼워졌다(새 세션·히스토리 불러오기) — 창은 지금까지 그린 것을 버린다 */
  | { type: 'reset' }

export interface ModelInfo {
  modelId: string
  name: string
}

export type ThinkingState = {
  configId: string
  currentValue: string
  options: { id: string; name: string; description?: string | null }[]
}

function thinkingFrom(configOptions: SessionConfigOption[] | null | undefined): ThinkingState | null {
  const option = configOptions?.find((item) => item.category === 'thought_level' && item.type === 'select')
  if (!option || typeof option.currentValue !== 'string' || !Array.isArray(option.options)) return null
  const options = option.options.flatMap((item: any) => 'options' in item ? item.options : [item])
    .filter((item: any) => typeof item?.value === 'string')
    .map((item: any) => ({ id: item.value, name: typeof item.name === 'string' ? item.name : item.value, description: item.description ?? null }))
  return options.length > 0 ? { configId: option.id, currentValue: option.currentValue, options } : null
}

/**
 * 런타임별로 마지막에 본 모델 목록 — 셋 편집 창의 모델 검색이 이걸 쓴다.
 * ACP는 세션이 떠야 모델을 알려 주므로, 창(agentWs)·셋 러너·probeModels 중 **무엇으로 떴든**
 * 여기 한 곳에 모인다. ponytail: 메모리에만 산다 — 재시작하면 다시 빈다.
 */
const knownModels = new Map<string, ModelInfo[]>()

export const modelsByRuntime = (): Record<string, ModelInfo[]> => Object.fromEntries(knownModels)

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

function isAuthRequiredError(err: unknown): boolean {
  if (accessIssueFromError(err)) return false
  if (err && typeof err === 'object' && (err as { code?: unknown }).code === -32000) return true
  const message = err instanceof Error ? err.message : String(err)
  return /authentication required|auth_required|not logged in|please (?:run \/login|log in|sign in)/i.test(message)
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function runtimeLoginMethods(runtime: string): AuthMethodInternal[] {
  const entry = RUNTIMES[runtime]
  if (!entry) return []
  return entry.auth.methods().map(({ id, cmd, args, env, label, name, description, surface, browserInput, serverBrowser, completionFile }) => ({
    id,
    name,
    description,
    kind: 'terminal' as const,
    surface,
    browserInput,
    serverBrowser,
    terminal: { cmd, args, env, label, completionFile },
  }))
}

/** initialize 전에 ACP가 죽은 탭도 같은 로그인 UI를 그릴 수 있는 공개 상태. */
export function runtimeLoginAuthEvent(runtime: string, error: string | null, authenticating = false): AgentEvent {
  const accessIssue = accessIssueFromError(error)
  if (accessIssue) return { type: 'error', message: error!, accessIssue }
  const methods = runtimeLoginMethods(runtime).map(({ id, name, description, kind, surface, browserInput, serverBrowser }) => ({ id, name, description, kind, surface, browserInput, serverBrowser }))
  return { type: 'auth', methods, authenticating, error }
}

/**
 * SDK 0.14는 ACP v1의 id/name/_meta를 보존한다. 최신 terminal auth의 실행 정보는 어댑터가
 * 호환용 `_meta["terminal-auth"]`에도 싣기 때문에, 모델/config 계약을 함께 이관하지 않고 인증만
 * 받을 수 있다. HTTP에는 정규화한 공개 정보만 보내고 실제 명령은 세션 안에 둔다.
 */
function normalizeAuthMethods(runtime: string, methods: AuthMethod[]): AuthMethodInternal[] {
  const runtimeAuth = RUNTIMES[runtime]?.auth
  const replaced = new Set(runtimeAuth?.replaceMethodIds ?? [])
  const normalized = methods.flatMap<AuthMethodInternal>((method) => {
    if (replaced.has(method.id)) return []
    const meta = recordOf(method._meta)
    const terminalMeta = recordOf(meta?.['terminal-auth'])
    const command = typeof terminalMeta?.command === 'string' ? terminalMeta.command : null
    const args = Array.isArray(terminalMeta?.args) && terminalMeta.args.every((arg) => typeof arg === 'string')
      ? terminalMeta.args as string[]
      : null
    const terminal = command && args
      ? {
          cmd: command,
          args,
          env: RUNTIMES[runtime]?.spec?.().env,
          label: typeof terminalMeta?.label === 'string' ? terminalMeta.label : method.name,
        }
      : undefined
    const apiKey = runtime !== 'antigravity' && (method.id === 'api-key'
      || method.id.endsWith('-api-key')
      || /api[ -]?key/i.test(method.name)
      || meta?.['api-key'] !== undefined)
    return [{
      id: method.id,
      name: method.name,
      description: runtime === 'antigravity' && method.id === 'gemini-api-key'
        ? '런타임 설정에 GEMINI_API_KEY를 저장한 뒤 새 탭에서 연결하세요.' : method.description,
      kind: terminal ? 'terminal' : apiKey ? 'api-key' : 'agent',
      terminal,
    }]
  })
  // terminal type/args가 SDK 0.14에서 사라지는 런타임과 initialize 자체가 실패하는 런타임 모두가
  // 같은 GUI 경로를 쓴다. 어댑터가 이미 더 구체적인 terminal 방법을 주면 중복 카드는 만들지 않는다.
  if (runtimeAuth && !normalized.some((method) => method.kind === 'terminal')) {
    normalized.push(...runtimeLoginMethods(runtime))
  }
  return normalized
}

function safeAuthUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.toString() : null
  } catch {
    return null
  }
}

/** 떠 있는 세션 전부. sessions 맵과 달리 Promise가 아니다 — 나가는 길(process 'exit')에서는
 *  then이 돌 기회가 없어서, 동기적으로 죽일 수 있는 목록이 따로 있어야 한다 */
const live = new Set<AgentSession>()

export class AgentSession {
  /** 어떤 백엔드로 떠 있는지(RUNTIMES의 키) — 창의 아이콘이 이것을 그린다 */
  readonly runtime: string
  /** sessions 맵에서 자기를 지우기 위한 열쇠 — sessionFor가 심는다(테스트가 직접 띄운 세션은 빈 값) */
  key = ''
  readonly cwd: string
  #child!: ChildProcess
  #memoryScope: string | undefined
  #conn!: ClientSideConnection
  #startupFailure!: Promise<never>
  #spec: SpawnSpec
  #restarting = false
  #clearFailed = false
  #rejectStartup: ((err: Error) => void) | null = null
  #sessionId = ''
  #accessIssue: AccessIssue | null = null
  #events: AgentEvent[] = []
  /** session/load가 성공하기 전까지 전사를 숨겨 두는 임시 버퍼 — 실패한 세션이 현재 대화를 오염시키지 않게 한다. */
  #loadingEvents: AgentEvent[] | null = null
  #listeners = new Set<(event: AgentEvent) => void>()
  #pending = new Map<string, (response: RequestPermissionResponse) => void>()
  #idleTimer: NodeJS.Timeout | null = null
  #idleKillMs: number
  #disposeListeners = new Set<() => void>()
  #nextPermissionId = 1
  #disposed = false
  #models: SessionModelState | null = null
  #modes: SessionModeState | null = null
  #thinking: ThinkingState | null = null
  #caps: AgentCapabilities = {}
  #authMethods: AuthMethodInternal[] = []
  #authRequired = false
  #authenticating = false
  #authError: string | null = null
  #pendingElicitations = new Map<string, (response: Record<string, unknown>) => void>()
  #authUrls = new Map<string, Extract<AgentEvent, { type: 'auth_url' }>>()
  #cancelStderrAuth: ((error: Error) => void) | null = null
  #stderrAuthSequence = 0
  #startedAt = new Date().toISOString()
  #turns = 0
  #queue: QueuedItem[] = []
  #activeTask: QueuedCli | null = null
  #reader: UsageReader | null = null
  #usage: Usage | null = null
  #readMemory: MemoryReader
  #memoryPaused = false
  #memoryTimer: NodeJS.Timeout
  busy = false

  #context: AgentContextBinding

  private constructor(runtime: string, spec: SpawnSpec, cwd = WORKSPACE_ROOT, idleKillMs = AGENT_IDLE_MS, context = captureAgentContext(cwd), readMemory: MemoryReader = readAgentMemory) {
    this.#context = context
    this.runtime = runtime
    this.cwd = cwd
    this.#idleKillMs = idleKillMs
    this.#spec = spec
    this.#readMemory = readMemory
    this.#spawn()
    this.#memoryTimer = setInterval(() => this.checkMemory(), 2_000)
    this.#memoryTimer.unref()
    live.add(this)
  }

  #spawn() {
    const pressure = this.#memoryProblem()
    if (pressure) throw new Error(pressure)
    const spec = this.#spec
    this.#startupFailure = new Promise<never>((_resolve, reject) => {
      this.#rejectStartup = reject
    })
    const env = { ...process.env, ...spec.env }
    // 주인 표식은 자손까지 그대로 상속된다 — 서버가 SIGKILL로 죽어도 다음 실행이 이걸 보고 걷어낸다
    env[OWNER_ENV] = String(process.pid)
    // CLAUDECODE가 켜져 있으면 Claude Code가 "중첩 세션"으로 보고 실행을 거부한다. mew 서버를 Claude Code
    // 터미널에서 띄우면 이 변수가 그대로 상속돼 에이전트 창이 통째로 죽는다 — 여기 세션은 중첩이 아니라
    // 별개 프로세스이므로 떼고 넘긴다.
    delete env.CLAUDECODE
    // 탭 복원 포인터는 감독 프로세스만 쓴다. 아래 ACP/CLI의 환경변수로 넘기지 않는다.
    delete env.MEW_AGENT_RESUME_SESSION
    delete env.MEW_AGENT_CONTEXT
    // detached — 어댑터를 프로세스 그룹 리더로 띄운다. 어댑터는 세션마다 CLI를 하나씩 밑에 두는데,
    // 어댑터만 죽이면 그 손자들이 고아로 남는다(#killTree가 그룹째 보낼 수 있어야 한다).
    const command = memoryScopeCommand(spec.cmd, spec.args)
    this.#memoryScope = command.unit
    this.#child = spawn(command.cmd, command.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      detached: true,
    })
    const child = this.#child
    let stderrLine = ''
    let discardStderrLine = false
    this.#child.stderr?.on('data', (chunk: Buffer) => {
      if (this.runtime === 'antigravity') {
        // Its OAuth protocol prints a URL to stderr, sometimes across multiple chunks.
        // Do not persist the URL (or token-bearing diagnostics) in supervisor logs.
        for (const part of chunk.toString().split(/(?<=\n)/)) {
          stderrLine += part
          if (stderrLine.length > 32_768) { stderrLine = ''; discardStderrLine = true }
          if (!part.endsWith('\n')) continue
          if (!discardStderrLine && child === this.#child && this.#authenticating && !this.#restarting) {
            const url = antigravityAuthUrl(stderrLine)
            if (url && ![...this.#authUrls.values()].some((event) => event.url === url)) {
              const id = `antigravity-oauth-${++this.#stderrAuthSequence}`
              const event = { type: 'auth_url', id, url, message: 'Google 계정으로 로그인하세요.' } as const
              this.#authUrls.set(id, event)
              this.#broadcast(event)
            }
          }
          stderrLine = ''
          discardStderrLine = false
        }
        return
      }
      console.error(`[mew:agent:${this.runtime}]`, chunk.toString().trimEnd())
    })
    this.#child.on('error', (err) => {
      if (!this.#disposed && child === this.#child) this.#failStartup(`에이전트를 실행하지 못했습니다: ${err.message}`)
    })
    this.#child.on('exit', (code, signal) => {
      if (!this.#disposed && child === this.#child) {
        const hint = command.scoped && (signal === 'SIGKILL' || code === 137)
          ? ' OS 메모리 한도에 의한 종료 가능성이 있습니다. mew-agents.slice의 memory.events와 사용자 journal을 확인하세요.' : ''
        this.#failStartup(`에이전트가 종료됐습니다 (code=${code} signal=${signal}).${hint}`)
      }
    })
    const stream = ndJsonStream(
      Writable.toWeb(this.#child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(this.#child.stdout!) as ReadableStream<Uint8Array>,
    )
    this.#conn = new ClientSideConnection(() => this.#client(), stream)
  }

  static async start(
    runtime: string,
    spec: SpawnSpec | undefined = resolvedSpec(runtime) ?? undefined,
    cwd = WORKSPACE_ROOT,
    idleKillMs = AGENT_IDLE_MS,
    context?: AgentContextBinding,
    readMemory: MemoryReader = readAgentMemory,
  ): Promise<AgentSession> {
    if (!spec) throw new Error(`ACP를 지원하지 않는 에이전트 런타임입니다: ${runtime}`)
    const pressure = memoryPressure(readMemory())
    if (pressure) {
      console.error(`[mew:agent-memory] ${new Date().toISOString()} ${pressure}; 에이전트 시작 거부`)
      throw new Error(pressure)
    }
    const session = new AgentSession(runtime, spec, cwd, idleKillMs, context, readMemory)
    try {
      await session.#initializeWithTimeout()
      session.#armIdleTimer()
      return session
    } catch (err) {
      session.dispose()
      throw err
    }
  }

  async #initializeWithTimeout(createSession = true) {
    let handshakeTimer: NodeJS.Timeout | null = null
    try {
      // 핸드셰이크에 시한을 둔다 — 어댑터가 떴는데 ACP를 말하지 않으면(잘못 깔린 실행 파일, 로그인
      // 안 된 CLI) initialize의 응답이 영영 오지 않는다. 시한이 없으면 그 자리에서 기다리는 쪽이
      // 통째로 멎는다: 창은 "에이전트 준비 중"에서, 셋은 작업이 running인 채로 굳는다
      await Promise.race([
        this.#handshake(createSession),
        this.#startupFailure,
        new Promise<never>((_, reject) => {
          handshakeTimer = setTimeout(
            () => reject(new Error('에이전트가 응답하지 않습니다 (핸드셰이크 시간 초과)')),
            HANDSHAKE_TIMEOUT_MS,
          )
          handshakeTimer.unref?.()
        }),
      ])
      this.#rejectStartup = null
    } finally {
      if (handshakeTimer) clearTimeout(handshakeTimer)
    }
  }

  /** 이 세션이 이미 접혔는지 — 종료 뒤 중복 호출을 막는다 */
  get disposed(): boolean {
    return this.#disposed
  }

  /** 감독이 새로 뜨었을 때 저장된 탭의 세션을 자동 resume할 수 있는지. */
  get canLoadSession(): boolean {
    return this.#caps.loadSession === true
  }

  /** 히스토리 전환 전에 현재 writer가 안전하게 내려갈 수 있는 상태인지 확인한다. */
  assertCanLoadSession() {
    if (this.busy || this.#pending.size > 0 || this.#queue.length > 0) {
      throw new Error('진행 중인 작업과 대기 메시지가 끝난 뒤 세션을 불러오세요')
    }
    if (this.#loadingEvents) throw new Error('이미 다른 세션을 불러오는 중입니다')
  }

  get sessionId(): string {
    return this.#sessionId
  }

  /** 감독 프로세스가 세션의 유휴 종료를 자기 수명 종료로 이어 붙이는 손잡이. */
  onDispose(listener: () => void): () => void {
    if (this.#disposed) {
      queueMicrotask(listener)
      return () => {}
    }
    this.#disposeListeners.add(listener)
    return () => this.#disposeListeners.delete(listener)
  }

  async #handshake(createSession = true) {
    // capability를 하나도 광고하지 않는다 — 어댑터가 CLI 기본 도구(Read/Write/Edit/Bash)를 그대로 쓴다.
    // fs를 켜면 그 도구들이 꺼지고 mcp__acp__* 로 갈리는데, 그러면 CLI에서 만든 대화를 창에서 불러올 때
    // 전사 속 `Edit` 참조를 API가 거부한다("Tool reference 'Edit' not found"). 도구 이름을 CLI와
    // 맞춰 두는 쪽을 택했다 — 경로 스코프를 잃는 대신 대화가 양쪽에서 이어진다(ADR 0044).
    const init = await this.#conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      // fs는 의도적으로 광고하지 않는다. 인증에 필요한 terminal/url capability만 더한다.
      // direct SDK 0.14의 타입보다 새 ACP v1 필드가 앞서 있어 wire-compatible 값을 좁게 캐스팅한다.
      clientCapabilities: {
        auth: { terminal: true },
        elicitation: { url: {} },
        session: { configOptions: {} },
        _meta: { 'terminal-auth': true },
      } as never,
    })
    this.#caps = init.agentCapabilities ?? {}
    this.#authMethods = normalizeAuthMethods(this.runtime, init.authMethods ?? [])
    if (!createSession) return
    try {
      await this.#createSession()
    } catch (err) {
      if (!isAuthRequiredError(err) || this.#authMethods.length === 0) throw err
      this.#enterAuth()
    }
  }

  async #createSession() {
    const created = await this.#conn.newSession({ cwd: this.cwd, mcpServers: [] })
    this.#adopt(created.sessionId, created.models ?? null, created.modes ?? null, created.configOptions)
    this.#authRequired = false
    this.#authenticating = false
    this.#authError = null
    await this.#applyDefaults()
  }

  #enterAuth(err?: unknown) {
    this.#authRequired = true
    this.#authenticating = false
    this.#authError = err ? describeError(err) : null
    this.#broadcast(this.#authEvent())
    this.#armIdleTimer()
  }

  #closeAuthUrl(id: string) {
    if (!this.#authUrls.delete(id)) return
    this.#broadcast({ type: 'auth_url_done', id })
  }

  #closeAuthUrls() {
    for (const id of [...this.#authUrls.keys()]) this.#closeAuthUrl(id)
  }

  #publicAuthMethods(): AgentAuthMethod[] {
    return this.#authMethods.map(({ id, name, description, kind, surface, browserInput, serverBrowser }) => ({ id, name, description, kind, surface, browserInput, serverBrowser }))
  }

  #authEvent(): AgentEvent {
    return {
      type: 'auth',
      methods: this.#publicAuthMethods(),
      authenticating: this.#authenticating,
      error: this.#authError,
    }
  }

  /** 새로 만들었거나 불러온 ACP 세션으로 갈아탄다 — 사용량 리더도 그 세션 파일을 보게 바꾼다 */
  #adopt(sessionId: string, models: SessionModelState | null, modes: SessionModeState | null, configOptions?: SessionConfigOption[] | null) {
    this.#context = restoreAgentContext(this.runtime, this.cwd, sessionId) ?? refreshAgentContext(this.#context)
    saveAgentContext(this.runtime, this.cwd, sessionId, this.#context)
    this.#sessionId = sessionId
    this.#clearFailed = false
    this.#accessIssue = null
    this.#reader = new UsageReader(this.cwd, sessionId)
    this.#usage = null
    if (models) this.#useModels(models)
    if (modes) {
      this.#modes = modes
      this.#emit({ type: 'modes', modes })
    }
    this.#useThinking(thinkingFrom(configOptions))
  }

  /**
   * 세션은 대개 제한 모드로 시작한다(claude `default`·codex `auto`). 원하는 모드는 세션을 새로 잡을
   * 때마다 다시 걸어 줘야 한다 — 그 런타임이 그런 모드를 아예 광고하지 않으면(root로 도는 claude에는
   * bypass가 없다) 그냥 넘어간다. 실패해도 세션은 살린다: 모드 하나 때문에 창이 안 뜨면 안 된다.
   */
  async #applyDefaults() {
    let saved: AgentRuntimeDefault | null = null
    // 계약 테스트·probe가 직접 넘기는 임시 런타임 id는 등록표 기본값의 대상이 아니다.
    if (RUNTIMES[this.runtime]) {
      try {
        saved = readAgentDefault(this.runtime)
      } catch (err) {
        // 기본값 파일 하나가 깨져도 에이전트 창 자체는 떠야 한다. 쓰기 API는 같은 오류를 숨기지 않고 돌려준다.
        console.error(`[mew:agent:${this.runtime}] 저장된 기본값을 읽지 못했습니다:`, err)
      }
    }

    const models = this.#models
    const modelId = saved?.modelId
    if (models && modelId && models.availableModels.some((model) => model.modelId === modelId) && modelId !== models.currentModelId) {
      await this.setModel(modelId).catch((err: unknown) => {
        console.error(`[mew:agent:${this.runtime}] 기본 모델 ${modelId} 적용 실패:`, err)
      })
    }

    const modes = this.#modes
    if (modes) {
      // 환경변수는 운영자가 서버 전체에 강제한 값이라 UI 저장값보다 우선한다. 저장값이 없거나 런타임이
      // 더는 그 id를 광고하지 않으면 ADR 0037의 전체 허용 후보 순서로 안전하게 폴백한다.
      const wanted = MODE_OVERRIDE ? [MODE_OVERRIDE] : saved?.modeId ? [saved.modeId, ...FULL_ACCESS_MODES] : FULL_ACCESS_MODES
      const pick = wanted.find((id) => modes.availableModes.some((mode) => mode.id === id))
      if (pick && pick !== modes.currentModeId) {
        await this.setMode(pick).catch((err: unknown) => {
          console.error(`[mew:agent:${this.runtime}] 권한 모드 ${pick} 적용 실패:`, err)
        })
      }
    }

    const thinking = this.#thinking
    const thinkingId = saved?.thinkingId
    if (thinking && thinkingId && thinking.options.some((option) => option.id === thinkingId) && thinkingId !== thinking.currentValue) {
      await this.setThinking(thinking.configId, thinkingId).catch((err: unknown) => {
        console.error(`[mew:agent:${this.runtime}] 추론 정도 ${thinkingId} 적용 실패:`, err)
      })
    }
  }

  #client(): Client {
    return {
      sessionUpdate: async (params: SessionNotification) => {
        // 에이전트가 스스로 모드를 바꾸기도 한다(계획 모드 종료 등) — 창의 선택기가 따라가야 한다
        if (params.update.sessionUpdate === 'current_mode_update' && this.#modes) {
          this.#modes = { ...this.#modes, currentModeId: params.update.currentModeId }
          this.#emit({ type: 'modes', modes: this.#modes })
        }
        if (params.update.sessionUpdate === 'config_option_update') {
          const update = params.update as any
          const thinking = this.#thinking
          if (typeof update.configId === 'string' && typeof update.value === 'string' && thinking?.configId === update.configId) {
            this.#useThinking({ ...thinking, currentValue: update.value } as ThinkingState)
          }
        }
        // 불러온 히스토리의 사용자 발화에는 CLI 메타가 섞여 온다(어댑터가 기록을 그대로 되재생한다).
        // 창에서 방금 친 프롬프트는 #run이 직접 넣으므로 이 길로 오지 않는다 — 여기 필터는 히스토리만 탄다.
        if (params.update.sessionUpdate === 'user_message_chunk') {
          const content = params.update.content
          if (!Array.isArray(content) && content?.type === 'text') {
            const text = stripLocalCommandMeta(stripMewContext(content.text))
            if (!text) return
            if (text !== content.text) {
              this.#emit({ type: 'update', update: { ...params.update, content: { ...content, text } } })
              return
            }
          }
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
      // SDK 0.14가 아직 이름을 모르는 ACP v1 elicitation 요청은 확장 메서드 통로로 들어온다.
      // URL은 브라우저가 명시적으로 동의해 열 때까지 기다리고, 비밀값은 ACP로 되돌리지 않는다.
      extMethod: (method, params) => {
        if (method !== 'elicitation/create') return Promise.reject(new Error(`지원하지 않는 ACP 요청입니다: ${method}`))
        const url = safeAuthUrl(params.url)
        const id = typeof params.elicitationId === 'string' ? params.elicitationId : `auth-${Date.now()}`
        if (params.mode !== 'url' || !url) return Promise.reject(new Error('안전한 HTTPS 로그인 주소가 아닙니다'))
        const message = typeof params.message === 'string' ? params.message : '브라우저에서 로그인을 완료하세요.'
        return new Promise<Record<string, unknown>>((resolve) => {
          this.#pendingElicitations.set(id, resolve)
          const event = { type: 'auth_url', id, url, message } as const
          this.#authUrls.set(id, event)
          this.#broadcast(event)
        })
      },
      extNotification: async (method, params) => {
        if (method !== 'elicitation/complete') return
        const id = typeof params.elicitationId === 'string' ? params.elicitationId : ''
        if (id) this.#closeAuthUrl(id)
      },
      // fs capability를 광고하지 않으므로 readTextFile·writeTextFile은 구현하지 않는다 — 파일은
      // CLI가 자기 Read/Write/Edit로 직접 다룬다(ADR 0044).
    }
  }

  /**
   * 지금까지 쌓인 대화 이벤트 — 재접속한 창이 **한 덩어리로**(`replay`) 받아 통째로 갈아끼운다.
   * 예전에는 attach가 이걸 한 개씩 흘려보냈는데, 창은 이벤트마다 다시 그리느라 긴 되감기에서
   * 눈에 띄게 굳었고 그 사이 대화가 빈 것으로 보였다(빈 탭 화면이 잠깐 뜨는 원인).
   */
  snapshot(): AgentEvent[] {
    return [...this.#events]
  }

  /** 지금부터 오는 이벤트만 받는다 — 지나간 것은 위 snapshot()이 준다 */
  attach(listener: (event: AgentEvent) => void): () => void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    listener(this.#authRequired ? this.#authEvent() : this.#metaEvent())
    if (this.#authRequired) for (const event of this.#authUrls.values()) listener(event)
    this.#listeners.add(listener)
    if (!this.#authRequired) void this.#pushMeta()
    return () => {
      this.#listeners.delete(listener)
      this.#armIdleTimer()
    }
  }

  /** ACP가 직접 처리하는 로그인(ChatGPT device code·API key 등). */
  async authenticate(methodId: string, secret?: string) {
    if (!this.#authRequired) return
    if (this.#authenticating) throw new Error('이미 로그인 중입니다')
    const method = this.#authMethods.find((item) => item.id === methodId)
    if (!method) throw new Error('에이전트가 광고하지 않은 로그인 방법입니다')
    if (method.kind === 'terminal') throw new Error('이 로그인 방법은 전용 터미널에서 실행해야 합니다')
    if (method.kind === 'api-key' && !secret?.trim()) throw new Error('API 키를 입력하세요')

    this.#authenticating = true
    this.#authError = null
    this.#broadcast(this.#authEvent())
    const cleanSecret = secret?.trim()
    const apiKeyMeta = cleanSecret
      ? RUNTIMES[this.runtime]?.auth.apiKeyMeta?.(cleanSecret) ?? { 'api-key': { apiKey: cleanSecret } }
      : undefined
    const request = (method.kind === 'api-key'
      ? { methodId, _meta: apiKeyMeta }
      : { methodId }) as AuthenticateRequest
    let authTimer: NodeJS.Timeout | undefined
    let interrupted = false
    try {
      const operation = this.#conn.authenticate(request)
      if (this.runtime === 'antigravity') {
        await Promise.race([operation, new Promise<never>((_, reject) => {
          this.#cancelStderrAuth = (error) => { interrupted = true; reject(error) }
          authTimer = setTimeout(() => this.#cancelStderrAuth?.(new Error('Google 로그인 시간이 초과됐습니다. 다시 시도하세요.')), 330_000)
          authTimer.unref?.()
        })])
      } else await operation
      await this.#createSession()
      this.#closeAuthUrls()
      this.#broadcast({ type: 'auth_complete' })
      await this.#pushMeta()
    } catch (err) {
      this.#closeAuthUrls()
      if (interrupted && !this.#disposed) {
        // ACP has no authenticate/cancel: close this connection's login listener before retrying.
        this.#restarting = true
        try {
          await this.#stopTransport()
          if (!this.#disposed) {
            this.#spawn()
            await this.#initializeWithTimeout(false)
          }
        } finally { this.#restarting = false }
      }
      this.#enterAuth(err)
      throw err
    } finally {
      if (authTimer) clearTimeout(authTimer)
      this.#cancelStderrAuth = null
      this.#armIdleTimer()
    }
  }

  /** 외부 CLI가 자격증명을 쓴 뒤 필요하면 ACP 인증 방식을 확정하고 세션 생성을 다시 시도한다. */
  async retryAuthentication(acpMethodId?: string) {
    if (!this.#authRequired || this.#authenticating) return
    this.#authenticating = true
    this.#authError = null
    this.#broadcast(this.#authEvent())
    try {
      if (acpMethodId) await this.#conn.authenticate({ methodId: acpMethodId })
      await this.#createSession()
      this.#broadcast({ type: 'auth_complete' })
      await this.#pushMeta()
    } catch (err) {
      this.#enterAuth(err)
      throw err
    } finally {
      this.#armIdleTimer()
    }
  }

  answerElicitation(id: string, action: 'accept' | 'decline' | 'cancel') {
    if (this.runtime === 'antigravity' && id.startsWith('antigravity-oauth-') && this.#authUrls.has(id)) {
      if (action !== 'accept') this.#cancelStderrAuth?.(new Error('Google 로그인이 취소됐습니다. 다시 시도하세요.'))
      return
    }
    const resolve = this.#pendingElicitations.get(id)
    if (!resolve) return
    this.#pendingElicitations.delete(id)
    resolve({ action })
    if (action !== 'accept') this.#closeAuthUrl(id)
  }

  terminalAuthSpec(methodId: string): TerminalAuthSpec {
    if (isRuntimeLoginMethod(this.runtime, methodId)) {
      const { cmd, args, env, label, completionFile } = runtimeLoginSpec(this.runtime, methodId)
      return { cmd, args, env, label, completionFile }
    }
    const method = this.#authMethods.find((item) => item.id === methodId)
    if (!method?.terminal) throw new Error('터미널 로그인 방법을 찾을 수 없습니다')
    return method.terminal
  }

  /** 진행 중인 턴이 있으면 줄을 세운다 — 끝나는 대로 순서대로 이어 돈다 */
  prompt(text: string, promptText = text, images: AgentImage[] = [], imageRefs: AgentImageRef[] = [], settings?: AgentMessageSettings, automatic = false) {
    if (this.#authRequired || !this.#sessionId) throw new Error('먼저 에이전트에 로그인하세요')
    if (automatic) {
      const pressure = this.#memoryProblem()
      if (pressure) this.#pauseForMemory(pressure)
      if (this.#memoryPaused) {
        this.#queue.push({ kind: 'prompt', text, promptText, images, imageRefs, settings })
        if (this.#idleTimer) { clearTimeout(this.#idleTimer); this.#idleTimer = null }
        this.#broadcast(this.#metaEvent())
        return
      }
    }
    const memoryResumed = automatic ? false : this.#admitMemory()
    // Explicit new submission resumes a quota-paused queue; edits/reconnects do not.
    const resume = memoryResumed || !this.busy && this.#accessIssue !== null
    if (resume) this.#accessIssue = null
    if (this.busy || this.#queue.length > 0 || this.#clearFailed) {
      this.#queue.push({ kind: 'prompt', text, promptText, images, imageRefs, settings })
      this.#broadcast(this.#metaEvent())
      if (resume) this.#drainQueue()
      return
    }
    this.#run(text, promptText, images, imageRefs, settings)
  }

  enqueueTask(task: AgentQueuedTask) {
    if (this.#disposed || this.#authRequired || !this.#sessionId) throw new Error('에이전트 대화를 준비한 뒤 다시 시도하세요')
    if (this.#activeTask?.id === task.id || this.#queue.some(item => item.kind === 'cli' && item.id === task.id)) return
    this.#admitMemory()
    this.#queue.push({ ...task, kind: 'cli' })
    this.#broadcast(this.#metaEvent())
    this.#drainQueue()
  }

  #runTask(task: QueuedCli) {
    if (this.#idleTimer) { clearTimeout(this.#idleTimer); this.#idleTimer = null }
    this.busy = true
    this.#activeTask = task
    this.#broadcast(this.#metaEvent())
    // Match user message boundaries without coupling server scheduling to the UI renderer.
    let afterUserCount = 0, lastWasUser = false, messageId: unknown
    for (const event of this.#events) {
      if (event.type === 'update' && event.update.sessionUpdate === 'user_message_chunk') {
        const id = (event.update as { messageId?: string }).messageId
        if (!lastWasUser || id && id !== messageId) afterUserCount++
        lastWasUser = true
        messageId = id
      } else if (event.type === 'turn_start' || event.type === 'turn_end' || event.type === 'error'
        || event.type === 'permission' || event.type === 'update' && ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'].includes(event.update.sessionUpdate)) lastWasUser = false
    }
    void Promise.resolve().then(() => task.run({ sessionId: this.#sessionId, afterUserCount }))
      .catch((error: unknown) => { if (!this.#disposed) this.#emit({ type: 'error', message: describeError(error) }) })
      .finally(() => {
        this.#activeTask = null
        this.busy = false
        this.#drainQueue()
      })
  }

  /** `/clear`는 앞선 작업을 끊지 않고, 이 큐 지점에서 새 ACP 세션을 연다. */
  clearAfterQueue() {
    if (this.#authRequired || !this.#sessionId) throw new Error('먼저 에이전트에 로그인하세요')
    const memoryResumed = this.#admitMemory()
    if (this.#clearFailed && !this.busy) {
      void this.#clearSession().then(() => this.#drainQueue())
      return
    }
    if (this.busy || this.#queue.length > 0) {
      this.#queue.push({ kind: 'clear', text: '/clear' })
      this.#broadcast(this.#metaEvent())
      if (memoryResumed) this.#drainQueue()
      return
    }
    void this.#clearSession().then(() => this.#drainQueue())
  }

  /** 예약 작업처럼 창 없이 한 턴만 돌리는 경로. 진행 중인 세션에는 쓰지 않는다. */
  runOnce(text: string): Promise<string> {
    if (this.busy) return Promise.reject(new Error('에이전트가 이미 실행 중입니다'))
    const pressure = this.#memoryProblem()
    if (pressure) this.#pauseForMemory(pressure)
    if (this.#memoryPaused) return Promise.reject(new Error('메모리 보호로 작업이 보류되었습니다. 에이전트 탭에서 명시적으로 재개하세요.'))
    return new Promise((resolve, reject) => {
      const detach = this.attach((event) => {
        if (event.type === 'turn_end') {
          detach()
          resolve(event.stopReason)
        } else if (event.type === 'error') {
          detach()
          reject(new Error(event.message))
        }
      })
      try { this.prompt(text) } catch (error) { detach(); reject(error) }
    })
  }

  /** 대기 중인 메시지를 취소한다(진행 중인 턴은 건드리지 않는다) */
  unqueue(index: number) {
    if (index < 0 || index >= this.#queue.length) return
    const [removed] = this.#queue.splice(index, 1)
    if (removed.kind === 'cli') removed.cancel()
    if (this.busy) this.#broadcast(this.#metaEvent())
    else this.#drainQueue()
  }

  /** 원문이 그대로인 대기 메시지를 편집하는 동안 큐 앞에서 실행되지 않게 잠근다. */
  beginQueuedEdit(index: number, expect: string, owner = 'local') {
    if (!Number.isInteger(index) || index < 0 || index >= this.#queue.length) return
    const item = this.#queue[index]
    if (item.kind !== 'prompt' || item.text !== expect) return
    if (item.editOwner && item.editOwner !== owner) return
    item.editOwner = owner
    this.#broadcast(this.#metaEvent())
  }

  /** 대기 중인 메시지의 내용을 저장하고 편집 잠금을 푼다. */
  editQueued(index: number, text: string, expect: string, promptText = text, owner = 'local') {
    if (!Number.isInteger(index)) return
    // 다른 창의 조작으로 자리가 바뀌어도 이 연결이 잠근 원문만 찾는다.
    const actualIndex = this.#queue[index]?.text === expect
      && (!this.#queue[index]?.editOwner || this.#queue[index]?.editOwner === owner)
      ? index
      : this.#queue.findIndex((item) => item.text === expect && item.editOwner === owner)
    if (actualIndex < 0) return
    const item = this.#queue[actualIndex]
    const next = text.trim()
    if (!next) return
    // `/clear`는 다른 작업으로 편집할 수 없는 세션 경계다.
    if (item.kind !== 'prompt') return
    this.#queue[actualIndex] = { kind: 'prompt', text: next, promptText, images: item.images, imageRefs: item.imageRefs, settings: item.settings }
    if (this.busy) this.#broadcast(this.#metaEvent())
    else this.#drainQueue()
  }

  /** 수정을 버리고 원문을 유지한 채 편집 잠금만 푼다. */
  cancelQueuedEdit(index: number, expect: string, owner = 'local') {
    if (!Number.isInteger(index)) return
    const item = this.#queue[index]?.text === expect && this.#queue[index]?.editOwner === owner
      ? this.#queue[index]
      : this.#queue.find((candidate) => candidate.text === expect && candidate.editOwner === owner)
    if (!item) return
    delete item.editOwner
    if (this.busy) this.#broadcast(this.#metaEvent())
    else this.#drainQueue()
  }

  /** 편집하던 창이 끊기면 그 연결의 잠금을 모두 풀어 큐가 영구 정지하지 않게 한다. */
  releaseQueuedEdits(owner: string) {
    let released = false
    for (const item of this.#queue) {
      if (item.editOwner !== owner) continue
      delete item.editOwner
      released = true
    }
    if (!released) return
    if (this.busy) this.#broadcast(this.#metaEvent())
    else this.#drainQueue()
  }

  /** 대기 중인 메시지의 자리를 옮긴다 — 창의 드래그 재정렬(진행 중인 턴은 건드리지 않는다) */
  moveQueued(from: number, to: number) {
    // WS로 오는 값이라 정수인지도 본다 — NaN은 모든 범위 비교를 통과해 splice가 엉뚱한 항목을 옮긴다
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return
    if (from < 0 || from >= this.#queue.length || to < 0 || to >= this.#queue.length) return
    const [moved] = this.#queue.splice(from, 1)
    this.#queue.splice(to, 0, moved)
    if (this.busy) this.#broadcast(this.#metaEvent())
    else this.#drainQueue()
  }

  #run(text: string, promptText = text, images: AgentImage[] = [], imageRefs: AgentImageRef[] = [], settings?: AgentMessageSettings) {
    let context: string
    try { context = agentContextText(this.#context, this.cwd) }
    catch (error) {
      this.#emit({ type: 'error', message: describeError(error) })
      // Keep queued work available for editing/retry; do not silently discard CLI tasks.
      this.#broadcast(this.#metaEvent())
      this.#armIdleTimer()
      return
    }
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    this.busy = true
    this.#turns += 1
    const turnStartedAt = Date.now()
    // 사용자 발화도 이벤트 버퍼에 남긴다 — 재접속한 창이 대화를 그대로 복원하려면 여기 있어야 한다
    this.#emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } }, ...(settings ? { settings } : {}) })
    // 사진은 파일 참조 텍스트와 분리해 전사에 남긴다. 그래야 대화 복원 뒤에도 사진 버블을 다시 그릴 수 있다.
    if (imageRefs.length > 0) this.#emit({ type: 'user_images', images: imageRefs })
    // startedAt·durationMs는 이벤트에 새겨 나간다 — 되받은 히스토리에서도 턴 걸린 시간을 그대로 본다
    this.#emit({ type: 'turn_start', startedAt: turnStartedAt })
    this.#broadcast(this.#metaEvent())
    const prompt: ContentBlock[] = [
      { type: 'text', text: promptText },
      ...(context ? [{ type: 'text' as const, text: context }] : []),
      ...images.map((image) => ({ type: 'image' as const, data: image.data, mimeType: image.mimeType })),
    ]
    this.#conn
      .prompt({ sessionId: this.#sessionId, prompt })
      .then((res) => this.#emit({ type: 'turn_end', stopReason: res.stopReason, durationMs: Date.now() - turnStartedAt }))
      .catch((err: unknown) => {
        const accessIssue = accessIssueFromError(err)
        if (accessIssue) {
          this.#accessIssue = accessIssue
          this.#emit({ type: 'error', message: describeError(err), accessIssue })
          this.#emit({ type: 'turn_end', stopReason: 'error', durationMs: Date.now() - turnStartedAt })
          return
        }
        if (isAuthRequiredError(err) && this.#authMethods.length > 0) {
          this.#emit({ type: 'turn_end', stopReason: 'error', durationMs: Date.now() - turnStartedAt })
          this.#enterAuth(err)
          return
        }
        // ACP 오류는 JSON-RPC 오류 객체(plain object)로도 온다 — String()하면 "[object Object]"만 남는다
        this.#emit({ type: 'error', message: describeError(err) })
        this.#emit({ type: 'turn_end', stopReason: 'error', durationMs: Date.now() - turnStartedAt })
      })
      .finally(() => {
        this.busy = false
        if (this.#authRequired) {
          this.#armIdleTimer()
          return
        }
        this.#drainQueue()
      })
  }

  /** 큐의 다음 항목 하나만 시작한다. clear 뒤의 프롬프트는 새 세션에서 시작한다. */
  #drainQueue() {
    if (this.#disposed || this.busy || this.#clearFailed) return
    if (this.#accessIssue || this.#memoryPaused) {
      this.#broadcast(this.#metaEvent())
      this.#armIdleTimer()
      return
    }
    const next = this.#queue[0]
    if (next === undefined) {
      void this.#pushMeta()
      this.#armIdleTimer()
      return
    }
    const pressure = this.#memoryProblem()
    if (pressure) { this.#pauseForMemory(pressure); return }
    // 편집 중에는 앞 항목도 실행하지 않는다. 큐 인덱스를 그대로 지켜 완료가 다른 메시지를
    // 덮어쓰는 경합을 막고, 완료·취소 뒤 원래 순서에서 다시 시작한다.
    if (this.#queue.some((item) => item.editOwner)) {
      this.#broadcast(this.#metaEvent())
      return
    }
    this.#queue.shift()
    if (next.kind === 'clear') {
      void this.#clearSession().then(() => this.#drainQueue())
      return
    }
    if (next.kind === 'cli') {
      this.#runTask(next)
      return
    }
    this.#run(next.text, next.promptText, next.images, next.imageRefs, next.settings)
  }

  /** Codex는 큐 경계에서 프로세스를 교체해 이전 thread writer를 반납한다. */
  async #clearSession() {
    this.busy = true
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    this.#broadcast(this.#metaEvent())
    try {
      if (this.runtime === 'codex') {
        this.#restarting = true
        this.#loadingEvents = []
        await this.#stopTransport()
        if (this.#disposed) return
        this.#spawn()
        await this.#initializeWithTimeout(false)
      }
      if (this.#disposed) return
      const created = await this.#conn.newSession({ cwd: this.cwd, mcpServers: [] })
      if (this.#disposed) return
      this.#loadingEvents = null
      this.#clearFailed = false
      this.#events = []
      this.#turns = 0
      this.#startedAt = new Date().toISOString()
      this.#broadcast({ type: 'reset' })
      this.#adopt(created.sessionId, created.models ?? null, created.modes ?? null, created.configOptions)
      await this.#applyDefaults()
    } catch (err) {
      // 경계를 넘지 못한 뒤 메시지를 이전 대화에서 실행하지 않는다. /clear로 재시도한다.
      this.#clearFailed = true
      if (this.#restarting) {
        // 실패한 새 어댑터의 늦은 exit가 탭과 보존한 큐까지 닫지 않도록 여기서 정리한다.
        await this.#stopTransport().catch(() => {})
      }
      this.#loadingEvents = null
      this.#emit({ type: 'error', message: `${describeError(err)}\n새 대화 전환을 완료하지 못했습니다. /clear로 다시 시도하세요.` })
    } finally {
      this.#loadingEvents = null
      this.#restarting = false
      this.busy = false
      await this.#pushMeta()
      this.#armIdleTimer()
    }
  }

  /** 지난 세션을 불러온다 — 에이전트가 히스토리를 session/update로 다시 흘려준다(`/resume`) */
  async loadSession(sessionId: string) {
    // 같은 ACP 연결에서 prompt와 session/load를 겹치면 Codex는 동일 thread의 두 writer로 보고
    // 거절할 수 있다. 현재 턴을 보존하고 사용자가 끝난 뒤 다시 고르게 한다.
    this.assertCanLoadSession()
    const previousModels = this.#models
    const previousModes = this.#modes
    const previousThinking = this.#thinking
    this.#loadingEvents = []
    let loaded: Awaited<ReturnType<ClientSideConnection['loadSession']>>
    let replay: AgentEvent[]
    try {
      loaded = await this.#conn.loadSession({ sessionId, cwd: this.cwd, mcpServers: [] })
      replay = reconcileAgentTranscript(readAgentTranscript(this.runtime, this.cwd, sessionId), this.#loadingEvents)
    } catch (err) {
      // 일부 어댑터는 실패하기 전 update를 몇 개 흘리거나 모드를 바꾼다. 어느 쪽도 현재 세션에 남기지 않는다.
      this.#models = previousModels
      this.#modes = previousModes
      this.#thinking = previousThinking
      throw err
    } finally {
      this.#loadingEvents = null
    }

    // ACP가 실제 기록을 확인한 뒤에만 이 탭의 기준 세션을 바꾼다. 실패한 ID를 먼저 저장하면 다음
    // 프롬프트까지 `session not found`로 이어지고 브라우저 복원 포인터에도 유령 ID가 남는다.
    this.#resetConversation()
    this.#adopt(sessionId, null, null, loaded.configOptions)
    await this.#pushMeta()
    for (const event of replay) this.#emit(event, false)
    const models = loaded.models ?? null
    if (models) this.#useModels(models)
    if (loaded.modes) {
      this.#modes = loaded.modes
      this.#emit({ type: 'modes', modes: loaded.modes })
    }
    await this.#applyDefaults()
    await this.#pushMeta()
    writeAgentTranscript(this.runtime, this.cwd, sessionId, this.#events)
  }

  /** 이 프로젝트 폴더에서 돌았던 세션 목록 */
  async listSessions(): Promise<SessionInfo[]> {
    // claude는 디스크를 직접 훑는다 — 어댑터 호출은 세션 파일을 통째로 읽어(1초+) 탭 수만큼 곱해진다
    // (server/agentSessionList.ts). 기록 형식을 아는 런타임에서만 쓰는 지름길이다
    if (this.runtime === 'claude') return listSessionsFromDisk(this.cwd)
    // Codex가 세션을 남길 당시의 cwd 표기와 현재 실제 경로의 대소문자가 달라도 같은 작업 폴더다.
    // cwd를 비우면 Codex ACP가 전체 목록을 돌려주므로 여기서만 대소문자 무시로 가른다.
    if (this.runtime === 'codex') {
      const res = await this.#conn.unstable_listSessions({})
      return res.sessions.filter((session) => session.cwd.toLocaleLowerCase() === this.cwd.toLocaleLowerCase())
    }
    const res = await this.#conn.unstable_listSessions({ cwd: this.cwd })
    return res.sessions
  }

  #resetConversation() {
    // session/load는 유휴 세션을 전환하는 정상 경로다. 여기서 무조건 ACP cancel을 보내면
    // 일부 어댑터가 방금 불러온 대화까지 "사용자 인터럽트"로 기록한다. 실제로 돌고 있거나
    // 승인/대기열이 있을 때만 먼저 정리한다.
    if (this.busy || this.#pending.size > 0 || this.#queue.length > 0) this.cancel()
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
    if (this.#models) this.#useModels({ ...this.#models, currentModelId: modelId })
  }

  async setThinking(configId: string, value: string) {
    const result = await this.#conn.setSessionConfigOption({ sessionId: this.#sessionId, configId, value })
    this.#useThinking(thinkingFrom(result.configOptions) ?? (this.#thinking?.configId === configId ? { ...this.#thinking, currentValue: value } : null))
  }

  /** 모델 상태를 갈아끼운다 — 창에 흘리는 김에 런타임별 후보 목록도 같이 채운다 */
  #useModels(models: SessionModelState) {
    this.#models = models
    knownModels.set(
      this.runtime,
      models.availableModels.map(({ modelId, name }) => ({ modelId, name })),
    )
    this.#emit({ type: 'models', models })
  }

  #useThinking(thinking: ThinkingState | null) {
    if (thinking === null && this.#thinking === null) return
    this.#thinking = thinking
    this.#emit({ type: 'thinking', thinking })
  }

  #memoryProblem(resuming = false): string | null {
    try { return memoryPressure(this.#readMemory(), resuming) }
    catch { return '메모리 상태를 확인하지 못해 작업을 보류합니다' }
  }

  /** Polling and queue admission share this path; no automatic replay after recovery. */
  checkMemory() {
    if (this.#disposed || this.#memoryPaused || !this.busy && this.#queue.length === 0) return
    const pressure = this.#memoryProblem()
    if (pressure) this.#pauseForMemory(pressure)
  }

  #pauseForMemory(reason: string) {
    if (this.#memoryPaused) return
    this.#memoryPaused = true
    const message = `${reason}. 진행 작업 중단을 요청하고 대기열을 보류했습니다. 메모리 회복 후 새 메시지나 명령을 보내면 대기열부터 재개합니다. 중단된 작업은 자동 재실행하지 않습니다.`
    console.error(`[mew:agent-memory] ${new Date().toISOString()} runtime=${this.runtime} ${message}`)
    this.#emit({ type: 'error', message })
    if (this.#sessionId) writeAgentTranscript(this.runtime, this.cwd, this.#sessionId, this.#events)
    if (this.busy) this.#cancelActive()
    this.#broadcast(this.#metaEvent())
  }

  #admitMemory(): boolean {
    const pressure = this.#memoryProblem(this.#memoryPaused)
    if (pressure) {
      this.#pauseForMemory(pressure)
      throw new Error(`${pressure}. 작업을 보낼 수 없습니다. 메모리 회복 후 다시 시도하세요.`)
    }
    if (this.#memoryPaused && this.busy) throw new Error('메모리 보호로 작업을 중단하는 중입니다. 중단 완료 후 다시 시도하세요.')
    const resumed = this.#memoryPaused
    this.#memoryPaused = false
    return resumed
  }

  /** Cancel only active work; memory protection preserves the waiting queue. */
  #cancelActive() {
    for (const [id, resolve] of this.#pending) {
      resolve({ outcome: { outcome: 'cancelled' } })
      this.#emit({ type: 'permission_done', id })
    }
    this.#pending.clear()
    if (this.#activeTask) this.#activeTask.cancel()
    else if (this.#sessionId) void this.#conn.cancel({ sessionId: this.#sessionId }).catch(() => {})
  }

  /** 승인 대기 중인 요청은 취소 결과로 닫는다 — 스펙 요구사항(cancel 시 outcome: cancelled) */
  cancel() {
    // 줄 서 있던 메시지도 같이 버린다 — 중단해 놓고 다음 것이 저절로 도는 건 놀라운 동작이다
    for (const item of this.#queue) if (item.kind === 'cli') item.cancel()
    this.#queue = []
    this.#cancelActive()
    this.#broadcast(this.#metaEvent())
  }

  answerPermission(id: string, optionId: string | null) {
    const resolve = this.#pending.get(id)
    if (!resolve) return
    this.#pending.delete(id)
    resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
    this.#emit({ type: 'permission_done', id })
  }

  #emit(event: AgentEvent, persist = true) {
    if (this.#loadingEvents) {
      this.#loadingEvents.push(event)
      return
    }
    this.#events.push(event)
    // ACP 히스토리는 turn_end를 재생하지 않아 감독의 유휴 종료 뒤에는 소요 시간이 사라진다.
    // 턴이 끝나는 순간의 전사만 남기면 스트리밍 중 디스크 쓰기는 피하면서 완료 상태를 복원할 수 있다.
    if (persist && event.type === 'turn_end') writeAgentTranscript(this.runtime, this.cwd, this.#sessionId, this.#events)
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
        queued: this.#queue.map((item) => item.text),
        queuedKinds: this.#queue.map((item) => item.kind),
        activeTask: this.#activeTask ? 'cli' : null,
        accessIssue: this.#accessIssue,
        memoryPaused: this.#memoryPaused,
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
    console.error(`[mew:agent:${this.runtime}] ${new Date().toISOString()} ${message}`)
    this.#emit({ type: 'error', message })
    if (this.#sessionId) writeAgentTranscript(this.runtime, this.cwd, this.#sessionId, this.#events)
    this.dispose()
  }

  /** SDK가 stdio EOF를 initialize 실패로 풀어 주지 않아도 자식 종료 즉시 start()를 깨운다. */
  #failStartup(message: string) {
    const reject = this.#rejectStartup
    this.#rejectStartup = null
    reject?.(new Error(message))
    if (!this.#restarting) this.#fail(message)
  }

  #armIdleTimer() {
    // 프론트가 끊긴 것은 작업 중단 신호가 아니다. 진행 중인 턴·로그인은 끝까지 둔 뒤,
    // 완전히 놀기 시작한 시점부터 30분을 새로 센다.
    if (
      this.#listeners.size > 0 ||
      this.busy ||
      this.#queue.length > 0 ||
      this.#authenticating ||
      this.#pendingElicitations.size > 0 ||
      this.#idleTimer ||
      this.#disposed
    ) return
    this.#idleTimer = setTimeout(() => {
      sessions.delete(this.key)
      this.dispose()
    }, this.#idleKillMs)
    this.#idleTimer.unref?.()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    clearInterval(this.#memoryTimer)
    for (const item of this.#queue) if (item.kind === 'cli') item.cancel()
    this.#queue = []
    this.#activeTask?.cancel()
    this.#cancelStderrAuth?.(new Error('로그인 세션이 종료됐습니다'))
    live.delete(this)
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    for (const resolve of this.#pending.values()) resolve({ outcome: { outcome: 'cancelled' } })
    this.#pending.clear()
    for (const resolve of this.#pendingElicitations.values()) resolve({ action: 'cancel' })
    this.#pendingElicitations.clear()
    this.#authUrls.clear()
    this.#listeners.clear()
    this.#killTree()
    for (const listener of this.#disposeListeners) listener()
    this.#disposeListeners.clear()
  }

  /** writer 소유권을 다음 어댑터에 넘기기 전에 자식 프로세스가 실제로 끝날 때까지 기다린다. */
  async disposeAndWait() {
    const child = this.#child
    if (child.exitCode !== null || child.signalCode !== null) {
      this.dispose()
      return
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    this.dispose()
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ])
    if (stopped) return
    this.#killTree('SIGKILL')
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 500))])
  }

  /** 어댑터가 먼저 끝나도 손자 Codex의 writer가 남을 수 있어 그룹 전체를 기다린다. */
  async #stopTransport() {
    const pid = this.#child.pid
    if (pid === undefined) return
    const running = () => {
      try { process.kill(-pid, 0); return true } catch { return false }
    }
    const waitUntilStopped = async (milliseconds: number) => {
      const deadline = Date.now() + milliseconds
      while (running() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
      return !running()
    }
    this.#killTree()
    if (await waitUntilStopped(2_000)) return
    this.#killTree('SIGKILL')
    if (!await waitUntilStopped(500)) throw new Error('이전 Codex 프로세스가 아직 종료되지 않았습니다. /clear로 다시 시도하세요.')
  }

  /** 어댑터가 밑에 둔 CLI까지 같이 보낸다 — 그룹 리더로 띄웠으므로 음수 pid가 그룹 전체다.
   *  프로세스 종료 경로(process.on('exit'))에서도 불리므로 동기여야 한다 */
  #killTree(signal: NodeJS.Signals = 'SIGTERM') {
    killMemoryScope(this.#memoryScope, signal)
    const pid = this.#child.pid
    if (pid === undefined) return
    try {
      process.kill(-pid, signal)
    } catch {
      this.#child.kill(signal)
    }
  }
}

// 창의 **탭 하나가 세션 하나**다 — 같은 런타임이어도 탭이 다르면 다른 대화·다른 자식 프로세스다.
// 스코프는 여전히 워크스페이스라 프로젝트별로는 나누지 않는다.
const sessions = new Map<string, Promise<AgentSession>>()

const keyOf = (runtime: string, tab: string) => `${runtime} ${tab}`

/** 창을 닫았다 다시 열어도 탭마다 같은 대화가 이어진다(작업 완료 뒤 AGENT_IDLE_MS까지) */
export function sessionFor(runtime: string, tab: string): Promise<AgentSession> {
  const key = keyOf(runtime, tab)
  const existing = sessions.get(key)
  if (existing) return existing
  const started = AgentSession.start(runtime)
    .then((session) => {
      session.key = key
      return session
    })
    .catch((err: unknown) => {
      sessions.delete(key)
      throw err
    })
  sessions.set(key, started)
  return started
}

/** 로그인 화면이 광고받은 terminal 방법의 실제 고정 실행 spec을 얻는다. */
export async function terminalAuthFor(runtime: string, tab: string, methodId: string): Promise<TerminalAuthSpec> {
  return (await sessionFor(runtime, tab)).terminalAuthSpec(methodId)
}

/** 모델 목록만 보려고 도는 임시 세션 — 같은 런타임을 두 번 띄우지 않게 붙잡는다 */
const probing = new Map<string, Promise<ModelInfo[]>>()

/** 목록을 물어본 뒤 이만큼 지나면 포기한다(그 런타임이 뜨지 않는 것으로 본다) */
const PROBE_TIMEOUT_MS = 20_000

/**
 * 그 런타임이 어떤 모델을 지원하는지 알아본다. 이미 아는 런타임이면 프로세스를 띄우지 않는다.
 * 모르면 세션을 하나 띄웠다 **바로 접는다** — ACP는 세션이 떠야 모델을 알려 주므로 목록만 보는
 * 길이 따로 없다(spawn + handshake라 1~2초 걸린다. 셋 편집 창이 열릴 때만 부른다).
 */
export function probeModels(runtime: string, spec?: SpawnSpec): Promise<ModelInfo[]> {
  const known = knownModels.get(runtime)
  if (known) return Promise.resolve(known)
  const running = probing.get(runtime)
  if (running) return running
  const started = AgentSession.start(runtime, spec ?? resolvedSpec(runtime) ?? undefined).then((session) => {
    // 핸드셰이크의 #useModels가 이미 담았다 — 세션 자체는 쓸 데가 없다
    session.dispose()
    return knownModels.get(runtime) ?? []
  })
  // 실행 파일이 없거나(사용자가 깔아 둔 hermes) ACP를 말하지 않으면 핸드셰이크가 끝나지 않는다 —
  // 창을 무한정 세워 두지 않는다. 늦게 뜨더라도 위의 then이 그때 접으므로 프로세스는 남지 않는다
  const probe = Promise.race([
    started,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('에이전트가 응답하지 않습니다')), PROBE_TIMEOUT_MS)
      timer.unref?.()
    }),
  ]).finally(() => probing.delete(runtime))
  probing.set(runtime, probe)
  return probe
}

/** 탭을 닫았다 — 유휴 타이머를 기다리지 않고 지금 접는다 */
export function disposeSession(runtime: string, tab: string) {
  const key = keyOf(runtime, tab)
  const pending = sessions.get(key)
  if (!pending) return
  sessions.delete(key)
  void pending.then((session) => session.dispose()).catch(() => {})
}

/** 워크스페이스가 바뀌면 전부 접는다 — 세션의 cwd는 뜰 때 정해지므로 옛 폴더에 매여 있다.
 *  아직 핸드셰이크 중이라 sessions에 Promise로만 있는 것도 live로 잡히므로 같이 죽는다. */
export function disposeAllSessions() {
  sessions.clear()
  for (const session of [...live]) session.dispose()
}

// 서버가 정상 종료하면 자식도 데려간다. SIGINT/SIGTERM은 serve.ts가 잡아 여기로 온다(vite dev는
// vite가 잡아 process.exit을 부르므로 이 훅으로 들어온다).
const EXIT_HANDLER_KEY = Symbol.for('mew.agentAcp.exitHandler')
const previousExitHandler = (globalThis as Record<symbol, (() => void) | undefined>)[EXIT_HANDLER_KEY]
if (previousExitHandler) process.off('exit', previousExitHandler)
const exitHandler = () => disposeAllSessions()
;(globalThis as Record<symbol, (() => void) | undefined>)[EXIT_HANDLER_KEY] = exitHandler
process.on('exit', exitHandler)

/** 그 pid가 지금 떠 있는지. EPERM은 남의 프로세스라 못 건드리는 것 = 살아 있다 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 그 프로세스에 박힌 주인 pid(= 띄운 mew 서버). 표식이 없거나 /proc이 없으면 null */
function ownerOf(pid: number): number | null {
  try {
    const entry = fs
      .readFileSync(`/proc/${pid}/environ`, 'utf8')
      .split('\0')
      .find((line) => line.startsWith(`${OWNER_ENV}=`))
    return entry ? Number(entry.slice(OWNER_ENV.length + 1)) || null : null
  } catch {
    return null // /proc이 없거나(맥) 읽을 수 없다
  }
}

/**
 * 서버가 SIGKILL로 죽으면 위의 어느 것도 돌지 못해 어댑터와 그 밑 CLI가 통째로 남는다 —
 * 2026-08-10에 6일치 고아 28개가 3.4GB를 물고 있었다. 뜰 때 한 번 걷어낸다.
 *
 * 고아 판정은 **주인 표식**으로 한다(MEW_AGENT_OWNER = AgentSession 소유 프로세스 pid): 그 pid가
 * 죽어 있으면 지난 실행이 남긴 것이고, 살아 있으면 독립 감독이나 지금 mew가 소유하므로 건드리지 않는다.
 * PPID 1로 보지 않는 이유 — WSL은 부모를 잃은 프로세스를 PID 1이 아니라 중간의 `/init` 릴레이가
 * 거둬 가서 영영 안 잡힌다. /proc이 없는 환경을 위해 옛 PPID 1 규칙은 보조로 남긴다.
 *
 * 그룹(-pid)으로 보내지 않는다: 이 변경 전에 뜬 고아는 그룹 리더가 아니라서, 그 그룹에
 * 지금 이 서버가 들어 있을 수도 있다. 스냅샷에서 자손을 직접 훑어 하나씩 보낸다.
 */
export function reapOrphanAgents() {
  const targets = Object.values(RUNTIMES).flatMap((runtime) => runtime.spec ? [runtime.spec().cmd] : [])
  let snapshot: string
  try {
    snapshot = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
  } catch {
    return // ps가 없는 환경 — 청소는 있으면 좋은 것이지 서버가 뜨는 조건은 아니다
  }
  const rows = snapshot
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }))

  const doomed = new Set<number>()
  const collect = (pid: number) => {
    if (doomed.has(pid)) return
    doomed.add(pid)
    for (const row of rows) if (row.ppid === pid) collect(row.pid)
  }
  for (const row of rows) {
    if (row.pid === process.pid) continue
    const owner = ownerOf(row.pid)
    // 표식이 있으면 그것만 본다 — 어댑터든 그 밑 CLI든 주인이 죽었으면 남은 것이다
    if (owner !== null) {
      if (!pidAlive(owner)) collect(row.pid)
      continue
    }
    if (row.ppid === 1 && targets.some((target) => row.args.includes(target))) collect(row.pid)
  }
  if (doomed.size === 0) return
  for (const pid of doomed) {
    try {
      process.kill(pid)
    } catch {
      /* 이미 죽었다 */
    }
  }
  console.log(`[mew:agent] 부모 잃은 에이전트 프로세스 ${doomed.size}개를 정리했습니다`)
}
