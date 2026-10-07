import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { McpServer } from '@agentclientprotocol/sdk'
import { DATA_DIR } from './dataDir.ts'
import { getUser } from './auth.ts'
import { accessChanges, canUse, unrestrictedWorkspaceFiles } from './access-policy.ts'
import { workspacePaths } from './paths.ts'
import { debugConfig, debugSession, debugSessions, idleDebugSnapshot, newDebugSession } from './debugger.ts'

const tools = [
  { name: 'debugger_state', description: 'Read this account/project debugger state, capabilities, frames and captured stop history. Select an optional sessionId from the returned session list. Never evaluates expressions.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'debugger_command', description: 'Issue a bounded debugger command. Use connectionId and stopRevision from debugger_state. Evaluation, value/memory writes and execution controls can change the target; follow the user task and project restrictions.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, command: { type: 'string' }, arguments: { type: 'object' } }, required: ['sessionId', 'command', 'arguments'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'debugger_start', description: 'Start the saved debugger configuration or named profile. This launches/attaches to a target; follow project execution restrictions. Does not install tools.', inputSchema: { type: 'object', properties: { profile: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'debugger_stop', description: 'Disconnect the exact session. Launch targets are terminated; attach targets remain running according to adapter behavior.', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
]
const bindings = new Map<string, DebuggerBinding>()
const starting = new Map<string, Promise<DebuggerBinding>>()

function authorized(account: string, root: string) {
  const user = getUser(account)
  if (!user || workspacePaths.root !== root) return false
  const auth = { email: account, role: user.role, mustChangePassword: user.mustChangePassword }
  return ['owner', 'manager'].includes(user.role) && !user.mustChangePassword && canUse(auth, 'agent') && canUse(auth, 'terminal') && unrestrictedWorkspaceFiles(auth, root, true) && debugConfig(account, root).agentBridge === true
}
export class DebuggerBinding {
  readonly account: string
  readonly root: string
  readonly socketPath: string
  readonly mcpServers: McpServer[]
  private server: net.Server
  private sockets = new Set<net.Socket>()
  private timer?: NodeJS.Timeout
  private active = true
  constructor(account: string, root: string) {
    this.account = account; this.root = root
    const digest = createHash('sha256').update(JSON.stringify([account, root])).digest('hex').slice(0, 24)
    this.socketPath = path.join(DATA_DIR, 'debugger-mcp', `${digest}.sock`)
    this.mcpServers = [{ name: 'mew-debugger', command: process.execPath, args: [fileURLToPath(new URL('./debugger-mcp-stdio.ts', import.meta.url)), this.socketPath], env: [] }]
    this.server = net.createServer(socket => {
      this.sockets.add(socket); socket.setEncoding('utf8'); socket.setTimeout(65_000, () => socket.destroy())
      socket.on('error', () => {}); socket.on('close', () => this.sockets.delete(socket))
      let buffer = '', handled = false
      socket.on('data', chunk => {
        if (handled) return
        buffer += chunk
        if (buffer.length > 32_000 || this.sockets.size > 32) { socket.destroy(); return }
        const end = buffer.indexOf('\n'); if (end < 0) return
        handled = true; socket.pause()
        void this.rpc(buffer.slice(0, end)).then(result => socket.end(`${JSON.stringify(result)}\n`)).catch(() => socket.destroy())
      })
    })
    this.server.unref()
  }
  private assertAccess() { if (!this.active || !authorized(this.account, this.root)) throw new Error('DEBUGGER_FORBIDDEN') }
  async listen() {
    this.assertAccess(); fs.mkdirSync(path.dirname(this.socketPath), { recursive: true, mode: 0o700 }); fs.rmSync(this.socketPath, { force: true })
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.socketPath, () => { this.server.off('error', reject); resolve() }) })
    fs.chmodSync(this.socketPath, 0o600)
    this.timer = setInterval(this.recheck, 5000); this.timer.unref(); accessChanges.on('change', this.recheck)
  }
  private recheck = () => { try { this.assertAccess() } catch { this.close() } }
  close() {
    if (!this.active) return
    this.active = false; clearInterval(this.timer); accessChanges.off('change', this.recheck)
    for (const socket of this.sockets) socket.destroy()
    this.server.close(); fs.rmSync(this.socketPath, { force: true })
    if (bindings.get(JSON.stringify([this.account, this.root])) === this) bindings.delete(JSON.stringify([this.account, this.root]))
  }
  async rpc(line: string) {
    const req = JSON.parse(line)
    const response = { jsonrpc: '2.0', id: req.id ?? null }
    try {
      this.assertAccess()
      if (req.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC')
      if (req.method === 'initialize') return { ...response, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mew-debugger', version: '1' }, instructions: 'Call debugger_state before inspecting a paused target. Use the current connectionId and stopRevision. Debugger tools obey Mew account/project permissions and the project execution rules.' } }
      if (req.method === 'ping') return { ...response, result: {} }
      if (req.method === 'tools/list') return { ...response, result: { tools } }
      if (req.method !== 'tools/call') throw new Error('Method not found')
      const name = req.params?.name, args = req.params?.arguments ?? {}
      if (!args || typeof args !== 'object' || Array.isArray(args) || !tools.some(t => t.name === name)) throw new Error('Invalid tool or arguments')
      let value: unknown
      const session = debugSession(this.account, this.root, args.sessionId)
      if (name === 'debugger_state') {
        if (Object.keys(args).some(k => k !== 'sessionId') || args.sessionId !== undefined && typeof args.sessionId !== 'string') throw new Error('Invalid arguments')
        if (args.sessionId && !session) throw new Error('DEBUGGER_SESSION_CHANGED')
        const snapshot = session?.snapshot ?? idleDebugSnapshot()
        value = { ...snapshot, sessions: debugSessions(this.account, this.root).map(s => ({ id: s.snapshot.id, name: s.profile || s.config.kind, state: s.snapshot.state })), output: snapshot.output.slice(-8000), history: snapshot.history?.slice(-8).map(h => ({ ...h, variables: h.variables.slice(0, 100) })) }
      } else if (name === 'debugger_start') {
        if (Object.keys(args).some(k => k !== 'profile') || args.profile !== undefined && typeof args.profile !== 'string') throw new Error('Invalid profile')
        const next = newDebugSession(this.account, this.root, args.profile); await next.start(); value = next.snapshot
      } else {
        if (!session || args.sessionId !== session.snapshot.id) throw new Error('DEBUGGER_SESSION_CHANGED')
        if (name === 'debugger_stop') { if (Object.keys(args).some(k => k !== 'sessionId')) throw new Error('Invalid arguments'); await session.stop(); value = { ok: true } }
        else {
          if (Object.keys(args).some(k => !['sessionId', 'command', 'arguments'].includes(k)) || typeof args.command !== 'string' || !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments) || args.arguments.connectionId === undefined || args.arguments.stopRevision === undefined) throw new Error('Current connectionId and stopRevision are required')
          value = await session.command(args.command, args.arguments)
        }
      }
      this.assertAccess()
      const text = JSON.stringify(value)
      if (text.length > 1_500_000) throw new Error('DEBUGGER_RESPONSE_LIMIT')
      return { ...response, result: { content: [{ type: 'text', text }] } }
    } catch (error) {
      return req.method === 'tools/call' ? { ...response, result: { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'DEBUGGER_ERROR' }] } } : { ...response, error: { code: -32603, message: error instanceof Error ? error.message : 'DEBUGGER_ERROR' } }
    }
  }
}
export async function debuggerMcpServers(account: string, root: string): Promise<McpServer[]> {
  if (!authorized(account, root)) return []
  const key = JSON.stringify([account, root]), existing = bindings.get(key)
  if (existing) return existing.mcpServers
  if (!starting.has(key)) {
    if (bindings.size + starting.size >= 64) throw new Error('디버거 MCP 연결 한도에 도달했습니다')
    starting.set(key, (async () => { const binding = new DebuggerBinding(account, root); try { await binding.listen(); bindings.set(key, binding); return binding } catch (error) { binding.close(); throw error } finally { starting.delete(key) } })())
  }
  return (await starting.get(key)!).mcpServers
}
