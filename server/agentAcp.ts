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
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type Client,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionInfo,
  type SessionModelState,
  type SessionModeState,
  type SessionNotification,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import { WORKSPACE_ROOT } from './paths.ts'
import { UsageReader, type Usage } from './agentUsage.ts'
import { listSessionsFromDisk, stripLocalCommandMeta } from './agentSessionList.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 기본 백엔드 — 버전 고정된 로컬 설치본. `npx @latest`로 띄우지 않는다(ADR 0034) */
const DEFAULT_AGENT_CMD = path.resolve(here, '../node_modules/.bin/claude-code-acp')

/** 에이전트와 그 자손에 심는 주인 표식 — 값은 띄운 mew 서버의 pid다(reapOrphanAgents가 읽는다) */
const OWNER_ENV = 'MEW_AGENT_OWNER'

/**
 * 새 세션은 그 런타임에서 **가장 많이 열린 모드**로 시작한다 — 에이전트 창은 터미널과 같은 게이트를
 * 쓰는 owner/manager 전용 도구이고, 승인 프롬프트는 그 사람이 이미 가진 권한을 다시 묻는 것뿐이다
 * (ADR 0037). 한 가지 값으로 못 박지 않는 이유는 런타임마다 이름이 다르기 때문이다:
 * claude는 `bypassPermissions`, codex는 `full-access`, hermes는 `dont_ask`가 그 자리다
 * (claude에도 `dontAsk`가 있지만 그쪽은 "미리 승인 안 된 건 거절"이라 뜻이 반대다 — 순서로 갈린다).
 * 앞에서부터 그 세션이 광고한 것 중 처음 맞는 것을 고른다. 되돌리려면 `MEW_AGENT_MODE=default`처럼
 * 모드 id를 박아 준다(그 하나만 시도한다).
 */
const MODE_OVERRIDE = process.env.MEW_AGENT_MODE || null
const FULL_ACCESS_MODES = ['bypassPermissions', 'full-access', 'full_access', 'fullAccess', 'yolo', 'dont_ask', 'dontAsk']

/** 재접속(모바일 화면 꺼짐 등) 때 되돌려 줄 이벤트 개수 상한 */
const MAX_BUFFERED_EVENTS = 500

/** 붙어 있는 창이 하나도 없는 채로 이만큼 지나면 에이전트를 죽인다 */
const IDLE_KILL_MS = 10 * 60_000

/** 어댑터를 띄운 뒤 ACP 핸드셰이크가 이만큼 걸리면 포기한다 — 정상이면 몇 초다 */
const HANDSHAKE_TIMEOUT_MS = 30_000

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

/** Codex — 버전 고정된 로컬 어댑터(@zed-industries/codex-acp). codex CLI를 따로 띄우지 않고
 *  어댑터가 곧 에이전트다 — 자격증명은 사용자의 ~/.codex를 그대로 쓴다. */
function codexSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_CODEX_CMD || path.resolve(here, '../node_modules/.bin/codex-acp')
  const raw = process.env.MEW_AGENT_CODEX_ARGS
  return { cmd, args: raw === undefined ? [] : raw.split(' ').filter(Boolean) }
}

/** 창에서 고를 수 있는 에이전트 런타임. 여기 없는 id는 서버가 거부한다 */
export const RUNTIMES: Record<string, { label: string; spec: () => SpawnSpec }> = {
  claude: { label: 'Claude Code', spec: claudeSpawnSpec },
  codex: { label: 'Codex', spec: codexSpawnSpec },
  hermes: { label: 'Hermes', spec: hermesSpawnSpec },
}

export const DEFAULT_RUNTIME = 'claude'

export function isRuntime(id: string): boolean {
  return Object.hasOwn(RUNTIMES, id)
}

export interface ModelInfo {
  modelId: string
  name: string
}

/**
 * 런타임별로 마지막에 본 모델 목록 — 셋 편집 창의 모델 검색이 이걸 쓴다.
 * ACP는 세션이 떠야 모델을 알려 주므로, 창(agentWs)·셋 러너·probeModels 중 **무엇으로 떴든**
 * 여기 한 곳에 모인다. ponytail: 메모리에만 산다 — 재시작하면 다시 빈다.
 */
const knownModels = new Map<string, ModelInfo[]>()

export const modelsByRuntime = (): Record<string, ModelInfo[]> => Object.fromEntries(knownModels)

/** 떠 있는 세션 전부. sessions 맵과 달리 Promise가 아니다 — 나가는 길(process 'exit')에서는
 *  then이 돌 기회가 없어서, 동기적으로 죽일 수 있는 목록이 따로 있어야 한다 */
const live = new Set<AgentSession>()

