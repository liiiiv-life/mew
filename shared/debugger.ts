export type DebugAdapterKind = 'js-debug' | 'debugpy' | 'lldb-dap' | 'codelldb' | 'delve' | 'custom'
export interface DebugConfig {
  kind: DebugAdapterKind
  transport: 'stdio' | 'tcp'
  command: string
  args: string[]
  port: number
  request: 'launch' | 'attach'
  configuration: Record<string, unknown>
  breakpoints: { file: string; line: number; enabled: boolean }[]
  watches: string[]
}
export interface DebugFrame { id: number; name: string; line: number; source?: { path?: string; name?: string } }
export interface DebugVariable { name: string; value: string; type?: string; variablesReference: number; evaluateName?: string }
export interface DebugSnapshot {
  id: string | null
  state: 'idle' | 'starting' | 'running' | 'stopped' | 'terminated' | 'error'
  reason: string
  stopRevision?: number
  threadId?: number
  frames: DebugFrame[]
  output: string
  breakpoints: { file: string; line: number; verified: boolean; message?: string; id?: number; actualLine?: number }[]
  capabilities: Record<string, unknown>
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
