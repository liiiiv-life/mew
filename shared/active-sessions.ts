/** Public presence identity, never an authentication/session-cookie identifier. */
export interface ActiveMewSession {
  id: string
  email: string | null
  displayName: string | null
  browser: string | null
  device: string | null
  connectedAt: number
  workspaceLabel: string | null
  project: string | null
  path: string | null
  visible: boolean
  /** Work currently running in this browser session; null when unreported or stale. */
  agents?: { running: number; reportedAt: number } | null
}

export const SESSION_ACTIVITY_INTERVAL_MS = 30_000
export const SESSION_ACTIVITY_MAX_AGE_MS = 90_000

export function validRunningAgentCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export interface ActiveMewSessions {
  selfId: string
  sessions: ActiveMewSession[]
}

/** A state interval clipped to the requested local day/time range. */
export interface MewSessionRecord extends ActiveMewSession {
  recordId: number
  startedAt: number
  endedAt: number
  disconnectedAt: number | null
}

export interface MewSessionHistory {
  records: MewSessionRecord[]
  people: { email: string | null; displayName: string | null }[]
  recordedSince: number
  generatedAt: number
}

export interface SessionHistoryFilter { day: string; fromHour: number; toHour: number; person: string }
export function sessionHistoryBounds(filter: SessionHistoryFilter) {
  const [year, month, day] = filter.day.split('-').map(Number)
  const at = (hour: number) => new Date(year, month - 1, day, hour).getTime()
  return { dayFrom: at(0), dayTo: at(24), from: at(filter.fromHour), to: at(filter.toHour) }
}

/** A DST clock jump can make adjacent wall-clock hours coincide. Keep filter ranges nonempty. */
export function normalizeSessionHistoryFilter(filter: SessionHistoryFilter): SessionHistoryFilter {
  const next = { ...filter }
  for (let attempts = 0; attempts < 24; attempts++) {
    const range = sessionHistoryBounds(next)
    if (range.from < range.to) break
    if (next.toHour < 24) next.toHour += 1
    else if (next.fromHour > 0) next.fromHour -= 1
    else break
  }
  return next
}
