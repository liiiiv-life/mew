import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

export function ipcEndpoint(file: string): string {
  const digest = createHash('sha256').update(`${os.userInfo().username}\0${path.win32.resolve(file).toLowerCase()}`).digest('hex')
  return `\\\\.\\pipe\\mew-${digest}`
}
export function removeEndpoint(_endpoint: string): void { /* Named pipes are released by Windows. */ }
