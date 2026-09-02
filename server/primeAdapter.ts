// Prime Agent는 공식 배포본에서 ACP 세션 관리 기능을 제공하지 않는다. 이 프로세스는 공식
// `prime-agent --mode rpc` JSONL을 ACP로 변환하는 mew 소유 경계다. Prime 소스나 설치본을 패치하지 않는다.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

type RpcResponse = { id?: string; type: 'response'; command: string; success: boolean; data?: any; error?: string }
type RpcEvent = { type: 'session_event'; event: any }
type RawRpcEvent = { type: string; [key: string]: any }
type RpcLine = RpcResponse | RpcEvent | RawRpcEvent
type SavedSession = { sessionId: string; cwd: string; title: string | null; updatedAt: string }

const PRIME_SESSION_DIR = process.env.MEW_PRIME_SESSION_DIR || path.join(os.homedir(), '.prime', 'agent', 'sessions')
const PRIME_EXECUTABLE = process.env.MEW_PRIME_AGENT_EXECUTABLE || 'prime-agent'
const PRIME_PERMISSION_EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'primePermissionGate.ts')

// Prime 0.8은 이벤트를 `session_event` 래퍼 없이 JSONL 최상위에 낸다. 초기 RPC 구현의
// 래퍼 형식도 계속 받아 이전 설치본과의 호환성을 유지한다.
const RAW_EVENT_TYPES = new Set([
  'agent_start', 'agent_end', 'turn_start', 'turn_end',
  'message_start', 'message_update', 'message_end',
  'tool_execution_start', 'tool_execution_end',
  'extension_ui_request',
])

function rawEvent(message: RpcLine): RawRpcEvent | null {
  return message.type !== 'response' && message.type !== 'session_event' && RAW_EVENT_TYPES.has(message.type) ? message : null
}

function modelId(model: any): string {
  return `${String(model?.provider ?? '')}::${String(model?.id ?? '')}`
}

function modelState(models: any[], current: any) {
  return {
    currentModelId: modelId(current),
    availableModels: models.map((model) => ({ modelId: modelId(model), name: String(model.name ?? `${model.provider}/${model.id}`) })),
  }
}

