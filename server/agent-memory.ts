import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const MIB = 1024 ** 2
const SLICE = 'mew-agents.slice'
export type MemoryBudget = { source: string; total: number; available: number }
export type MemoryReader = () => MemoryBudget[]
type Slice = { group: string; max: number }
let cached: { until: number; slice: Slice | null } | undefined
let warned = false

/** Only opt into a configured finite limit; systemd synthesizes unlimited slices on lookup. */
function memorySlice(): Slice | null {
  if (process.platform !== 'linux' || process.env.MEW_AGENT_MEMORY_SCOPE === 'off') return null
  if (cached && cached.until > Date.now()) return cached.slice
  let slice: Slice | null = null
  try {
    const out = execFileSync('systemctl', ['--user', 'show', SLICE, '-p', 'MemoryMax', '-p', 'ControlGroup'], {
      encoding: 'utf8', timeout: 1_000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    const max = Number(/^MemoryMax=(.+)$/m.exec(out)?.[1])
    const group = /^ControlGroup=(.+)$/m.exec(out)?.[1]
    if (Number.isFinite(max) && max > 0 && group?.startsWith('/') && !group.split('/').includes('..')) {
      slice = { max, group: path.join('/sys/fs/cgroup', group) }
    }
  } catch { /* no user manager: availability guard still works */ }
  cached = { slice, until: Date.now() + 30_000 }
  return slice
}

export function memoryScopeCommand(cmd: string, args: string[]): { cmd: string; args: string[]; scoped: boolean; unit?: string } {
  const slice = memorySlice()
  if (!slice) {
    if (process.env.MEW_AGENT_MEMORY_SCOPE === 'required') throw new Error('에이전트 OS 메모리 제한을 준비하지 못했습니다. mew-agents.slice 설치·시작 상태를 확인하세요.')
    if (!warned && process.platform === 'linux' && process.env.MEW_AGENT_MEMORY_SCOPE !== 'off') {
      warned = true
      console.error('[mew:agent-memory] OS 메모리 한도 미적용: mew-agents.slice를 설치하세요. Linux 가용 메모리 감시만 적용합니다.')
    }
    return { cmd, args, scoped: false }
  }
  const unit = `mew-agent-${crypto.randomUUID()}.scope`
  return {
    cmd: 'systemd-run',
    args: ['--user', '--scope', '--quiet', '--collect', '--expand-environment=no', `--slice=${SLICE}`,
      `--unit=${unit}`, '--property=OOMPolicy=kill', '--', cmd, ...args],
    scoped: true,
    unit,
  }
}

/** Covers descendants that created their own process group; never targets the shared slice. */
export function killMemoryScope(unit: string | undefined, signal: NodeJS.Signals) {
  if (!unit) return
  try {
    execFileSync('systemctl', ['--user', 'kill', '--kill-whom=all', `--signal=${signal}`, unit], {
      timeout: 1_000, stdio: 'ignore',
    })
  } catch { /* scope may already be collected, or the launcher has not joined it yet */ }
}

export function parseHostMemory(text: string): MemoryBudget | null {
  const total = Number(/^MemTotal:\s+(\d+) kB$/m.exec(text)?.[1]) * 1024
  const available = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(text)?.[1]) * 1024
  return total > 0 && Number.isFinite(available) && available >= 0
    ? { source: '호스트', total, available: Math.min(total, available) } : null
}

export const readAgentMemory: MemoryReader = () => {
  if (process.platform !== 'linux') return []
  const budgets: MemoryBudget[] = []
  const host = parseHostMemory(fs.readFileSync('/proc/meminfo', 'utf8'))
  if (!host) throw new Error('Linux 가용 메모리를 읽지 못했습니다')
  budgets.push(host)
  const slice = memorySlice()
  if (slice) {
    // Inactive file cache is reclaimable; do not stop work merely for a warm page cache.
    const current = Number(fs.readFileSync(path.join(slice.group, 'memory.current'), 'utf8'))
    const stat = fs.readFileSync(path.join(slice.group, 'memory.stat'), 'utf8')
    const inactive = Number(/^inactive_file (\d+)$/m.exec(stat)?.[1] ?? 0)
    if (!Number.isFinite(current)) throw new Error('에이전트 메모리 사용량을 읽지 못했습니다')
    budgets.push({ source: '에이전트 합산 한도', total: slice.max, available: Math.max(0, Math.min(slice.max, slice.max - current + inactive)) })
  }
  return budgets
}

/** Hysteresis: stop at 10% (at least 512 MiB); explicit resume needs 20% (at least 1 GiB). */
export function memoryPressure(budgets: MemoryBudget[], resuming = false): string | null {
  for (const budget of budgets) {
    const threshold = Math.min(budget.total * 0.4, Math.max((resuming ? 1024 : 512) * MIB, budget.total * (resuming ? 0.2 : 0.1)))
    if (budget.available <= threshold) {
      return `${budget.source} 메모리 부족: 가용 ${Math.round(budget.available / MIB)} MiB / ${Math.round(budget.total / MIB)} MiB (필요 여유 ${Math.round(threshold / MIB)} MiB)`
    }
  }
  return null
}
