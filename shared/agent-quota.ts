export type QuotaWindow = { remainingPercent: number; windowMinutes: number; resetsAt: string | null; name?: string; secondaryBucket?: boolean }

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {}
const label = (value: string) => [...value].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 100)
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
    for (const [id, value] of Object.entries(buckets)) {
      if (id === (limits.limitId ?? 'codex')) continue
      const bucket = object(value)
      for (const value of [bucket.primary, bucket.secondary]) {
        const row = object(value), previous = windows.length
        add(row.usedPercent, row.windowDurationMins, row.resetsAt)
        if (windows.length > previous) Object.assign(windows[previous], { name: label(String(bucket.limitName ?? id)), secondaryBucket: true })
      }
    }
  } else if (runtime === 'kimi' && data.kind === 'ok') {
    for (const value of [data.summary, ...(Array.isArray(data.limits) ? data.limits : [])]) {
      const row = object(value), window = object(row.window)
      const factor = { minute: 1, hour: 60, day: 1440, week: 10080 }[String(window.unit) as 'minute']
      const used = number(row.used), limit = number(row.limit), duration = number(window.duration)
      if (used !== null && used >= 0 && limit !== null && limit > 0 && duration !== null && factor) {
        const previous = windows.length
        add(used / limit * 100, duration * factor, row.resetAt)
        if (windows.length > previous && typeof row.name === 'string') windows[previous].name = label(row.name)
      }
    }
  } else if (runtime === 'claude') {
    if (data.rate_limits_available === false) return []
    const limits = object(data.rate_limits)
    for (const [key, duration] of [['five_hour', 300], ['seven_day', 10080]] as const) {
      const row = object(limits[key])
      add(row.utilization, duration, row.resets_at)
    }
    for (const [key, value] of Object.entries(limits)) {
      if (!key.startsWith('seven_day_')) continue
      const names: Record<string, string> = { seven_day_opus: 'Opus', seven_day_sonnet: 'Sonnet', seven_day_oauth_apps: 'OAuth apps', seven_day_overage_included: 'Extra usage' }
      const name = names[key] ?? label(key.slice('seven_day_'.length).replaceAll('_', ' '))
      const row = object(value), previous = windows.length
      add(row.utilization, 10080, row.resets_at)
      if (windows.length > previous) Object.assign(windows[previous], { name, secondaryBucket: true })
    }
  }
  return windows
}

export function shortestQuota(windows: QuotaWindow[], now = Date.now()): QuotaWindow | null {
  return windows.filter(w => !w.secondaryBucket && (!w.resetsAt || Date.parse(w.resetsAt) > now))
    .sort((a, b) => a.windowMinutes - b.windowMinutes || a.remainingPercent - b.remainingPercent)[0] ?? null
}
