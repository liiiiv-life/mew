import { processCommandLine as windows } from './windows/identity.ts'
import { processCommandLine as posix } from './posix/identity.ts'
import { userProcessCommands as windowsCommands } from './windows/identity.ts'
import { userProcessCommands as posixCommands } from './posix/identity.ts'
export const processCommandLine = process.platform === 'win32' ? windows : posix
export const userProcessCommands = process.platform === 'win32' ? windowsCommands : posixCommands
