import * as posix from './posix.mjs'
import * as windows from './windows.mjs'
export const hostPaths = process.platform === 'win32' ? windows.hostPaths : posix.hostPaths
export { windowsEnvironment, browserArgs } from './windows.mjs'
