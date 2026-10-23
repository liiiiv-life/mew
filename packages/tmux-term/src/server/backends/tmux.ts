import type { TerminalBackend } from './contracts.ts'
export const tmuxBackend: TerminalBackend = {
  get binary() { return process.env.MEW_MULTIPLEXER || 'tmux' },
  controlArgs: args => process.env.MEW_MULTIPLEXER_NAMESPACE ? ['-L', process.env.MEW_MULTIPLEXER_NAMESPACE, ...args] : args,
  sessionArgs: (name, cwd) => ['new-session', '-d', '-s', name, '-c', cwd],
  commandArgs: (name, command, cwd) => ['new-session', '-d', '-s', name, '-c', cwd, '/bin/sh', '-c', command],
}
