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
  /** Client-reported JS heap estimate; not browser RSS or server memory. */
  memory?: { jsHeapBytes: number; reportedAt: number } | null
}

export const SESSION_MEMORY_INTERVAL_MS = 30_000
export const SESSION_MEMORY_MAX_AGE_MS = 90_000

export function validJsHeapBytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export interface ActiveMewSessions {
  selfId: string
  sessions: ActiveMewSession[]
}
