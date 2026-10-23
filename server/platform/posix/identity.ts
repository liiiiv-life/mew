import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
export async function processCommandLine(pid: number): Promise<string> {
  try { return (await execute('ps', ['-p', String(pid), '-o', 'args='], { timeout: 3000 })).stdout.trim() } catch { return '' }
}

export async function userProcessCommands(): Promise<string> {
  return (await execute('ps', ['-u', String(process.getuid!()), '-o', 'args='], { timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout
}
