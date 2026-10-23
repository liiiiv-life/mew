import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn as nativeSpawn, type SpawnOptions } from 'node:child_process'
import crossSpawn from 'cross-spawn'
import type { HostProcesses } from '../contracts.ts'

export function windowsEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const normalized: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) normalized[key.toUpperCase()] = value
  return normalized
}
export function processHostPath(): string {
  return process.env.MEW_WINDOWS_PROCESS_HOST || path.resolve(import.meta.dirname, '../../../native/windows/process-host.exe')
}
export const processes: HostProcesses = {
  spawn(command, args, options) {
    const env = windowsEnvironment(options.env)
    // A Job Object ties every descendant to this helper, including abrupt termination.
    // cross-spawn handles npm .cmd shims before Windows CreateProcess receives argv.
    const parsed = (crossSpawn as typeof crossSpawn & { _parse(command: string, args: string[], options: SpawnOptions): { command: string; args: string[]; options: SpawnOptions } })._parse(command, args, { ...options, env })
    const helper = env.MEW_WINDOWS_PROCESS_HOST || processHostPath()
    if (!fs.existsSync(helper)) throw new Error('Windows 프로세스 도우미가 없습니다. 사전 빌드 실행본 또는 Windows 릴리스 빌드를 사용하세요.')
    return nativeSpawn(helper, [...(parsed.options.windowsVerbatimArguments ? ['--verbatim'] : []), ...(!options.detached ? ['--parent-pid', String(process.pid)] : []), parsed.command, ...parsed.args], { ...parsed.options, windowsHide: true, windowsVerbatimArguments: false })
  },
  groupAlive(pid) { try { process.kill(pid, 0); return true } catch { return false } },
  stopGroup(pid) {
    // Killing the job's owner closes its handle; Windows then kills descendants too.
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  },
}