function parseModel(value: string) {
  const pivot = value.indexOf('::')
  if (pivot <= 0 || pivot === value.length - 2) throw new Error('Prime 모델 ID 형식이 올바르지 않습니다')
  return { provider: value.slice(0, pivot), modelId: value.slice(pivot + 2) }
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const PERMISSION_MODES = [
  { id: 'ask', name: '매 도구 승인' },
  { id: 'full-access', name: '전체 허용' },
  { id: 'disabled', name: '도구 사용 안 함' },
]

function configOptions(state: any) {
  return [{
    id: 'thinking', name: '추론 정도', description: '모델이 답하기 전에 쓰는 추론량', category: 'thought_level', type: 'select' as const,
    currentValue: state.thinkingLevel,
    options: THINKING_LEVELS.map((value) => ({ value, name: value })),
  }]
}

function textOf(content: any): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  return content.map((part) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').join('') || null
}

async function listSavedSessions(cwd: string): Promise<SavedSession[]> {
  let names: string[]
  try { names = await fs.readdir(PRIME_SESSION_DIR) } catch { return [] }
  const sessions = await Promise.all(names.filter((name) => name.endsWith('.jsonl')).map(async (name) => {
    const file = path.join(PRIME_SESSION_DIR, name)
    try {
      const stat = await fs.stat(file)
      const head = (await fs.readFile(file, 'utf8')).slice(0, 64 * 1024)
      let storedCwd: string | null = null
      let title: string | null = null
      for (const line of head.split('\n')) {
        try {
          const entry = JSON.parse(line) as any
          if (typeof entry.cwd === 'string') storedCwd = entry.cwd
          if (!title && entry.type === 'message' && entry.message?.role === 'user') title = textOf(entry.message.content)
          if (!title && entry.type === 'user') title = textOf(entry.message?.content)
        } catch { /* incomplete trailing line */ }
      }
      if (!storedCwd || storedCwd.toLocaleLowerCase() !== cwd.toLocaleLowerCase()) return null
      return { sessionId: name.slice(0, -'.jsonl'.length), cwd, title, updatedAt: stat.mtime.toISOString() }
    } catch { return null }
  }))
  return sessions.filter((item): item is SavedSession => item !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50)
}

class PrimeRpc {
  #child: ChildProcess
  #next = 1
  #pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void }>()
  #buffer = ''
  #permissionDir: string
  #permissionFile: string
  onEvent: (event: any) => void = () => {}

  constructor() {
    this.#permissionDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mew-prime-'))
    this.#permissionFile = path.join(this.#permissionDir, 'permissions.json')
    fsSync.writeFileSync(this.#permissionFile, '{"mode":"full-access"}\n', { mode: 0o600 })
    this.#child = spawn(PRIME_EXECUTABLE, ['--mode', 'rpc', '--extension', PRIME_PERMISSION_EXTENSION], {
      cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, MEW_PRIME_PERMISSION_FILE: this.#permissionFile },
    })
    this.#child.stdout?.on('data', (chunk: Buffer) => this.#read(chunk.toString()))
    this.#child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mew:prime] ${chunk}`))
    this.#child.on('error', (err) => this.#rejectAll(err))
    this.#child.on('exit', (code, signal) => this.#rejectAll(new Error(`Prime Agent가 종료됐습니다 (code=${code} signal=${signal})`)))
  }

  #read(chunk: string) {
    this.#buffer += chunk
    for (let end = this.#buffer.indexOf('\n'); end >= 0; end = this.#buffer.indexOf('\n')) {
      const line = this.#buffer.slice(0, end); this.#buffer = this.#buffer.slice(end + 1)
      if (!line.trim()) continue
      let message: RpcLine
      try { message = JSON.parse(line) as RpcLine } catch { continue }
      if (message.type === 'session_event') this.onEvent(message.event)
      else if (message.type === 'response' && message.id) {
        const request = this.#pending.get(message.id)
        if (!request) continue
        this.#pending.delete(message.id)
        message.success ? request.resolve(message.data) : request.reject(new Error(message.error || `Prime ${message.command} 실패`))
      } else if (rawEvent(message)) this.onEvent(message)
    }
  }

  #rejectAll(error: Error) {
    for (const { reject } of this.#pending.values()) reject(error)
    this.#pending.clear()
  }

  request(type: string, values: Record<string, unknown> = {}) {
    const id = `mew-${this.#next++}`
    return new Promise<any>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#child.stdin?.write(`${JSON.stringify({ id, type, ...values })}\n`, (err) => { if (err) this.#rejectAll(err) })
    })
  }

  notify(value: Record<string, unknown>) { this.#child.stdin?.write(`${JSON.stringify(value)}\n`) }
  setPermissionMode(mode: string) { fsSync.writeFileSync(this.#permissionFile, `${JSON.stringify({ mode })}\n`, { mode: 0o600 }) }
  close() {
    this.#child.kill('SIGTERM')
    fsSync.rmSync(this.#permissionDir, { recursive: true, force: true })
  }
}

function updates(event: any): any[] {
  if (event?.type === 'message_update' && event.message?.role === 'assistant') {
    const delta = event.assistantMessageEvent
    if (delta?.type === 'text_delta' && delta.delta) return [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: delta.delta } }]
    if (delta?.type === 'thinking_delta' && delta.delta) return [{ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: delta.delta } }]
  }
  if (event?.type === 'tool_execution_start') return [{ sessionUpdate: 'tool_call', toolCallId: event.toolCallId, title: event.toolName, kind: 'execute', status: 'in_progress', rawInput: event.args }]
  if (event?.type === 'tool_execution_end') return [{ sessionUpdate: 'tool_call_update', toolCallId: event.toolCallId, status: event.isError ? 'failed' : 'completed' }]
  return []
}

class PrimeAdapter {
  rpc = new PrimeRpc()
  sessionId = ''
  models: any[] = []
  client: any
  permissionMode = 'full-access'
  // Prime RPC의 prompt 응답은 실행 접수만 뜻한다. ACP turn은 실제 turn_end 이벤트까지 살아 있어야
  // 스트리밍·도구 실행 중에 Mew가 대기열을 다음 프롬프트로 넘기지 않는다.
  #turnDone: (() => void) | null = null

