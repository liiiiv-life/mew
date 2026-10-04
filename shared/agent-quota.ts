export type QuotaWindow = { remainingPercent: number; windowMinutes: number; resetsAt: string | null }

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {}
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null
const timestamp = (v: unknown): string | null => {
  const ms = typeof v === 'number' ? v * 1000 : typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null
}

/** Only normalized public quota fields cross the server boundary. Never infer windows from plans. */
export function quotaWindows(runtime: string, input: unknown): QuotaWindow[] {
  const data = object(input)
  const windows: QuotaWindow[] = []
  const add = (used: unknown, minutes: unknown, reset: unknown) => {
    const percent = number(used), duration = number(minutes)
    if (percent === null || percent < 0 || duration === null || duration <= 0) return
    windows.push({ remainingPercent: Math.max(0, Math.min(100, 100 - percent)), windowMinutes: duration, resetsAt: timestamp(reset) })
  }
  if (runtime === 'codex') {
    const buckets = object(data.rateLimitsByLimitId)
    // The legacy view is the active/default Codex bucket; unrelated model buckets must not compete.
    const limits = object(data.rateLimits ?? buckets.codex)
    for (const value of [limits.primary, limits.secondary]) {
      const row = object(value)
      add(row.usedPercent, row.windowDurationMins, row.resetsAt)
    }
  } else if (runtime === 'kimi' && data.kind === 'ok') {
    for (const value of [data.summary, ...(Array.isArray(data.limits) ? data.limits : [])]) {
      const row = object(value), window = object(row.window)
      const factor = { minute: 1, hour: 60, day: 1440, week: 10080 }[String(window.unit) as 'minute']
      const used = number(row.used), limit = number(row.limit), duration = number(window.duration)
      if (used !== null && used >= 0 && limit !== null && limit > 0 && duration !== null && factor) {
        add(used / limit * 100, duration * factor, row.resetAt)
      }
    }
  } else if (runtime === 'claude') {
    if (data.rate_limits_available === false) return []
    const limits = object(data.rate_limits)
    for (const [key, duration] of [['five_hour', 300], ['seven_day', 10080]] as const) {
      const row = object(limits[key])
      add(row.utilization, duration, row.resets_at)
    }
  }
  return windows
}

export function shortestQuota(windows: QuotaWindow[], now = Date.now()): QuotaWindow | null {
  return windows.filter(w => !w.resetsAt || Date.parse(w.resetsAt) > now)
    .sort((a, b) => a.windowMinutes - b.windowMinutes || a.remainingPercent - b.remainingPercent)[0] ?? null
}
