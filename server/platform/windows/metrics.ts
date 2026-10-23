import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { powershell, encodedPowerShell } from './storage.ts'
import type { ProcStat } from '../../sysStats.ts'
const exec = promisify(execFile)
let previous = new Map<number, { time: number; cpu: number }>()

export function windowsProcessStats(rows: { ProcessId: number; Name: string; CommandLine?: string; WorkingSetSize: number; KernelModeTime: number; UserModeTime: number }[], gpu: Map<number, number>, now = Date.now()): ProcStat[] {
  const next = new Map<number, { time: number; cpu: number }>()
  const values = rows.filter(row => row.ProcessId > 0).map(row => {
    const cpu = (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 10_000, prior = previous.get(row.ProcessId)
    next.set(row.ProcessId, { time: now, cpu })
    return { pid: row.ProcessId, name: row.Name, cmd: (row.CommandLine || row.Name).replace(/[\p{Cc}]+/gu, ' ').slice(0, 200), cpu: prior && now > prior.time ? Math.max(0, (cpu - prior.cpu) * 100 / (now - prior.time)) : 0, memMb: Number(row.WorkingSetSize) / 1048576, gpuMemMb: gpu.get(row.ProcessId) ?? 0 }
  })
  previous = next
  return values.sort((a, b) => b.cpu - a.cpu)
}
export async function processes(gpu: Map<number, number>): Promise<ProcStat[]> {
  try {
    const script = '@(Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime) | ConvertTo-Json -Compress'
    const { stdout } = await exec(powershell(), encodedPowerShell(script), { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 })
    return windowsProcessStats(JSON.parse(stdout), gpu)
  } catch { return [] }
}
