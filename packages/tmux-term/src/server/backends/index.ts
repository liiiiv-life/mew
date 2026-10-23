import { tmuxBackend } from './tmux.ts'
import { psmuxBackend } from './psmux.ts'
export const terminalBackend = process.platform === 'win32' ? psmuxBackend : tmuxBackend
