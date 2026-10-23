export interface TerminalBackend {
  binary: string
  controlArgs(args: string[]): string[]
  commandArgs(name: string, command: string, cwd: string): string[]
  sessionArgs(name: string, cwd: string): string[]
}
