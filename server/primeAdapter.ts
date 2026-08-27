// Prime Agent는 공식 배포본에서 ACP 세션 관리 기능을 제공하지 않는다. 이 프로세스는 공식
// `prime-agent --mode rpc` JSONL을 ACP로 변환하는 mew 소유 경계다. Prime 소스나 설치본을 패치하지 않는다.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

type RpcResponse = { id?: string; type: 'response'; command: string; success: boolean; data?: any; error?: string }
type RpcEvent = { type: 'session_event'; event: any }
type RpcLine = RpcResponse | RpcEvent
type SavedSession = { sessionId: string; cwd: string; title: string | null; updatedAt: string }

const PRIME_SESSION_DIR = process.env.MEW_PRIME_SESSION_DIR || path.join(os.homedir(), '.prime', 'agent', 'sessions')
const PRIME_EXECUTABLE = process.env.MEW_PRIME_AGENT_EXECUTABLE || 'prime-agent'

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
      if (storedCwd !== cwd) return null
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
  onEvent: (event: any) => void = () => {}

  constructor() {
    this.#child = spawn(PRIME_EXECUTABLE, ['--mode', 'rpc'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
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
      }
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

  close() { this.#child.kill('SIGTERM') }
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

  constructor(client: any) {
    this.client = client
    this.rpc.onEvent = (event) => { for (const update of updates(event)) void this.client.sessionUpdate({ sessionId: this.sessionId, update }) }
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {} } },
      agentInfo: { name: 'mew-prime-adapter', title: 'Prime Agent', version: 'rpc' },
    }
  }

  async newSession() {
    const state = await this.rpc.request('get_state')
    this.models = (await this.rpc.request('get_available_models')).models ?? []
    this.sessionId = state.sessionId
    return { sessionId: this.sessionId, models: modelState(this.models, state.model), modes: { currentModeId: state.thinkingLevel, availableModes: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, name: id })) } }
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
    return { sessionId: this.sessionId, models: modelState(this.models, state.model), modes: { currentModeId: state.thinkingLevel, availableModes: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, name: id })) } }
  }

  async unstable_listSessions({ cwd }: { cwd: string }) { return { sessions: await listSavedSessions(cwd) } }
  async prompt({ prompt }: { prompt: Array<{ text?: string }> }) { await this.rpc.request('prompt', { message: prompt.map((item) => item.text ?? '').join('') }); return { stopReason: 'end_turn' } }
  async cancel() { await this.rpc.request('abort') }
  async setSessionMode({ modeId }: { modeId: string }) { await this.rpc.request('set_thinking_level', { level: modeId }) }
  async unstable_setSessionModel({ modelId: id }: { modelId: string }) { await this.rpc.request('set_model', parseModel(id)) }
}

let adapter: PrimeAdapter | null = null
const connection = new AgentSideConnection(
  (client: any) => { adapter = new PrimeAdapter(client); return adapter },
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)
void connection
process.on('SIGTERM', () => adapter?.rpc.close())
