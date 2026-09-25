export type GitAiCommitState = 'starting' | 'running' | 'committing' | 'completed' | 'failed' | 'cancelled'
export interface GitCommitGroup { title: string; description: string; files: string[] }
export interface GitCommitPlan { commits: GitCommitGroup[]; skipped: { file: string; reason: string }[] }
export interface GitCommitResult extends GitCommitGroup { hash: string }
export interface GitAiCommitJob {
  mode?: 'commit'
  files?: string[]
  id: string
  agentSetName: string
  state: GitAiCommitState
  startedAt: number
  finishedAt?: number
  output: string
  result?: { commits: GitCommitResult[]; skipped: GitCommitPlan['skipped'] }
  error?: string
  truncated: boolean
}
export function gitAiCommitActive(job: GitAiCommitJob | null): boolean {
  return job?.state === 'starting' || job?.state === 'running' || job?.state === 'committing'
}
