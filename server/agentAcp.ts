// ACP(Agent Client Protocol) 클라이언트 — 에이전트를 child process로 띄우고 한 프로젝트에 묶는다.
// 벤더 전환은 spawn 대상 교체다(MEW_AGENT_CMD). 자체 어댑터 인터페이스는 두지 않는다 — ACP가 인터페이스다.
// 결정 기준본: docs/decisions/0034-mew-agent-panel-acp-reintroduction.md
//
// 보안 경계 두 겹:
//  1. 이 모듈을 붙이는 WS가 owner/manager만 통과시킨다(server/agentWs.ts)
//  2. 파일 도구는 fs capability로 **mew 프로세스 안에서** 실행돼 projectRoot 밖을 거부한다.
//     Bash는 경로 스코프가 되지 않는다 — 승인 프롬프트가 유일한 통제이고, 실질 격리는 OS 층(2단계)이다.
import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type PermissionOption,
  type ReadTextFileRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type ToolCallUpdate,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk'
import { projectRoot, resolveProjectPath } from './paths.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 기본 백엔드 — 버전 고정된 로컬 설치본. `npx @latest`로 띄우지 않는다(ADR 0034) */
const DEFAULT_AGENT_CMD = path.resolve(here, '../node_modules/.bin/claude-code-acp')

/** 재접속(모바일 화면 꺼짐 등) 때 되돌려 줄 이벤트 개수 상한 */
const MAX_BUFFERED_EVENTS = 500

/** 붙어 있는 창이 하나도 없는 채로 이만큼 지나면 에이전트를 죽인다 */
const IDLE_KILL_MS = 10 * 60_000

export type AgentEvent =
  | { type: 'update'; update: SessionNotification['update'] }
  | { type: 'permission'; id: string; toolCall: ToolCallUpdate; options: PermissionOption[] }
  | { type: 'permission_done'; id: string }
  | { type: 'turn_start' }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'error'; message: string }

export interface SpawnSpec {
  cmd: string
  args: string[]
  env?: Record<string, string | undefined>
}

function defaultSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_CMD || DEFAULT_AGENT_CMD
  const args = process.env.MEW_AGENT_ARGS ? process.env.MEW_AGENT_ARGS.split(' ').filter(Boolean) : []
  // CLAUDE_CONFIG_DIR을 넘기면 에이전트가 mew 서버 사용자의 자격증명을 보지 않는다(2단계 준비).
  const env = process.env.MEW_AGENT_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.MEW_AGENT_CONFIG_DIR } : undefined
  return { cmd, args, env }
}

export class AgentSession {
  readonly project: string
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
  busy = false

  private constructor(project: string, spec: SpawnSpec) {
    this.project = project
    this.cwd = projectRoot(project)
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
      console.error(`[mew:agent:${project}]`, chunk.toString().trimEnd())
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

  static async start(project: string, spec: SpawnSpec = defaultSpawnSpec()): Promise<AgentSession> {
    const session = new AgentSession(project, spec)
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
    await this.#conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    })
    const created = await this.#conn.newSession({ cwd: this.cwd, mcpServers: [] })
    this.#sessionId = created.sessionId
  }

  #client(): Client {
    return {
      sessionUpdate: async (params: SessionNotification) => {
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

  /** 에이전트가 준 절대 경로를 프로젝트 안으로 가둔다 — 밖이면 resolveProjectPath가 던진다 */
  #scoped(absolutePath: string): string {
    return resolveProjectPath(this.project, path.relative(this.cwd, path.resolve(this.cwd, absolutePath)))
  }

  attach(listener: (event: AgentEvent) => void): () => void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    for (const event of this.#events) listener(event)
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
      this.#armIdleTimer()
    }
  }

  prompt(text: string) {
    if (this.busy) throw new Error('이미 진행 중인 턴이 있습니다')
    this.busy = true
    // 사용자 발화도 이벤트 버퍼에 남긴다 — 재접속한 창이 대화를 그대로 복원하려면 여기 있어야 한다
    this.#emit({ type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } } })
    this.#emit({ type: 'turn_start' })
    this.#conn
      .prompt({ sessionId: this.#sessionId, prompt: [{ type: 'text', text }] })
      .then((res) => this.#emit({ type: 'turn_end', stopReason: res.stopReason }))
      .catch((err: unknown) => {
        this.#emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
        this.#emit({ type: 'turn_end', stopReason: 'error' })
      })
      .finally(() => {
        this.busy = false
      })
  }

  /** 승인 대기 중인 요청은 취소 결과로 닫는다 — 스펙 요구사항(cancel 시 outcome: cancelled) */
  cancel() {
    for (const [id, resolve] of this.#pending) {
      resolve({ outcome: { outcome: 'cancelled' } })
      this.#emit({ type: 'permission_done', id })
    }
    this.#pending.clear()
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
    for (const listener of this.#listeners) listener(event)
  }

  #fail(message: string) {
    this.#emit({ type: 'error', message })
    this.dispose()
  }

  #armIdleTimer() {
    if (this.#listeners.size > 0 || this.#idleTimer || this.#disposed) return
    this.#idleTimer = setTimeout(() => {
      sessions.delete(keyOf(this.project))
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

const sessions = new Map<string, Promise<AgentSession>>()

function keyOf(project: string): string {
  return project
}

/** 프로젝트당 하나. 창을 닫았다 다시 열어도 같은 대화가 이어진다(IDLE_KILL_MS까지) */
export function sessionFor(project: string): Promise<AgentSession> {
  const key = keyOf(project)
  const existing = sessions.get(key)
  if (existing) return existing
  const started = AgentSession.start(project).catch((err: unknown) => {
    sessions.delete(key)
    throw err
  })
  sessions.set(key, started)
  return started
}

export function disposeSession(project: string) {
  const pending = sessions.get(keyOf(project))
  if (!pending) return
  sessions.delete(keyOf(project))
  void pending.then((session) => session.dispose()).catch(() => {})
}
