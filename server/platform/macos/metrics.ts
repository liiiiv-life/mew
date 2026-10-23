import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProcStat } from '../../sysStats.ts'
const run = promisify(execFile)
export function parsePsProcesses(stdout: string, gpuMem: Map<number, number>, cores: number): ProcStat[] {
  const out: ProcStat[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const match = /^\s*(\d+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    const cpu = Number(match[2])
    const rssKb = Number(match[3])
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(cpu) || !Number.isFinite(rssKb)) continue
    const comm = match[4] ?? ''
    const command = (match[5] ?? '').replace(/[\p{Cc}]+/gu, ' ').trim()
    const name = path.basename(comm) || command.split(/\s+/, 1)[0] || String(pid)
    out.push({
      pid,
      name,
      cmd: command.slice(0, 200),
      cpu: Math.min(cores * 100, Math.max(0, cpu)),
      memMb: Math.max(0, rssKb / 1024),
      gpuMemMb: gpuMem.get(pid) ?? 0,
    })
  }
  return out.sort((a, b) => b.cpu - a.cpu)
}

export async function macProcesses(gpuMem: Map<number, number>, cores: number): Promise<ProcStat[]> {
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,pcpu=,rss=,comm=,command='], { timeout: 3000, maxBuffer: 1024 * 1024 })
    return parsePsProcesses(stdout, gpuMem, cores)
  } catch {
    return []
  }
}
