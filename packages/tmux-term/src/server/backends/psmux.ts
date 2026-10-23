import path from 'node:path'
import type { TerminalBackend } from './contracts.ts'
export function windowsShell(): string {
  return path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}
export const quotePowerShell = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export const encodedCommand = (script: string) => ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
export const psmuxBackend: TerminalBackend = {
  get binary() { return process.env.MEW_MULTIPLEXER || 'psmux.exe' },
  controlArgs: args => process.env.MEW_MULTIPLEXER_NAMESPACE ? ['-L', process.env.MEW_MULTIPLEXER_NAMESPACE, ...args] : args,
  sessionArgs: (name, cwd) => ['new-session', '-d', '-s', name, '-c', cwd, '--', windowsShell(), '-NoLogo', '-NoExit'],
  commandArgs: (name, command, cwd) => ['new-session', '-d', '-s', name, '-c', cwd, '--', windowsShell(), ...encodedCommand(command)],
}
