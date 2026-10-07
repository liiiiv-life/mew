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
import { validateDebugCommand } from './debugger-commands.ts'
import { expandDebugConfiguration } from './debugger-profiles.ts'
import { breakpointKey, defaultDebugConfig, type DebugConfig, type DebugSnapshot, type DebugThread } from '../shared/debugger.ts'

export function validateDebugConfig(value: unknown): DebugConfig {
  const v = value as DebugConfig
  if (v?.agentBridge !== undefined && typeof v.agentBridge !== 'boolean') throw new Error('잘못된 에이전트 디버거 설정')
  if (!v || !['js-debug', 'debugpy', 'lldb-dap', 'codelldb', 'delve', 'custom'].includes(v.kind) || !['stdio', 'tcp'].includes(v.transport) || !['launch', 'attach'].includes(v.request)
    || typeof v.command !== 'string' || v.command.length > 4096 || !Array.isArray(v.args) || v.args.length > 64 || v.args.some(x => typeof x !== 'string' || x.length > 4096)
    || !Number.isInteger(v.port) || v.port < 0 || v.port > 65535 || !v.configuration || typeof v.configuration !== 'object' || Array.isArray(v.configuration)
    || !Array.isArray(v.breakpoints) || v.breakpoints.length > 200 || v.breakpoints.some(b => !b || typeof b.file !== 'string' || !b.file || b.file.length > 4096 || b.file.includes('\0') || !Number.isSafeInteger(b.line) || b.line < 1 || typeof b.enabled !== 'boolean'
      || b.column !== undefined && (!Number.isSafeInteger(b.column) || b.column < 1) || ['condition', 'hitCondition', 'logMessage', 'trigger'].some(key => (b as unknown as Record<string, unknown>)[key] !== undefined && (typeof (b as unknown as Record<string, unknown>)[key] !== 'string' || String((b as unknown as Record<string, unknown>)[key]).length > 4096)))
    || !Array.isArray(v.watches) || v.watches.length > 64 || v.watches.some(w => typeof w !== 'string' || !w || w.length > 2048) || JSON.stringify(v.configuration).length > 64000) throw new Error('디버거 설정 형식이 올바르지 않습니다')
  const optionalList = (name: keyof DebugConfig, check: (item: any) => boolean) => {
    const value = v[name]
    if (value !== undefined && (!Array.isArray(value) || value.length > 200 || value.some(item => !check(item)))) throw new Error(`잘못된 ${name} 설정`)
  }
  const string = (value: unknown, max = 4096) => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')
  const conditions = (b: any) => ['condition', 'hitCondition'].every(key => b[key] === undefined || typeof b[key] === 'string' && b[key].length <= 4096)
  optionalList('functionBreakpoints', b => b && string(b.name) && typeof b.enabled === 'boolean' && conditions(b))
  optionalList('exceptionFilters', b => string(b, 128))
  optionalList('dataBreakpoints', b => b && string(b.dataId) && string(b.description) && typeof b.enabled === 'boolean' && conditions(b) && (b.accessType === undefined || ['read', 'write', 'readWrite'].includes(b.accessType)) && (b.canPersist === undefined || typeof b.canPersist === 'boolean') && (b.connectionId === undefined || string(b.connectionId, 128)) && (b.sessionId === undefined || string(b.sessionId, 128)))
  optionalList('instructionBreakpoints', b => b && string(b.instructionReference) && typeof b.enabled === 'boolean' && conditions(b) && (b.offset === undefined || Number.isSafeInteger(b.offset)))
  optionalList('profiles', b => b && string(b.name, 128) && ['launch', 'attach'].includes(b.request) && b.configuration && typeof b.configuration === 'object' && !Array.isArray(b.configuration) && JSON.stringify(b.configuration).length <= 64000)
  optionalList('compounds', b => b && string(b.name, 128) && Array.isArray(b.profiles) && b.profiles.length > 0 && b.profiles.length <= 8 && new Set(b.profiles).size === b.profiles.length && b.profiles.every((name: unknown) => v.profiles?.some(p => p.name === name)))
  if (new Set(v.compounds?.map(c => c.name)).size !== (v.compounds?.length ?? 0) || (v.compounds?.length ?? 0) > 32) throw new Error('잘못된 복합 실행 프로필')
  if ((v.profiles?.length ?? 0) > 32 || JSON.stringify(v).length > 1_000_000) throw new Error('프로필은 최대 32개, 전체 설정은 1MB 이하로 저장하세요')
  const keys = new Set(v.breakpoints.map(breakpointKey))
  if (keys.size !== v.breakpoints.length || new Set(v.profiles?.map(p => p.name)).size !== (v.profiles?.length ?? 0)) throw new Error('중복된 중단점 또는 실행 프로필')
  for (const bp of v.breakpoints) {
    const visited = new Set([breakpointKey(bp)])
    let next = bp.trigger
    while (next) { if (!keys.has(next) || visited.has(next)) throw new Error('중단점 발동 조건이 없거나 순환합니다'); visited.add(next); next = v.breakpoints.find(b => breakpointKey(b) === next)?.trigger }
  }
  return { kind: v.kind, transport: v.transport, command: v.command, args: v.args, port: v.port, request: v.request, configuration: v.configuration, breakpoints: v.breakpoints, watches: v.watches,
    ...(v.functionBreakpoints === undefined ? {} : { functionBreakpoints: v.functionBreakpoints }), ...(v.exceptionFilters === undefined ? {} : { exceptionFilters: v.exceptionFilters }),
    ...(v.dataBreakpoints === undefined ? {} : { dataBreakpoints: v.dataBreakpoints }), ...(v.instructionBreakpoints === undefined ? {} : { instructionBreakpoints: v.instructionBreakpoints }), ...(v.profiles === undefined ? {} : { profiles: v.profiles }), ...(v.compounds === undefined ? {} : { compounds: v.compounds }), ...(v.agentBridge === undefined ? {} : { agentBridge: v.agentBridge }) }
}
export const idleDebugSnapshot = (): DebugSnapshot => ({ id: null, state: 'idle', reason: '', stopRevision: 0, frames: [], output: '', breakpoints: [], capabilities: {} })
interface ChannelState {
  id: string; name: string; state: DebugSnapshot['state']; reason: string; revision: number; threadId: number; threads: DebugThread[]; capabilities: Record<string, unknown>
  frames: Set<number>; variables: Set<number>; sources: Set<number>; scopes: Map<number, string>; frameList: DebugSnapshot['frames']; totalFrames?: number; historyId?: number
  targets: Map<string, Set<number>>; armed: Set<string>; breakpointQueue: Promise<void>; allThreadsStopped?: boolean
  extraBreakpoints: NonNullable<DebugSnapshot['extraBreakpoints']>
  dataInfo: Map<string, { canPersist?: boolean; accessTypes?: string[] }>
  temporary?: { file: string; line: number; column?: number }
}
export class DebugSession {
  snapshot: DebugSnapshot = idleDebugSnapshot()
  private channels: DapConnection[] = []
  private active?: DapConnection
  private processes: ChildProcess[] = []
  private inputProcesses = new Map<number, ChildProcess>()
  private closed = false
  private starting = false
  private port = 0
  private threadId = 0
  private stopGeneration = 0
  private initialization = new Map<DapConnection, Promise<Record<string, any>>>()
  private breakpointStatus = new Map<DapConnection, Map<string, DebugSnapshot['breakpoints']>>()
  private configured = new Set<DapConnection>()
  private channelStates = new Map<DapConnection, ChannelState>()
  private historySequence = 0
  config: DebugConfig
  readonly baseConfig: DebugConfig
  readonly root: string
  readonly account: string | null
  readonly profile: string
  private permissionTimer?: NodeJS.Timeout
  constructor(config: DebugConfig, root: string, account: string | null = null, baseConfig = config, profile = '') { this.config = config; this.baseConfig = baseConfig; this.root = root; this.account = account; this.profile = profile }
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
  private selected(client = this.active) { return client ? this.channelStates.get(client) : undefined }
  private sync() {
    const state = this.selected()
    this.snapshot.connections = [...this.channelStates.values()].map(s => ({ id: s.id, name: s.name, state: s.state, threadId: s.threadId, capabilities: s.capabilities }))
    if (state && !this.closed) { this.snapshot.connectionId = state.id; this.snapshot.capabilities = state.capabilities; this.snapshot.threadId = state.threadId; this.snapshot.threads = state.threads; this.snapshot.frames = state.frameList; this.snapshot.totalFrames = state.totalFrames; this.snapshot.state = state.state; this.snapshot.reason = state.reason; this.snapshot.extraBreakpoints = state.extraBreakpoints }
  }
  private invalidate(client: DapConnection) {
    const state = this.selected(client)!
    state.frames.clear(); state.variables.clear(); state.scopes.clear(); state.targets.clear(); state.frameList = []; ++state.revision
    this.snapshot.invalidationRevision = (this.snapshot.invalidationRevision ?? 0) + 1
  }
  private history(client: DapConnection) { return this.snapshot.history?.find(h => h.id === this.selected(client)?.historyId) }
  private trimHistory() { while ((this.snapshot.history?.length ?? 0) > 32 || JSON.stringify(this.snapshot.history ?? []).length > 2_000_000) this.snapshot.history?.shift() }
  private wire(client: DapConnection, name: string = this.config.kind) {
    this.channels.push(client)
    this.channelStates.set(client, { id: `c${this.channels.length}`, name, state: 'starting', reason: '', revision: 0, threadId: 0, threads: [], capabilities: {}, frames: new Set(), variables: new Set(), sources: new Set(), scopes: new Map(), frameList: [], targets: new Map(), armed: new Set(), breakpointQueue: Promise.resolve(), extraBreakpoints: [], dataInfo: new Map() })
    this.breakpointStatus.set(client, new Map())
    client.onClose = error => {
      if (this.closed) return
      if (client === this.channels[0]) { this.error(error); return }
      const state = this.selected(client)!
      this.invalidate(client); state.state = 'terminated'; state.reason = error.message
      if (this.active === client) this.active = this.channels.find(c => this.selected(c)?.state === 'stopped') ?? this.channels[0]
      this.sync(); this.mergeBreakpointStatus()
    }
    client.onEvent = event => {
      if (this.closed) return
      const body = event.body ?? {}
      const state = this.selected(client)!
      if (event.event === 'initialized') {
        void this.configure(client).catch(error => this.error(error))
      } else if (event.event === 'output') this.output(String(body.output ?? ''))
      else if (event.event === 'stopped') {
        this.active = client; this.threadId = Number(body.threadId ?? 0)
        this.invalidate(client); state.state = 'stopped'; state.reason = String(body.description ?? body.reason ?? ''); state.threadId = this.threadId
        state.allThreadsStopped = body.allThreadsStopped === true
        state.threads = state.threads.map(t => ({ ...t, stopped: body.allThreadsStopped === true || t.id === state.threadId || t.stopped }))
        const generation = ++this.stopGeneration
        this.snapshot.stopRevision = generation
        state.historyId = ++this.historySequence
        this.snapshot.history ??= []; this.snapshot.history.push({ id: state.historyId, connectionId: state.id, time: Date.now(), reason: state.reason, frames: [], variables: [], watches: [] }); this.trimHistory()
        this.sync()
        if (Array.isArray(body.hitBreakpointIds)) {
          const hit = new Set<number>(body.hitBreakpointIds)
          const keys = [...(this.breakpointStatus.get(client)?.values() ?? [])].flat().filter(b => b.id !== undefined && hit.has(b.id)).map(b => b.key)
          let changed = false
          for (const bp of this.config.breakpoints) if (bp.trigger && keys.includes(bp.trigger) && !state.armed.has(breakpointKey(bp))) { state.armed.add(breakpointKey(bp)); changed = true }
          if (changed) void this.sendBreakpoints(client, this.config.breakpoints.map(b => b.file)).catch(error => { state.reason = error.message; this.sync() })
        }
        if (state.temporary) { const file = state.temporary.file; state.temporary = undefined; void this.sendBreakpoints(client, [file]).catch(error => { state.reason = error.message; this.sync() }) }
        void this.inspect(client, generation).catch(error => { if (generation === this.stopGeneration && this.snapshot.state === 'stopped') this.snapshot.reason = error.message })
      } else if (event.event === 'continued') {
        ++this.stopGeneration; this.invalidate(client); state.state = 'running'; state.reason = ''; state.allThreadsStopped = false; state.threads = state.threads.map(t => ({ ...t, stopped: body.allThreadsContinued === false && t.id !== body.threadId ? t.stopped : false })); this.sync()
      } else if (event.event === 'terminated' && client === this.channels[0]) {
        this.snapshot.state = 'terminated'; this.snapshot.frames = []; this.cleanup()
      } else if (event.event === 'terminated') { this.invalidate(client); state.state = 'terminated'; if (this.active === client) this.active = this.channels.find(c => this.selected(c)?.state === 'stopped') ?? this.channels[0]; this.sync()
      } else if (event.event === 'capabilities') { state.capabilities = { ...state.capabilities, ...body.capabilities }; this.sync()
      } else if (event.event === 'thread') { if (body.reason === 'exited') state.threads = state.threads.filter(t => t.id !== body.threadId); else if (!state.threads.some(t => t.id === body.threadId)) state.threads.push({ id: body.threadId, name: `Thread ${body.threadId}` }); this.sync()
      } else if (event.event === 'process') { state.name = String(body.name ?? state.name); this.sync()
      } else if (event.event === 'invalidated' || event.event === 'memory') {
        if (event.event === 'invalidated' && (!body.areas || body.areas.some((area: string) => ['all', 'stacks', 'threads'].includes(area)))) {
          this.invalidate(client); this.snapshot.stopRevision = ++this.stopGeneration; this.sync()
          if (state.state === 'stopped') void this.inspect(client, this.stopGeneration).catch(error => { state.reason = error.message; this.sync() })
        } else { state.variables.clear(); state.scopes.clear(); ++state.revision; this.snapshot.invalidationRevision = (this.snapshot.invalidationRevision ?? 0) + 1 }
      } else if (event.event === 'progressStart') { this.snapshot.progress ??= []; if (this.snapshot.progress.length < 16) this.snapshot.progress.push({ id: String(body.progressId), title: String(body.title), message: body.message, percentage: body.percentage, cancellable: body.cancellable })
      } else if (event.event === 'progressUpdate') { const progress = this.snapshot.progress?.find(p => p.id === body.progressId); if (progress) { progress.message = body.message; progress.percentage = body.percentage }
      } else if (event.event === 'progressEnd') { this.snapshot.progress = this.snapshot.progress?.filter(p => p.id !== body.progressId)
      } else if (event.event === 'breakpoint') {
        const bp = body.breakpoint
        if (!bp) return
        for (const values of this.breakpointStatus.get(client)?.values() ?? []) {
          const previous = values.find(value => bp.id !== undefined ? value.id === bp.id : value.file === bp.source?.path && value.line === bp.line)
          if (previous) { previous.verified = Boolean(bp.verified); previous.message = bp.message; previous.actualLine = bp.line ?? previous.actualLine }
        }
        const extra = state.extraBreakpoints.find(b => b.id !== undefined && b.id === bp.id)
        if (extra) { extra.verified = Boolean(bp.verified); extra.message = bp.message; this.sync() }
        this.mergeBreakpointStatus()
      }
    }
    client.onRequest = async message => {
      const args = message.arguments ?? {}
      if (message.command === 'startDebugging') {
        if (!this.port || this.channels.length >= 16) throw new Error('자식 디버그 세션을 시작할 수 없습니다')
        const child = await this.connect(this.port)
        if (this.closed) { child.dispose(); throw new Error('디버거가 종료되었습니다') }
        this.wire(child, String((args.configuration as Record<string, unknown>)?.name ?? 'Child'))
        await this.initialize(child)
        await child.request(String(args.request ?? 'launch'), args.configuration as Record<string, unknown>, 30000)
        if (this.active === this.channels[0] && this.selected()?.state !== 'stopped') this.active = child
        this.sync()
        return {}
      }
      if (message.command === 'runInTerminal') {
        const argv = args.args
        if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string') || args.argsCanBeInterpretedByShell) throw new Error('셸 해석이 필요한 터미널 요청은 지원하지 않습니다')
        const child = this.process(argv[0], argv.slice(1), typeof args.cwd === 'string' ? args.cwd : this.root, args.env as Record<string, string | null>)
        child.stdin!.on('error', error => this.output(`${error.message}\n`))
        child.stdout!.on('data', data => this.output(data.toString()))
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
        if (child.pid) { this.inputProcesses.set(child.pid, child); this.snapshot.inputProcesses ??= []; this.snapshot.inputProcesses.push({ id: child.pid, name: path.basename(argv[0]) }); child.once('close', () => { this.inputProcesses.delete(child.pid!); this.snapshot.inputProcesses = this.snapshot.inputProcesses?.filter(p => p.id !== child.pid) }) }
        return { processId: child.pid }
      }
      throw new Error(`지원하지 않는 역방향 요청: ${message.command}`)
    }
  }
  private initialize(client: DapConnection) {
    const pending = client.request('initialize', { clientID: 'mew', clientName: 'mew', adapterID: this.config.kind, pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsVariablePaging: true, supportsMemoryReferences: true, supportsProgressReporting: true, supportsInvalidatedEvent: true, supportsStartDebuggingRequest: true, supportsRunInTerminalRequest: true }).then(capabilities => {
      this.selected(client)!.capabilities = capabilities; this.sync()
      return capabilities
    })
    this.initialization.set(client, pending)
    return pending
  }
  private async inspect(client: DapConnection, generation: number) {
    const state = this.selected(client)!, revision = state.revision
    const body = await client.request('threads')
    if (this.closed || state.revision !== revision || state.state !== 'stopped') return
    state.threads = (body.threads ?? []).slice(0, 200).map((t: DebugThread) => ({ ...t, stopped: state.allThreadsStopped || (state.threads.find(old => old.id === t.id)?.stopped ?? t.id === state.threadId) }))
    if (!state.threadId) state.threadId = state.threads[0]?.id ?? 0
    const result = await client.request('stackTrace', { threadId: state.threadId, startFrame: 0, levels: 40 })
    if (!this.closed && state.revision === revision && state.state === 'stopped') { this.remember(client, 'stackTrace', {}, result); if (generation === this.stopGeneration) this.sync() }
  }
  private mergeBreakpointStatus() {
    this.snapshot.breakpoints = [...(this.breakpointStatus.get(this.active ?? this.channels[0])?.values() ?? [])].flat()
  }
  private remember(client: DapConnection, command: string, args: Record<string, unknown>, result: Record<string, any>) {
    const state = this.selected(client)!, history = this.history(client)
    const source = (s: any) => { if (Number.isSafeInteger(s?.sourceReference) && s.sourceReference > 0) state.sources.add(s.sourceReference) }
    const variable = (v: any) => { if (Number.isSafeInteger(v.variablesReference) && v.variablesReference > 0) state.variables.add(v.variablesReference) }
    if (command === 'stackTrace') {
      const frames = (result.stackFrames ?? []).slice(0, 200)
      result.stackFrames = frames
      for (const frame of frames) { state.frames.add(frame.id); source(frame.source) }
      state.frameList = args.startFrame ? [...state.frameList, ...frames].filter((f, i, all) => all.findIndex(g => g.id === f.id) === i).slice(0, 200) : frames
      state.totalFrames = result.totalFrames
      if (history) history.frames = state.frameList.map(f => ({ ...f }))
    } else if (command === 'scopes') {
      result.scopes = (result.scopes ?? []).slice(0, 200)
      for (const scope of result.scopes) { variable(scope); state.scopes.set(scope.variablesReference, `${state.frameList.find(f => f.id === args.frameId)?.name ?? ''} / ${scope.name}`) }
    } else if (command === 'variables') {
      result.variables = (result.variables ?? []).slice(0, 200)
      const scope = state.scopes.get(Number(args.variablesReference)) ?? ''
      for (const v of result.variables) {
        variable(v); if (v.variablesReference > 0) state.scopes.set(v.variablesReference, `${scope}.${v.name}`)
        if (history) { const row = { name: String(v.name).slice(0, 2048), value: String(v.value).slice(0, 4096), type: v.type, scope }; const ix = history.variables.findIndex(old => old.scope === row.scope && old.name === row.name); if (ix >= 0) history.variables[ix] = row; else if (history.variables.length < 400) history.variables.push(row) }
      }
    } else if (['evaluate', 'setVariable', 'setExpression'].includes(command)) {
      variable(result)
      if (history && command === 'evaluate' && args.context === 'watch') { const row = { expression: String(args.expression), value: String(result.result).slice(0, 4096) }, ix = history.watches.findIndex(old => old.expression === row.expression); if (ix >= 0) history.watches[ix] = row; else if (history.watches.length < 64) history.watches.push(row) }
    } else if (command === 'loadedSources') { result.sources = (result.sources ?? []).slice(0, 200); for (const s of result.sources) source(s)
    } else if (command === 'modules') result.modules = (result.modules ?? []).slice(0, 200)
    else if (command === 'stepInTargets' || command === 'gotoTargets') { result.targets = (result.targets ?? []).slice(0, 200); state.targets.set(command === 'stepInTargets' ? 'stepIn' : 'goto', new Set(result.targets.map((t: any) => t.id))) }
    else if (command === 'completions') result.targets = (result.targets ?? []).slice(0, 200)
    else if (command === 'disassemble') result.instructions = (result.instructions ?? []).slice(0, Number(args.instructionCount))
    else if (command === 'source' && (typeof result.content !== 'string' || result.content.length > 512_000)) throw new Error('소스 응답은 512KB 이하 문자열이어야 합니다')
    else if (command === 'readMemory') {
      if (result.data !== undefined && (typeof result.data !== 'string' || result.data.length > 5464 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data) || Buffer.from(result.data, 'base64').length > Number(args.count))) throw new Error('메모리 응답이 요청한 범위를 벗어났습니다')
      if (result.unreadableBytes !== undefined && (!Number.isSafeInteger(result.unreadableBytes) || result.unreadableBytes < 0 || result.unreadableBytes + Buffer.from(result.data ?? '', 'base64').length > Number(args.count))) throw new Error('잘못된 읽을 수 없는 메모리 범위')
    }
    else if (command === 'dataBreakpointInfo' && typeof result.dataId === 'string' && result.dataId) { if (state.dataInfo.size >= 200 && !state.dataInfo.has(result.dataId)) throw new Error('데이터 중단점 조회 한도'); state.dataInfo.set(result.dataId, { canPersist: result.canPersist, accessTypes: result.accessTypes }) }
    if (state.frames.size > 200) state.frames = new Set(state.frameList.map(f => f.id))
    if (state.variables.size > 5000) throw new Error('변수 조회 한도에 도달했습니다. 다시 중단해 조회하세요')
    if (state.sources.size > 2000) throw new Error('소스 참조 한도에 도달했습니다')
    this.trimHistory(); this.mergeBreakpointStatus(); this.sync()
  }
  private checkBreakpoints(client: DapConnection, config = this.config) {
    const caps = this.selected(client)!.capabilities
    for (const bp of [...config.breakpoints, ...config.functionBreakpoints ?? [], ...config.instructionBreakpoints ?? []]) {
      if (!bp.enabled) continue
      if (bp.condition && caps.supportsConditionalBreakpoints !== true) throw new Error('조건 중단점을 지원하지 않는 어댑터입니다')
      if (bp.hitCondition && caps.supportsHitConditionalBreakpoints !== true) throw new Error('횟수 중단점을 지원하지 않는 어댑터입니다')
      if ('logMessage' in bp && bp.logMessage && caps.supportsLogPoints !== true) throw new Error('로그 중단점을 지원하지 않는 어댑터입니다')
    }
    for (const [name, capability] of [['functionBreakpoints', 'supportsFunctionBreakpoints'], ['dataBreakpoints', 'supportsDataBreakpoints'], ['instructionBreakpoints', 'supportsInstructionBreakpoints']] as const) if (config[name]?.some(b => b.enabled) && caps[capability] !== true) throw new Error(`어댑터가 지원하지 않습니다: ${name}`)
    const filters = (caps.exceptionBreakpointFilters as { filter: string }[] | undefined) ?? []
    if (config.exceptionFilters?.some(f => !filters.some(s => s.filter === f))) throw new Error('지원하지 않는 예외 필터')
    for (const bp of config.dataBreakpoints ?? []) {
      if (!bp.enabled || !bp.canPersist && (bp.sessionId !== this.snapshot.id || bp.connectionId !== this.selected(client)!.id)) continue
      const info = this.selected(client)!.dataInfo.get(bp.dataId)
      if (!bp.canPersist && !info || info && (bp.canPersist && !info.canPersist || bp.accessType && info.accessTypes && !info.accessTypes.includes(bp.accessType))) throw new Error('만료되거나 지원하지 않는 데이터 중단점')
    }
  }
  private async configure(client: DapConnection) {
    if (this.configured.has(client)) return
    this.configured.add(client)
    const capabilities = await this.initialization.get(client)
    await this.sendBreakpoints(client, this.config.breakpoints.map(b => b.file))
    await this.sendExtraBreakpoints(client)
    if (capabilities?.supportsConfigurationDoneRequest) await client.request('configurationDone')
  }
  private sendBreakpoints(client: DapConnection, files: string[]) {
    const state = this.selected(client)!
    const next = state.breakpointQueue.catch(() => {}).then(() => this.applyBreakpoints(client, files))
    state.breakpointQueue = next
    return next
  }
  private async applyBreakpoints(client: DapConnection, files: string[]) {
    this.checkBreakpoints(client)
    for (const full of new Set(files.map(file => path.resolve(this.root, file)))) {
      const state = this.selected(client)!
      const requested = this.config.breakpoints.filter(b => path.resolve(this.root, b.file) === full && b.enabled && (!b.trigger || state.armed.has(breakpointKey(b))))
      const breakpoints = requested.map(b => ({ line: b.line, column: b.column, condition: b.condition || undefined, hitCondition: b.hitCondition || undefined, logMessage: b.logMessage || undefined }))
      if (state.temporary && path.resolve(this.root, state.temporary.file) === full) breakpoints.push({ line: state.temporary.line, column: state.temporary.column, condition: undefined, hitCondition: undefined, logMessage: undefined })
      const body = await client.request('setBreakpoints', { source: { path: full }, breakpoints })
      this.breakpointStatus.get(client)?.set(full, requested.map((bp, index) => ({ file: full, line: bp.line, column: bp.column, key: breakpointKey(bp), actualLine: body.breakpoints?.[index]?.line, actualColumn: body.breakpoints?.[index]?.column, id: body.breakpoints?.[index]?.id, verified: Boolean(body.breakpoints?.[index]?.verified), message: body.breakpoints?.[index]?.message })))
      this.mergeBreakpointStatus()
    }
  }
  private async sendExtraBreakpoints(client: DapConnection) {
    this.checkBreakpoints(client)
    const state = this.selected(client)!, caps = state.capabilities
    const send = async (kind: NonNullable<DebugSnapshot['extraBreakpoints']>[number]['kind'], command: string, breakpoints: Record<string, unknown>[], key: string) => {
      const result = await client.request(command, { breakpoints })
      state.extraBreakpoints = [...state.extraBreakpoints.filter(b => b.kind !== kind), ...breakpoints.map((b, i) => ({ kind, key: String(b[key]), verified: Boolean(result.breakpoints?.[i]?.verified), message: result.breakpoints?.[i]?.message, id: result.breakpoints?.[i]?.id }))]
      this.sync()
    }
    if (caps.supportsFunctionBreakpoints === true) await send('function', 'setFunctionBreakpoints', (this.config.functionBreakpoints ?? []).filter(b => b.enabled).map(({ enabled: _enabled, ...b }) => b), 'name')
    if (caps.exceptionBreakpointFilters) await client.request('setExceptionBreakpoints', { filters: this.config.exceptionFilters ?? (caps.exceptionBreakpointFilters as { filter: string; default?: boolean }[]).filter(f => f.default).map(f => f.filter) })
    if (caps.supportsDataBreakpoints === true) await send('data', 'setDataBreakpoints', (this.config.dataBreakpoints ?? []).filter(b => b.enabled && (b.canPersist || b.connectionId === state.id && b.sessionId === this.snapshot.id)).map(({ description: _description, enabled: _enabled, canPersist: _canPersist, connectionId: _connectionId, sessionId: _sessionId, ...b }) => b), 'dataId')
    if (caps.supportsInstructionBreakpoints === true) await send('instruction', 'setInstructionBreakpoints', (this.config.instructionBreakpoints ?? []).filter(b => b.enabled).map(({ enabled: _enabled, ...b }) => b), 'instructionReference')
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
      const request = client.request(this.config.request, { ...expandDebugConfiguration(this.config.configuration, this.root), __restart: undefined }, 45000)
      await request
      if (this.selected(client)!.state === 'starting') this.selected(client)!.state = 'running'
      this.sync()
    } catch (error) { this.error(error); throw error }
    finally { this.starting = false }
  }
  async update(config: DebugConfig) {
    for (const client of this.channels.filter(c => this.configured.has(c))) this.checkBreakpoints(client, config)
    const files = [...this.config.breakpoints, ...config.breakpoints].map(b => b.file)
    const previous = this.config
    this.config = config
    try {
      for (const client of this.channels.filter(c => this.configured.has(c) && this.selected(c)?.state !== 'terminated')) { await this.sendBreakpoints(client, files); await this.sendExtraBreakpoints(client) }
    } catch (error) {
      this.config = previous
      for (const client of this.channels.filter(c => this.configured.has(c) && this.selected(c)?.state !== 'terminated')) {
        try { await this.sendBreakpoints(client, files); await this.sendExtraBreakpoints(client) } catch { this.snapshot.reason = '중단점 복원에 실패했습니다. 세션을 다시 시작하세요.' }
      }
      throw error
    }
  }
  async command(command: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
    if (!this.active || this.closed) throw new Error('실행 중인 디버그 세션이 없습니다')
    const { connectionId, stopRevision, ...input } = args
    const client = connectionId === undefined ? this.active : this.channels.find(c => this.selected(c)?.id === connectionId)
    if (!client || this.selected(client)?.state === 'terminated') throw new Error('디버거 연결이 변경되었습니다')
    const state = this.selected(client)!
    if (stopRevision !== undefined && stopRevision !== this.snapshot.stopRevision) throw new Error('중단 시점이 변경되었습니다. 다시 조회하세요')
    if (command === 'input') {
      if (Object.keys(input).some(k => !['processId', 'text', 'end'].includes(k)) || !Number.isSafeInteger(input.processId) || typeof input.text !== 'string' || input.text.length > 4096 || input.end !== undefined && typeof input.end !== 'boolean') throw new Error('잘못된 프로그램 입력')
      const child = this.inputProcesses.get(Number(input.processId))
      if (!child?.stdin?.writable || child.stdin.writableEnded) throw new Error('입력 가능한 프로그램이 없습니다')
      await new Promise<void>((resolve, reject) => child.stdin!.write(input.text, error => error ? reject(error) : resolve()))
      if (input.end) { child.stdin.end(); this.snapshot.inputProcesses = this.snapshot.inputProcesses?.filter(p => p.id !== input.processId) }
      return { ok: true }
    }
    if (command === 'selectConnection') {
      if (Object.keys(input).length) throw new Error('잘못된 연결 선택')
      this.active = client; this.snapshot.stopRevision = ++this.stopGeneration; this.sync(); this.mergeBreakpointStatus()
      if (state.state === 'stopped') await this.inspect(client, this.stopGeneration)
      return this.snapshot
    }
    if (command === 'selectThread') {
      if (Object.keys(input).some(k => k !== 'threadId') || !Number.isSafeInteger(input.threadId) || !state.threads.some(t => t.id === input.threadId)) throw new Error('알 수 없는 스레드')
      this.active = client; this.invalidate(client); state.threadId = Number(input.threadId); state.state = state.threads.find(t => t.id === state.threadId)?.stopped ? 'stopped' : 'running'; this.snapshot.stopRevision = ++this.stopGeneration; this.sync()
      if (state.state === 'stopped') await this.inspect(client, this.stopGeneration)
      return this.snapshot
    }
    if (command === 'runTo') {
      if (state.state !== 'stopped' || Object.keys(input).some(k => !['file', 'line', 'column'].includes(k)) || typeof input.file !== 'string' || !input.file || input.file.length > 4096 || !Number.isSafeInteger(input.line) || Number(input.line) < 1 || input.column !== undefined && (!Number.isSafeInteger(input.column) || Number(input.column) < 1)) throw new Error('실행할 소스 위치를 입력하세요')
      state.temporary = { file: input.file, line: Number(input.line), column: input.column as number | undefined }
      await this.sendBreakpoints(client, [input.file]); return this.command('continue', { connectionId: state.id })
    }
    if (command === 'pause' && !state.threadId) { const threads = await client.request('threads'); state.threads = threads.threads ?? []; state.threadId = threads.threads?.[0]?.id ?? 0 }
    const validated = validateDebugCommand(command, input, { state: state.state, capabilities: state.capabilities, frames: state.frames, variables: state.variables, sources: state.sources })
    if (validated.frameId !== undefined && state.frameList.find(f => f.id === validated.frameId)?.presentationHint === 'label') throw new Error('호출 경로 라벨은 평가할 수 없습니다')
    if (validated.threadId !== undefined && !state.threads.some(t => t.id === validated.threadId)) throw new Error('알 수 없는 스레드')
    if (validated.threadId !== undefined && validated.threadId !== state.threadId) throw new Error('먼저 사용할 스레드를 선택하세요')
    if (validated.targetId !== undefined && !state.targets.get(command)?.has(Number(validated.targetId))) throw new Error('만료된 실행 대상입니다')
    if (command === 'restartFrame' && state.frameList.find(f => f.id === input.frameId)?.canRestart === false) throw new Error('이 프레임은 재시작할 수 없습니다')
    if (command === 'cancel' && !this.snapshot.progress?.some(p => p.id === input.progressId && p.cancellable)) throw new Error('취소할 수 없는 작업입니다')
    if (typeof (validated.source as Record<string, unknown> | undefined)?.path === 'string') validated.source = { ...validated.source as object, path: path.resolve(this.root, String((validated.source as Record<string, unknown>).path)) }
    const revision = state.revision
    const result = await client.request(command, { ...(['continue', 'pause', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'stackTrace', 'exceptionInfo', 'goto'].includes(command) ? { threadId: state.threadId } : {}), ...validated })
    const resumes = ['continue', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'goto', 'restart', 'restartFrame'].includes(command)
    if (resumes) {
      if (state.revision === revision) { ++this.stopGeneration; this.invalidate(client); state.state = 'running'; state.reason = ''; state.allThreadsStopped = false; state.threads = state.threads.map(t => ({ ...t, stopped: validated.singleThread && t.id !== state.threadId ? t.stopped : false })); this.sync() }
    } else {
      if (state.revision !== revision && !['cancel', 'threads', 'pause', 'setVariable', 'setExpression', 'writeMemory'].includes(command)) throw new Error('중단 시점이 변경되었습니다. 다시 조회하세요')
      if (command === 'threads') state.threads = (result.threads ?? []).slice(0, 200).map((t: DebugThread) => ({ ...t, stopped: state.threads.find(s => s.id === t.id)?.stopped ?? (t.id === state.threadId && state.state === 'stopped') }))
      this.remember(client, command, validated, result)
      if (['setVariable', 'setExpression', 'writeMemory'].includes(command)) { state.variables.clear(); state.scopes.clear(); ++state.revision; this.snapshot.invalidationRevision = (this.snapshot.invalidationRevision ?? 0) + 1 }
    }
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
    for (const state of this.channelStates.values()) { state.frames.clear(); state.variables.clear(); state.sources.clear(); state.targets.clear(); state.state = 'terminated' }
    this.snapshot.connections = [...this.channelStates.values()].map(s => ({ id: s.id, name: s.name, state: s.state, capabilities: s.capabilities }))
    this.snapshot.progress = []
    this.snapshot.inputProcesses = []; this.inputProcesses.clear()
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
const sessions = new Map<string, DebugSession[]>()
const selections = new Map<string, string>()
const key = (account: string, root: string) => createHash('sha256').update(JSON.stringify([account, root])).digest('hex')
export function debugConfig(account: string, root: string) {
  const stored = readJsonFile<unknown>(path.join(DATA_DIR, `debugger-${key(account, root)}.json`))
  return stored === null ? defaultDebugConfig('js-debug', root) : validateDebugConfig(stored)
}
const configWrites = new Map<string, Promise<DebugConfig>>()
export function saveDebugConfig(account: string, root: string, value: unknown): Promise<DebugConfig> {
  const id = key(account, root)
  const previous = configWrites.get(id)?.catch(() => {}) ?? Promise.resolve()
  const next = previous.then(() => persistDebugConfig(account, root, value)).finally(() => { if (configWrites.get(id) === next) configWrites.delete(id) })
  configWrites.set(id, next); return next
}
async function persistDebugConfig(account: string, root: string, value: unknown) {
  const config = validateDebugConfig(value)
  const live = debugSessions(account, root).filter(s => ['starting', 'running', 'stopped'].includes(s.snapshot.state))
  const connection = ({ breakpoints: _breakpoints, watches: _watches, functionBreakpoints: _function, exceptionFilters: _exception, dataBreakpoints: _data, instructionBreakpoints: _instruction, agentBridge: _agentBridge, ...settings }: DebugConfig) => JSON.stringify(settings)
  if (live.some(session => connection(session.baseConfig) !== connection(config))) throw new Error('디버그 세션을 종료한 뒤 실행 설정을 변경하세요')
  const updated: { session: DebugSession; previous: DebugConfig }[] = []
  try { for (const session of live) { const previous = session.config; await session.update({ ...config, configuration: previous.configuration, request: previous.request, dataBreakpoints: [...config.dataBreakpoints?.filter(b => b.canPersist || b.sessionId === session.snapshot.id) ?? [], ...previous.dataBreakpoints?.filter(b => !b.canPersist && b.sessionId === session.snapshot.id && session !== debugSession(account, root)) ?? []] }); updated.push({ session, previous }) } }
  catch (error) { await Promise.allSettled(updated.map(({ session, previous }) => session.update(previous))); throw error }
  const persisted = { ...config, ...(config.dataBreakpoints ? { dataBreakpoints: config.dataBreakpoints.filter(b => b.canPersist) } : {}) }
  writeFileAtomic(path.join(DATA_DIR, `debugger-${key(account, root)}.json`), JSON.stringify(persisted))
  return config
}
export function debugSessions(account: string, root: string) { return sessions.get(key(account, root)) ?? [] }
export function debugSession(account: string, root: string, sessionId?: string) { const group = debugSessions(account, root); return sessionId === undefined ? group.find(s => s.snapshot.id === selections.get(key(account, root))) ?? group.at(-1) : group.find(s => s.snapshot.id === sessionId) }
export function selectDebugSession(account: string, root: string, sessionId: string) { const selected = debugSession(account, root, sessionId); if (!selected) throw new Error('디버그 세션이 변경되었습니다'); selections.set(key(account, root), sessionId); return selected }
export function newDebugSession(account: string, root: string, profile?: string, additional = false) {
  const id = key(account, root), group = debugSessions(account, root), live = group.filter(s => ['starting', 'running', 'stopped'].includes(s.snapshot.state))
  if (live.length && !additional) throw new Error('이 계정의 프로젝트에 이미 디버그 세션이 있습니다')
  if (live.length >= 8) throw new Error('프로젝트당 최대 8개 세션을 실행할 수 있습니다')
  for (const [entry, group] of sessions) { const current = group.filter(s => ['starting', 'running', 'stopped'].includes(s.snapshot.state)); if (!current.length && entry !== id) { sessions.delete(entry); selections.delete(entry) } }
  if ([...sessions.values()].reduce((n, group) => n + group.filter(s => ['starting', 'running', 'stopped'].includes(s.snapshot.state)).length, 0) >= 64) throw new Error('서버 디버그 세션 한도에 도달했습니다')
  const base = debugConfig(account, root), selected = profile ? base.profiles?.find(p => p.name === profile) : undefined
  if (profile && !selected) throw new Error('실행 프로필을 찾을 수 없습니다')
  const session = new DebugSession(selected ? { ...base, configuration: selected.configuration, request: selected.request } : base, root, account, base, profile)
  sessions.set(id, [...live, session]); selections.delete(id)
  return session
}
export async function startDebugCompound(account: string, root: string, name: string) {
  const compound = debugConfig(account, root).compounds?.find(c => c.name === name)
  if (!compound) throw new Error('복합 실행 프로필을 찾을 수 없습니다')
  if (debugSessions(account, root).filter(s => ['starting', 'running', 'stopped'].includes(s.snapshot.state)).length + compound.profiles.length > 8) throw new Error('프로젝트당 최대 8개 세션을 실행할 수 있습니다')
  const created: DebugSession[] = []
  try { for (const profile of compound.profiles) { const session = newDebugSession(account, root, profile, true); created.push(session); await session.start() } return created.map(s => s.snapshot) }
  catch (error) { await Promise.allSettled(created.map(s => s.stop())); throw error }
}
