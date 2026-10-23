import * as windows from './windows/storage.ts'
import * as posix from './posix/storage.ts'

const storage = process.platform === 'win32' ? windows : posix
export const hostPaths = storage.hostPaths
export const protectDirectory = storage.protectDirectory
