import type { AgentEvent } from './agentFold.ts'

export type NoticeKind = 'complete' | 'stopped' | 'error' | 'permission' | 'connection' | 'cpu' | 'memory' | 'gpu' | 'temperature' | 'test'
export type NoticeLevel = 'success' | 'warning' | 'danger'
export interface NoticeInput {
  key: string
  kind: NoticeKind
  level: NoticeLevel
  source: string
  target?: { tabId: string; cwd: string; workspacePath?: string } | 'system'
}

/** Consume live events only. Replays restore the conversation, never announce old work. */
export function createAgentNoticeTracker(source: string, target: { tabId: string; cwd: string; workspacePath?: string }) {
  let failed = false
  let completed = false
  let turn = 0
  const notice = (kind: NoticeKind, level: NoticeLevel, suffix = String(turn)): NoticeInput => ({
    key: `${target.cwd}:${target.tabId}:${kind}:${suffix}`, kind, level, source, target,
  })
  return (event: AgentEvent): NoticeInput | null => {
    if (event.type === 'replay' || event.type === 'reset' || event.type === 'turn_start') {
      failed = false
      completed = false
      turn += 1
    }
    if (event.type === 'permission') return notice('permission', 'warning', event.id)
    if (event.type === 'error' || event.type === 'fatal' || (event.type === 'auth' && event.error) || (event.type === 'turn_end' && event.stopReason === 'error')) {
      completed = false
      if (failed) return null
      failed = true
      return notice('error', 'danger')
    }
    if (event.type === 'turn_end') {
      completed = !failed && event.stopReason === 'end_turn'
      if (!failed && event.stopReason !== 'end_turn' && event.stopReason !== 'cancelled') return notice('stopped', 'warning')
    }
    // The server publishes meta after draining the queue. Intermediate turns must not announce "all done".
    if (event.type === 'meta' && completed && !event.meta.busy && event.meta.queued.length === 0 && !event.meta.activeTask) {
      completed = false
      return notice('complete', 'success')
    }
    return null
  }
}

export interface ResourceSample {
  cpu: { usage: number | null; temperature: number | null }
  memory: { total: number; available: number }
  gpus: { memoryUsedMb: number | null; memoryTotalMb: number | null; temperature: number | null }[]
}

/** Three consecutive 15s samples; recovery hysteresis prevents repeat alarms near a threshold. */
export function createResourceNoticeTracker() {
  const state = new Map<string, { count: number; raised: boolean }>()
  return (sample: ResourceSample | null): NoticeInput[] => {
    if (!sample) {
      for (const entry of state.values()) entry.count = 0
      return []
    }
    const percent = (used: number | null, total: number | null) => used !== null && total !== null && total > 0 ? used / total * 100 : null
    const values: [NoticeKind, number | null, number, number][] = [
      ['cpu', sample.cpu.usage, 90, 75],
      ['memory', percent(sample.memory.total - sample.memory.available, sample.memory.total), 90, 80],
      ['gpu', sample.gpus.reduce<number | null>((max, gpu) => {
        const value = percent(gpu.memoryUsedMb, gpu.memoryTotalMb)
        return value === null ? max : Math.max(max ?? 0, value)
      }, null), 95, 85],
      ['temperature', [sample.cpu.temperature, ...sample.gpus.map(gpu => gpu.temperature)]
        .reduce<number | null>((max, value) => value === null ? max : Math.max(max ?? 0, value), null), 90, 80],
    ]
    const notices: NoticeInput[] = []
    for (const [kind, value, high, low] of values) {
      const entry = state.get(kind) ?? { count: 0, raised: false }
      if (value === null || !Number.isFinite(value)) entry.count = 0
      else if (value < low) { entry.count = 0; entry.raised = false }
      else if (value >= high) {
        entry.count += 1
        if (entry.count >= 3 && !entry.raised) {
          entry.raised = true
          notices.push({ key: `system:${kind}`, kind, level: 'warning', source: `${Math.round(value)}${kind === 'temperature' ? '°C' : '%'}`, target: 'system' })
        }
      } else entry.count = 0
      state.set(kind, entry)
    }
    return notices
  }
}
