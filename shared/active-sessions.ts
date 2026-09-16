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
}

export interface ActiveMewSessions {
  selfId: string
  sessions: ActiveMewSession[]
}
