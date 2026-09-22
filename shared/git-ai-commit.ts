export type GitAiCommitState = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
export interface GitAiCommitDraft { title: string; description: string }
export interface GitAiCommitJob {
  id: string
  agentSetName: string
  state: GitAiCommitState
  startedAt: number
  finishedAt?: number
  output: string
  result?: GitAiCommitDraft
  error?: string
  truncated: boolean
}
export function gitAiCommitActive(job: GitAiCommitJob | null): boolean {
  return job?.state === 'starting' || job?.state === 'running'
}