export class AgentSession {
  /** 어떤 백엔드로 떠 있는지(RUNTIMES의 키) — 창의 아이콘이 이것을 그린다 */
  readonly runtime: string
  /** sessions 맵에서 자기를 지우기 위한 열쇠 — sessionFor가 심는다(테스트가 직접 띄운 세션은 빈 값) */
  key = ''
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
    // 주인 표식은 자손까지 그대로 상속된다 — 서버가 SIGKILL로 죽어도 다음 실행이 이걸 보고 걷어낸다
    env[OWNER_ENV] = String(process.pid)
    // CLAUDECODE가 켜져 있으면 Claude Code가 "중첩 세션"으로 보고 실행을 거부한다. mew 서버를 Claude Code
    // 터미널에서 띄우면 이 변수가 그대로 상속돼 에이전트 창이 통째로 죽는다 — 여기 세션은 중첩이 아니라
    // 별개 프로세스이므로 떼고 넘긴다.
    delete env.CLAUDECODE
    // detached — 어댑터를 프로세스 그룹 리더로 띄운다. 어댑터는 세션마다 CLI를 하나씩 밑에 두는데,
    // 어댑터만 죽이면 그 손자들이 고아로 남는다(#killTree가 그룹째 보낼 수 있어야 한다).
    this.#child = spawn(spec.cmd, spec.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      detached: true,
    })
    live.add(this)
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
      // 핸드셰이크에 시한을 둔다 — 어댑터가 떴는데 ACP를 말하지 않으면(잘못 깔린 실행 파일, 로그인
      // 안 된 CLI) initialize의 응답이 영영 오지 않는다. 시한이 없으면 그 자리에서 기다리는 쪽이
      // 통째로 멎는다: 창은 "에이전트 준비 중"에서, 셋은 작업이 running인 채로 굳는다
      await Promise.race([
        session.#handshake(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('에이전트가 응답하지 않습니다 (핸드셰이크 시간 초과)')),
            HANDSHAKE_TIMEOUT_MS,
          )
          timer.unref?.()
        }),
      ])
    } catch (err) {
      session.dispose()
      throw err
    }
    return session
  }

  /** 이 세션이 이미 접혔는지 — 죽은 세션에 매달린 작업을 닫는 쪽(agentSetRunner)이 본다 */
  get disposed(): boolean {
    return this.#disposed
  }

  async #handshake() {
    // capability를 하나도 광고하지 않는다 — 어댑터가 CLI 기본 도구(Read/Write/Edit/Bash)를 그대로 쓴다.
    // fs를 켜면 그 도구들이 꺼지고 mcp__acp__* 로 갈리는데, 그러면 CLI에서 만든 대화를 창에서 불러올 때
    // 전사 속 `Edit` 참조를 API가 거부한다("Tool reference 'Edit' not found"). 도구 이름을 CLI와
    // 맞춰 두는 쪽을 택했다 — 경로 스코프를 잃는 대신 대화가 양쪽에서 이어진다(ADR 0044).
    const init = await this.#conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
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
    if (models) this.#useModels(models)
    if (modes) {
      this.#modes = modes
      this.#emit({ type: 'modes', modes })
    }
  }

  /**
   * 세션은 대개 제한 모드로 시작한다(claude `default`·codex `auto`). 원하는 모드는 세션을 새로 잡을
   * 때마다 다시 걸어 줘야 한다 — 그 런타임이 그런 모드를 아예 광고하지 않으면(root로 도는 claude에는
   * bypass가 없다) 그냥 넘어간다. 실패해도 세션은 살린다: 모드 하나 때문에 창이 안 뜨면 안 된다.
   */
  async #applyDefaultMode() {
    const modes = this.#modes
    if (!modes) return
    const wanted = MODE_OVERRIDE ? [MODE_OVERRIDE] : FULL_ACCESS_MODES
    const pick = wanted.find((id) => modes.availableModes.some((mode) => mode.id === id))
    if (!pick || pick === modes.currentModeId) return
    await this.setMode(pick).catch((err: unknown) => {
      console.error(`[mew:agent:${this.runtime}] 권한 모드 ${pick} 적용 실패:`, err)
    })
  }

  #client(): Client {
    return {
      sessionUpdate: async (params: SessionNotification) => {
        // 에이전트가 스스로 모드를 바꾸기도 한다(계획 모드 종료 등) — 창의 선택기가 따라가야 한다
        if (params.update.sessionUpdate === 'current_mode_update' && this.#modes) {
          this.#modes = { ...this.#modes, currentModeId: params.update.currentModeId }
          this.#emit({ type: 'modes', modes: this.#modes })
        }
        // 불러온 히스토리의 사용자 발화에는 CLI 메타가 섞여 온다(어댑터가 기록을 그대로 되재생한다).
        // 창에서 방금 친 프롬프트는 #run이 직접 넣으므로 이 길로 오지 않는다 — 여기 필터는 히스토리만 탄다.
        if (params.update.sessionUpdate === 'user_message_chunk') {
          const content = params.update.content
          if (!Array.isArray(content) && content?.type === 'text') {
            const text = stripLocalCommandMeta(content.text)
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
      // fs capability를 광고하지 않으므로 readTextFile·writeTextFile은 구현하지 않는다 — 파일은
      // CLI가 자기 Read/Write/Edit로 직접 다룬다(ADR 0044).
    }
  }

  /**
   * 지금까지 쌓인 대화 이벤트 — 재접속한 창이 **한 덩어리로**(`replay`) 받아 통째로 갈아끼운다.
   * 예전에는 attach가 이걸 한 개씩 흘려보냈는데, 창은 이벤트마다 다시 그리느라 500개짜리 되감기에서
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

  /** 대기 중인 메시지의 내용을 고친다 — 창의 더블클릭 편집(진행 중인 턴은 건드리지 않는다) */
  editQueued(index: number, text: string, expect: string) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#queue.length) return
    // 고치는 사이 앞 턴이 끝나 큐가 당겨졌으면 같은 번호가 다른 메시지를 가리킨다 — 원본이 그대로일 때만 덮어쓴다
    if (this.#queue[index] !== expect) return
    const next = text.trim()
    if (!next) return
    this.#queue[index] = next
    this.#broadcast(this.#metaEvent())
  }

  /** 대기 중인 메시지의 자리를 옮긴다 — 창의 드래그 재정렬(진행 중인 턴은 건드리지 않는다) */
  moveQueued(from: number, to: number) {
    // WS로 오는 값이라 정수인지도 본다 — NaN은 모든 범위 비교를 통과해 splice가 엉뚱한 항목을 옮긴다
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return
    if (from < 0 || from >= this.#queue.length || to < 0 || to >= this.#queue.length) return
    const [moved] = this.#queue.splice(from, 1)
    this.#queue.splice(to, 0, moved)
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

  /** 지난 세션을 불러온다 — 에이전트가 히스토리를 session/update로 다시 흘려준다(`/resume`) */
  async loadSession(sessionId: string) {
    this.#resetConversation()
    this.#adopt(sessionId, null, null)
    await this.#pushMeta() // 세션 전환을 즉시 클라이언트에 반영 — ACP 히스토리 재생 전
    const loaded = await this.#conn.loadSession({ sessionId, cwd: this.cwd, mcpServers: [] })
    if (loaded.models) this.#useModels(loaded.models)
    if (loaded.modes) {
      this.#modes = loaded.modes
      this.#emit({ type: 'modes', modes: loaded.modes })
    }
    await this.#applyDefaultMode()
    await this.#pushMeta()
  }

  /** 이 프로젝트 폴더에서 돌았던 세션 목록 */
  async listSessions(): Promise<SessionInfo[]> {
    // claude는 디스크를 직접 훑는다 — 어댑터 호출은 세션 파일을 통째로 읽어(1초+) 탭 수만큼 곱해진다
    // (server/agentSessionList.ts). 기록 형식을 아는 런타임에서만 쓰는 지름길이다
    if (this.runtime === 'claude') return listSessionsFromDisk(this.cwd)
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
    if (this.#models) this.#useModels({ ...this.#models, currentModelId: modelId })
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
      sessions.delete(this.key)
      this.dispose()
    }, IDLE_KILL_MS)
    this.#idleTimer.unref?.()
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    live.delete(this)
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    for (const resolve of this.#pending.values()) resolve({ outcome: { outcome: 'cancelled' } })
    this.#pending.clear()
    this.#listeners.clear()
    this.#killTree()
  }

  /** 어댑터가 밑에 둔 CLI까지 같이 보낸다 — 그룹 리더로 띄웠으므로 음수 pid가 그룹 전체다.
   *  프로세스 종료 경로(process.on('exit'))에서도 불리므로 동기여야 한다 */
  #killTree() {
    const pid = this.#child.pid
    if (pid === undefined) return
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      this.#child.kill()
    }
  }
}

// 창의 **탭 하나가 세션 하나**다 — 같은 런타임이어도 탭이 다르면 다른 대화·다른 자식 프로세스다.
// 스코프는 여전히 워크스페이스라 프로젝트별로는 나누지 않는다.
const sessions = new Map<string, Promise<AgentSession>>()

const keyOf = (runtime: string, tab: string) => `${runtime} ${tab}`

/** 창을 닫았다 다시 열어도 탭마다 같은 대화가 이어진다(IDLE_KILL_MS까지) */
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
  const started = AgentSession.start(runtime, spec ?? RUNTIMES[runtime].spec()).then((session) => {
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
process.on('exit', () => disposeAllSessions())

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
 * 고아 판정은 **주인 표식**으로 한다(MEW_AGENT_OWNER = 띄운 서버의 pid): 그 pid가 죽어 있으면
 * 지난 실행이 남긴 것이고, 살아 있으면 지금 돌고 있는 다른 mew의 자식이라 건드리지 않는다.
 * PPID 1로 보지 않는 이유 — WSL은 부모를 잃은 프로세스를 PID 1이 아니라 중간의 `/init` 릴레이가
 * 거둬 가서 영영 안 잡힌다. /proc이 없는 환경을 위해 옛 PPID 1 규칙은 보조로 남긴다.
 *
 * 그룹(-pid)으로 보내지 않는다: 이 변경 전에 뜬 고아는 그룹 리더가 아니라서, 그 그룹에
 * 지금 이 서버가 들어 있을 수도 있다. 스냅샷에서 자손을 직접 훑어 하나씩 보낸다.
 */
export function reapOrphanAgents() {
  const target = process.env.MEW_AGENT_CMD || DEFAULT_AGENT_CMD
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
    if (row.ppid === 1 && row.args.includes(target)) collect(row.pid)
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
