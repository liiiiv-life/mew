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