  constructor(client: any) {
    this.client = client
    this.rpc.onEvent = (event) => { void this.#handleEvent(event) }
  }

  async #handleEvent(event: any) {
    if (event?.type === 'extension_ui_request' && event.method === 'confirm' && typeof event.id === 'string') {
      const response = await this.client.requestPermission({
        sessionId: this.sessionId,
        toolCall: { toolCallId: event.id, title: String(event.title ?? 'Prime 도구 실행'), kind: 'execute', status: 'pending', rawInput: event.message },
        options: [{ optionId: 'allow', name: '허용', kind: 'allow_once' }, { optionId: 'deny', name: '거절', kind: 'reject_once' }],
      }).catch(() => ({ outcome: { outcome: 'cancelled' } }))
      this.rpc.notify({ type: 'extension_ui_response', id: event.id, confirmed: response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow' })
      return
    }
    for (const update of updates(event)) await this.client.sessionUpdate({ sessionId: this.sessionId, update })
    if (event?.type === 'turn_end') {
      const done = this.#turnDone
      this.#turnDone = null
      done?.()
    }
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {} } },
      agentInfo: { name: 'mew-prime-adapter', title: 'Prime Agent', version: 'rpc' },
    }
  }

  // 공식 Prime 인증은 TUI `/login`이 소유한다. ACP 호스트의 필수 no-op 메서드만 제공한다.
  async authenticate() { return {} }

  async newSession() {
    const state = await this.rpc.request('get_state')
    this.models = (await this.rpc.request('get_available_models')).models ?? []
    this.sessionId = state.sessionId
    return { sessionId: this.sessionId, models: modelState(this.models, state.model), configOptions: configOptions(state), modes: { currentModeId: this.permissionMode, availableModes: PERMISSION_MODES } }
  }

  async loadSession({ sessionId }: { sessionId: string }) {
    await this.rpc.request('switch_session', { sessionPath: sessionId })
    const state = await this.rpc.request('get_state')
    this.models = (await this.rpc.request('get_available_models')).models ?? []
    this.sessionId = state.sessionId
    const messages = (await this.rpc.request('get_messages')).messages ?? []
    for (const message of messages) {
      const text = textOf(message.content)
      if (!text) continue
      const sessionUpdate = message.role === 'assistant' ? 'agent_message_chunk' : message.role === 'user' ? 'user_message_chunk' : null
      if (sessionUpdate) await this.client.sessionUpdate({ sessionId: this.sessionId, update: { sessionUpdate, content: { type: 'text', text } } })
    }
    return { sessionId: this.sessionId, models: modelState(this.models, state.model), configOptions: configOptions(state), modes: { currentModeId: this.permissionMode, availableModes: PERMISSION_MODES } }
  }

  async unstable_listSessions({ cwd }: { cwd: string }) { return { sessions: await listSavedSessions(cwd) } }
  async prompt({ prompt }: any) {
    if (this.#turnDone) throw new Error('Prime Agent가 이미 프롬프트를 처리 중입니다')
    let resolveTurn!: () => void
    const turnDone = new Promise<void>((resolve) => { resolveTurn = resolve })
    this.#turnDone = resolveTurn
    try {
      // 공식 RPC의 응답은 prompt admission일 뿐이다. 실제 답변·도구 이벤트는 이후 JSONL로 흐르고
      // turn_end에서 끝난다.
      await this.rpc.request('prompt', { message: prompt.map((item: any) => item.text ?? '').join('') })
    } catch (error) {
      this.#turnDone = null
      throw error
    }
    // turn_end가 오지 않으면 영원히 대기하므로 5분 타임아웃을 둔다.
    // Prime이 비정상 종료돼도 rpc.request가 reject하므로 여기까지 오지 않지만,
    // turn_end만 누락되는 케이스를 방어한다.
    try {
      await Promise.race([
        turnDone,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Prime Agent turn_end 타임아웃 (5분)')), 5 * 60_000)
        ),
      ])
    } catch (error) {
      this.#turnDone = null
      throw error
    }
    return { stopReason: 'end_turn' as const }
  }
  async cancel() { await this.rpc.request('abort') }
  async setSessionMode({ modeId }: { modeId: string }) {
    if (!PERMISSION_MODES.some((mode) => mode.id === modeId)) throw new Error('Prime 권한 모드가 올바르지 않습니다')
    this.permissionMode = modeId
    this.rpc.setPermissionMode(modeId)
  }
  async setSessionConfigOption({ configId, value }: { configId: string; value: unknown }) {
    if (configId !== 'thinking' || !THINKING_LEVELS.includes(String(value))) throw new Error('Prime 추론 정도가 올바르지 않습니다')
    await this.rpc.request('set_thinking_level', { level: value })
    return { configOptions: configOptions({ thinkingLevel: value }) }
  }
  async unstable_setSessionModel({ modelId: id }: { modelId: string }) { await this.rpc.request('set_model', parseModel(id)) }
}

let adapter: PrimeAdapter | null = null
const connection = new AgentSideConnection(
  (client: any) => { adapter = new PrimeAdapter(client); return adapter },
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
void connection
process.on('SIGTERM', () => adapter?.rpc.close())
