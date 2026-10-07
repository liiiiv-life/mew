export type DebugAdapterKind = 'js-debug' | 'debugpy' | 'lldb-dap' | 'codelldb' | 'delve' | 'custom'
export interface DebugBreakpoint { file: string; line: number; enabled: boolean; column?: number; condition?: string; hitCondition?: string; logMessage?: string; trigger?: string }
export const breakpointKey = (bp: DebugBreakpoint) => JSON.stringify([bp.file, bp.line, bp.column ?? 0])
export interface DebugFunctionBreakpoint { name: string; enabled: boolean; condition?: string; hitCondition?: string }
export interface DebugDataBreakpoint { dataId: string; description: string; accessType?: 'read' | 'write' | 'readWrite'; condition?: string; hitCondition?: string; enabled: boolean; canPersist?: boolean; connectionId?: string; sessionId?: string }
export interface DebugInstructionBreakpoint { instructionReference: string; offset?: number; condition?: string; hitCondition?: string; enabled: boolean }
export interface DebugProfile { name: string; request: 'launch' | 'attach'; configuration: Record<string, unknown> }
export interface DebugConfig {
  kind: DebugAdapterKind
  transport: 'stdio' | 'tcp'
  command: string
  args: string[]
  port: number
  request: 'launch' | 'attach'
  configuration: Record<string, unknown>
  breakpoints: DebugBreakpoint[]
  watches: string[]
  functionBreakpoints?: DebugFunctionBreakpoint[]
  exceptionFilters?: string[]
  dataBreakpoints?: DebugDataBreakpoint[]
  instructionBreakpoints?: DebugInstructionBreakpoint[]
  profiles?: DebugProfile[]
  compounds?: { name: string; profiles: string[] }[]
  agentBridge?: boolean
}
export interface DebugSource { path?: string; name?: string; sourceReference?: number }
export interface DebugFrame { id: number; name: string; line: number; column?: number; source?: DebugSource; instructionPointerReference?: string; canRestart?: boolean; presentationHint?: 'normal' | 'label' | 'subtle' }
export interface DebugVariable { name: string; value: string; type?: string; variablesReference: number; evaluateName?: string; memoryReference?: string; namedVariables?: number; indexedVariables?: number; presentationHint?: { kind?: string; attributes?: string[]; lazy?: boolean } }
export interface DebugScope { name: string; variablesReference: number; expensive?: boolean; namedVariables?: number; indexedVariables?: number; presentationHint?: string }
export interface DebugThread { id: number; name: string; stopped?: boolean }
export interface DebugHistory { id: number; connectionId: string; time: number; reason: string; frames: DebugFrame[]; variables: { name: string; value: string; type?: string; scope: string }[]; watches: { expression: string; value: string }[] }
export interface DebugConnection { id: string; name: string; state: DebugSnapshot['state']; threadId?: number; capabilities: Record<string, unknown> }
export interface DebugSnapshot {
  id: string | null
  state: 'idle' | 'starting' | 'running' | 'stopped' | 'terminated' | 'error'
  reason: string
  stopRevision?: number
  threadId?: number
  frames: DebugFrame[]
  output: string
  breakpoints: { file: string; line: number; column?: number; verified: boolean; message?: string; id?: number; actualLine?: number; actualColumn?: number; key?: string }[]
  capabilities: Record<string, unknown>
  connectionId?: string
  connections?: DebugConnection[]
  threads?: DebugThread[]
  totalFrames?: number
  history?: DebugHistory[]
  progress?: { id: string; title: string; message?: string; percentage?: number; cancellable?: boolean }[]
  invalidationRevision?: number
  inputProcesses?: { id: number; name: string }[]
  extraBreakpoints?: { kind: 'function' | 'data' | 'instruction'; key: string; verified: boolean; message?: string; id?: number }[]
}
export function defaultDebugConfig(kind: DebugAdapterKind = 'js-debug', root = ''): DebugConfig {
  const presets = {
    'js-debug': { command: 'node', args: [], transport: 'tcp', configuration: { type: 'pwa-node', program: '', cwd: root, console: 'internalConsole' } },
    debugpy: { command: 'python3', args: ['-m', 'debugpy.adapter'], transport: 'stdio', configuration: { type: 'python', program: '', cwd: root, console: 'internalConsole' } },
    'lldb-dap': { command: 'lldb-dap', args: [], transport: 'stdio', configuration: { type: 'lldb', program: '', cwd: root } },
    codelldb: { command: 'codelldb', args: ['--port', '56789'], transport: 'tcp', configuration: { type: 'lldb', program: '', cwd: root } },
    delve: { command: 'dlv', args: ['dap', '--listen=127.0.0.1:56789'], transport: 'tcp', configuration: { type: 'go', mode: 'debug', program: root, cwd: root } },
    custom: { command: '', args: [], transport: 'stdio', configuration: { cwd: root } },
  } as const
  const preset = presets[kind]
  return { kind, command: preset.command, args: [...preset.args], transport: preset.transport, port: kind === 'delve' || kind === 'codelldb' ? 56789 : 0, request: 'launch', configuration: { ...preset.configuration }, breakpoints: [], watches: [] }
}
