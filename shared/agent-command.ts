export type AgentCommandScope = { runtime: string; cwd: string; sessionId: string }

export type AgentCommandRecord = AgentCommandScope & {
  id: string
  tab: string
  command: string
  /** Number of user messages present when execution starts; stable across ACP chunk replay. */
  afterUserCount: number
  session: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'
  queuedAt?: number
  startedAt: number
  finishedAt: number | null
  exitCode: number | null
  error?: string
  archived?: boolean
  previewTruncated?: boolean
}
