import { spawn as nativeSpawn } from 'node:child_process'
import type { HostProcesses } from '../contracts.ts'

export const processes: HostProcesses = {
  spawn: nativeSpawn,
  groupAlive(pid) { try { process.kill(-pid, 0); return true } catch { return false } },
  stopGroup(pid, signal = 'SIGTERM') {
    try { process.kill(-pid, signal) } catch { try { process.kill(pid, signal) } catch { /* already exited */ } }
  },
}
