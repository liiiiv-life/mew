import type { ChildProcess, SpawnOptions } from 'node:child_process'

export type HostFamily = 'windows' | 'posix'
export interface HostPaths { config: string; data: string; cache: string; state: string }
export interface HostProcesses {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess
  groupAlive(pid: number): boolean
  stopGroup(pid: number, signal?: NodeJS.Signals): void
}
