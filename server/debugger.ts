import path from 'node:path'
import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import type { RequestAuth } from './reqAuth.ts'
import { getUser } from './auth.ts'
import { accessChanges, canUse, unrestrictedWorkspaceFiles } from './access-policy.ts'
import { jsDebugEntry, prepareJsDebugPackage } from './debugger-install.ts'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { DapConnection } from './debugger-dap.ts'
import { defaultDebugConfig, type DebugConfig, type DebugSnapshot } from '../shared/debugger.ts'

export function validateDebugConfig(value: unknown): DebugConfig {
  const v = value as DebugConfig
  if (!v || !['js-debug', 'debugpy', 'lldb-dap', 'codelldb', 'delve', 'custom'].includes(v.kind) || !['stdio', 'tcp'].includes(v.transport) || !['launch', 'attach'].includes(v.request)
    || typeof v.command !== 'string' || v.command.length > 4096 || !Array.isArray(v.args) || v.args.length > 64 || v.args.some(x => typeof x !== 'string' || x.length > 4096)
    || !Number.isInteger(v.port) || v.port < 0 || v.port > 65535 || !v.configuration || typeof v.configuration !== 'object' || Array.isArray(v.configuration)
    || !Array.isArray(v.breakpoints) || v.breakpoints.length > 200 || v.breakpoints.some(b => !b || typeof b.file !== 'string' || !b.file || b.file.length > 4096 || !Number.isInteger(b.line) || b.line < 1 || typeof b.enabled !== 'boolean')
    || !Array.isArray(v.watches) || v.watches.length > 64 || v.watches.some(w => typeof w !== 'string' || !w || w.length > 2048) || JSON.stringify(v.configuration).length > 64000) throw new Error('디버거 설정 형식이 올바르지 않습니다')
  return { kind: v.kind, transport: v.transport, command: v.command, args: v.args, port: v.port, request: v.request, configuration: v.configuration, breakpoints: v.breakpoints, watches: v.watches }
}
export const idleDebugSnapshot = (): DebugSnapshot => ({ id: null, state: 'idle', reason: '', frames: [], output: '', breakpoints: [], capabilities: {} })
export class DebugSession {
  snapshot: DebugSnapshot = idleDebugSnapshot()
  private channels: DapConnection[] = []
  private active?: DapConnection
  private processes: ChildProcess[] = []
  private closed = false
  private starting = false
  private port = 0
  private threadId = 0
  private stopGeneration = 0
  private initialization = new Map<DapConnection, Promise<Record<string, any>>>()
  private breakpointStatus = new Map<DapConnection, Map<string, DebugSnapshot['breakpoints']>>()
  private configured = new Set<DapConnection>()
  config: DebugConfig
  readonly root: string
  readonly account: string | null
  private permissionTimer?: NodeJS.Timeout
  constructor(config: DebugConfig, root: string, account: string | null = null) { this.config = config; this.root = root; this.account = account }
  recheckPermission = () => {
    if (!this.account || this.closed) return
    const user = getUser(this.account)
    const auth: RequestAuth = { email: this.account, role: user?.role ?? 'guest', mustChangePassword: user?.mustChangePassword ?? false }
    if (!user || !['owner', 'manager'].includes(auth.role) || auth.mustChangePassword || !canUse(auth, 'terminal') || !unrestrictedWorkspaceFiles(auth, this.root, true)) void this.stop()
  }
  private output(text: string) { this.snapshot.output = (this.snapshot.output + text).slice(-64000) }
  private error(error: unknown) {
    if (this.closed) return
    this.snapshot.state = 'error'; this.snapshot.reason = error instanceof Error ? error.message : '디버거 오류'
    this.cleanup()
  }
  private process(command: string, args: string[], cwd = this.root, env?: Record<string, string | null>) {
    if (!command) throw new Error('어댑터 실행 파일을 지정하세요')
    const childEnv = { ...process.env }
    for (const [key, value] of Object.entries(env ?? {})) { if (value === null) delete childEnv[key]; else childEnv[key] = value }
    const child = spawn(command, args, { cwd, env: childEnv, stdio: 'pipe', detached: process.platform !== 'win32' })
    this.processes.push(child)
    child.on('error', error => this.error(error))
    child.stderr!.on('data', data => this.output(data.toString()))
    return child
  }
  private async connect(port: number): Promise<DapConnection> {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && !this.closed) {
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const socket = net.createConnection({ host: '127.0.0.1', port })
          const timer = setTimeout(() => socket.destroy(new Error('연결 시간 초과')), 500)
          socket.once('connect', () => { clearTimeout(timer); socket.removeListener('error', reject); resolve(socket) })
          socket.once('error', error => { clearTimeout(timer); socket.destroy(); reject(error) })
        })
        return new DapConnection(socket, socket)
      } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    throw new Error('DAP 어댑터에 연결할 수 없습니다')
  }
  private wire(client: DapConnection) {
    this.channels.push(client)
    this.breakpointStatus.set(client, new Map())
    client.onClose = error => { if (!this.closed && this.snapshot.state !== 'terminated' && this.snapshot.state !== 'error' && client === this.channels[0]) this.error(error) }
    client.onEvent = event => {
      if (this.closed) return
      const body = event.body ?? {}
      if (event.event === 'initialized') {
        void this.configure(client).catch(error => this.error(error))
      } else if (event.event === 'output') this.output(String(body.output ?? ''))
      else if (event.event === 'stopped') {
        this.active = client; this.threadId = Number(body.threadId ?? 0)
        this.snapshot.state = 'stopped'; this.snapshot.reason = String(body.reason ?? '')
        this.snapshot.threadId = this.threadId
        const generation = ++this.stopGeneration
        this.snapshot.stopRevision = generation
        void this.inspect(client, generation).catch(error => { if (generation === this.stopGeneration && this.snapshot.state === 'stopped') this.snapshot.reason = error.message })
      } else if (event.event === 'continued') {
        ++this.stopGeneration; this.snapshot.state = 'running'; this.snapshot.frames = []; this.snapshot.reason = ''
      } else if (event.event === 'terminated' && client === this.channels[0]) {
        this.snapshot.state = 'terminated'; this.snapshot.frames = []; this.cleanup()
      } else if (event.event === 'breakpoint') {
        const bp = body.breakpoint
        if (!bp) return
        for (const values of this.breakpointStatus.get(client)?.values() ?? []) {
          const previous = values.find(value => bp.id !== undefined ? value.id === bp.id : value.file === bp.source?.path && value.line === bp.line)
          if (previous) { previous.verified = Boolean(bp.verified); previous.message = bp.message; previous.actualLine = bp.line ?? previous.actualLine }
        }
        this.mergeBreakpointStatus()
      }
    }
    client.onRequest = async message => {
      const args = message.arguments ?? {}
      if (message.command === 'startDebugging') {
        if (!this.port || this.channels.length >= 16) throw new Error('자식 디버그 세션을 시작할 수 없습니다')
        const child = await this.connect(this.port)
        if (this.closed) { child.dispose(); throw new Error('디버거가 종료되었습니다') }
        this.wire(child)
        await this.initialize(child)
        await child.request(String(args.request ?? 'launch'), args.configuration as Record<string, unknown>, 30000)
        if (this.active === this.channels[0]) this.active = child
        return {}
      }
      if (message.command === 'runInTerminal') {
        const argv = args.args
        if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string') || args.argsCanBeInterpretedByShell) throw new Error('셸 해석이 필요한 터미널 요청은 지원하지 않습니다')
        const child = this.process(argv[0], argv.slice(1), typeof args.cwd === 'string' ? args.cwd : this.root, args.env as Record<string, string | null>)
        child.stdout!.on('data', data => this.output(data.toString()))
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
        return { processId: child.pid }
      }
      throw new Error(`지원하지 않는 역방향 요청: ${message.command}`)
    }
  }
  private initialize(client: DapConnection) {
    const pending = client.request('initialize', { clientID: 'mew', clientName: 'mew', adapterID: this.config.kind, pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsStartDebuggingRequest: true, supportsRunInTerminalRequest: true }).then(capabilities => {
      this.snapshot.capabilities = { ...this.snapshot.capabilities, ...capabilities }
      return capabilities
    })
    this.initialization.set(client, pending)
    return pending
  }
  private async inspect(client: DapConnection, generation: number) {
    if (!this.threadId) { const body = await client.request('threads'); this.threadId = body.threads?.[0]?.id ?? 0 }
    const result = await client.request('stackTrace', { threadId: this.threadId, startFrame: 0, levels: 40 })
    if (!this.closed && generation === this.stopGeneration && this.snapshot.state === 'stopped') this.snapshot.frames = result.stackFrames ?? []
  }
  private mergeBreakpointStatus() {
    const combined = new Map<string, DebugSnapshot['breakpoints'][number]>()
    for (const files of this.breakpointStatus.values()) for (const values of files.values()) for (const bp of values) {
      const key = JSON.stringify([bp.file, bp.line]), previous = combined.get(key)
      if (!previous || bp.verified || !previous.verified) combined.set(key, bp)
    }
    this.snapshot.breakpoints = [...combined.values()]
  }
  private async configure(client: DapConnection) {
    if (this.configured.has(client)) return
    this.configured.add(client)
    const capabilities = await this.initialization.get(client)
    await this.sendBreakpoints(client, this.config.breakpoints.map(b => b.file))
    if (capabilities?.supportsConfigurationDoneRequest) await client.request('configurationDone')
  }
  private async sendBreakpoints(client: DapConnection, files: string[]) {
    for (const full of new Set(files.map(file => path.resolve(this.root, file)))) {
      const requested = this.config.breakpoints.filter(b => path.resolve(this.root, b.file) === full && b.enabled)
      const body = await client.request('setBreakpoints', { source: { path: full }, breakpoints: requested.map(b => ({ line: b.line })) })
      this.breakpointStatus.get(client)?.set(full, requested.map((bp, index) => ({ file: full, line: bp.line, actualLine: body.breakpoints?.[index]?.line, id: body.breakpoints?.[index]?.id, verified: Boolean(body.breakpoints?.[index]?.verified), message: body.breakpoints?.[index]?.message })))
      this.mergeBreakpointStatus()
    }
  }
  async start(testOnly = false) {
    if (this.starting || this.snapshot.state !== 'idle') throw new Error('디버거가 이미 실행 중입니다')
    if (this.account) { this.permissionTimer = setInterval(this.recheckPermission, 5000); this.permissionTimer.unref(); accessChanges.on('change', this.recheckPermission) }
    this.starting = true; this.snapshot = { ...idleDebugSnapshot(), id: randomUUID(), state: 'starting' }
    try {
      if (this.config.kind === 'js-debug' && this.config.args[0] && path.resolve(this.root, this.config.args[0]) === path.resolve(jsDebugEntry)) await prepareJsDebugPackage()
      let client: DapConnection
      if (this.config.transport === 'stdio') {
        const process = this.process(this.config.command, this.config.args)
        client = new DapConnection(process.stdout!, process.stdin!)
      } else {
        this.port = this.config.port
        if (this.config.command) {
          const process = this.process(this.config.command, this.config.args)
          if (!this.port) {
            this.port = await new Promise<number>((resolve, reject) => {
              let log = ''
              const timer = setTimeout(() => reject(new Error('어댑터 TCP 포트가 감지되지 않았습니다. 포트 또는 실행 인수를 확인하세요.')), 10000)
              const data = (chunk: Buffer) => {
                log = (log + chunk.toString()).slice(-8192); this.output(chunk.toString())
                const match = /Debug server listening at (?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/.exec(log)
                if (match) { clearTimeout(timer); process.stdout!.off('data', data); resolve(Number(match[1])) }
              }
              process.stdout!.on('data', data)
              process.once('error', error => { clearTimeout(timer); reject(error) })
              process.once('close', (code, signal) => {
                clearTimeout(timer)
                const detail = this.snapshot.output.split('\n').map(line => line.trim()).filter(line => line && line.length <= 1024).slice(-8).join('\n').slice(-2000)
                reject(new Error(`어댑터가 연결 전에 종료되었습니다 (${signal ?? `종료 코드 ${code}`}):${detail ? `\n${detail}` : ' 실행 파일과 인수를 확인하세요.'}`))
              })
            })
          }
          process.stdout!.on('data', chunk => this.output(chunk.toString()))
        }
        if (!this.port) throw new Error('TCP 포트를 지정하세요')
        client = await this.connect(this.port)
      }
      if (this.closed) { client.dispose(); throw new Error(this.snapshot.reason || '디버거가 종료되었습니다') }
      this.wire(client); this.active = client
      await this.initialize(client)
      if (testOnly) { await this.stop(); return }
      const request = client.request(this.config.request, { ...this.config.configuration, __restart: undefined }, 45000)
      await request
      if (this.snapshot.state === 'starting') this.snapshot.state = 'running'
    } catch (error) { this.error(error); throw error }
    finally { this.starting = false }
  }
  async update(config: DebugConfig) {
    const files = [...this.config.breakpoints, ...config.breakpoints].map(b => b.file)
    this.config = config
    for (const client of this.channels.filter(c => this.configured.has(c))) await this.sendBreakpoints(client, files)
  }
  async command(command: string, args: Record<string, unknown> = {}) {
    if (!this.active || this.closed) throw new Error('실행 중인 디버그 세션이 없습니다')
    const commands = ['continue', 'pause', 'next', 'stepIn', 'stepOut', 'scopes', 'variables', 'evaluate', 'threads', 'stackTrace']
    if (!commands.includes(command)) throw new Error('지원하지 않는 디버거 명령')
    if (['scopes', 'variables', 'evaluate', 'next', 'stepIn', 'stepOut', 'continue'].includes(command) && this.snapshot.state !== 'stopped') throw new Error('중단된 세션에서만 사용할 수 있습니다')
    if (command === 'pause' && !this.threadId) { const threads = await this.active.request('threads'); this.threadId = threads.threads?.[0]?.id ?? 0 }
    const result = await this.active.request(command, { threadId: this.threadId, ...args })
    if (['continue', 'next', 'stepIn', 'stepOut'].includes(command) && this.snapshot.state === 'stopped') { ++this.stopGeneration; this.snapshot.state = 'running'; this.snapshot.frames = []; this.snapshot.reason = '' }
    return result
  }
  async stop() {
    if (this.closed) return
    const root = this.channels[0]
    if (root) { try { await root.request('disconnect', { terminateDebuggee: this.config.request === 'launch' }, 1500) } catch { /* always release owned resources */ } }
    this.snapshot.state = 'terminated'; this.snapshot.frames = []; this.cleanup()
  }
  private cleanup() {
    if (this.closed) return
    this.closed = true; ++this.stopGeneration
    clearInterval(this.permissionTimer); accessChanges.off('change', this.recheckPermission)
    for (const channel of this.channels) channel.dispose()
    for (const child of this.processes) {
      if (!child.pid) continue
      try { if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ }
      const timer = setTimeout(() => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid!, 'SIGKILL') } catch { /* already exited */ } }, 1000)
      timer.unref()
    }
  }
}
const sessions = new Map<string, DebugSession>()
const key = (account: string, root: string) => createHash('sha256').update(JSON.stringify([account, root])).digest('hex')
export function debugConfig(account: string, root: string) {
  const stored = readJsonFile<unknown>(path.join(DATA_DIR, `debugger-${key(account, root)}.json`))
  return stored === null ? defaultDebugConfig('js-debug', root) : validateDebugConfig(stored)
}
export async function saveDebugConfig(account: string, root: string, value: unknown) {
  const config = validateDebugConfig(value)
  const session = sessions.get(key(account, root))
  const live = session && ['starting', 'running', 'stopped'].includes(session.snapshot.state)
  const connection = ({ breakpoints: _breakpoints, watches: _watches, ...settings }: DebugConfig) => JSON.stringify(settings)
  if (live && connection(session.config) !== connection(config)) throw new Error('디버그 세션을 종료한 뒤 실행 설정을 변경하세요')
  writeFileAtomic(path.join(DATA_DIR, `debugger-${key(account, root)}.json`), JSON.stringify(config))
  if (live) await session.update(config)
  return config
}
export function debugSession(account: string, root: string) { return sessions.get(key(account, root)) }
export function newDebugSession(account: string, root: string) {
  const id = key(account, root), previous = sessions.get(id)
  if (previous && ['starting', 'running', 'stopped'].includes(previous.snapshot.state)) throw new Error('이 계정의 프로젝트에 이미 디버그 세션이 있습니다')
  if (sessions.size >= 64) {
    for (const [entry, session] of sessions) { if (['idle', 'terminated', 'error'].includes(session.snapshot.state)) sessions.delete(entry); if (sessions.size < 64) break }
    if (sessions.size >= 64) throw new Error('서버 디버그 세션 한도에 도달했습니다')
  }
  const session = new DebugSession(debugConfig(account, root), root, account)
  sessions.set(id, session)
  return session
}
