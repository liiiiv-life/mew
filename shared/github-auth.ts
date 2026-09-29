export interface GitHubLoginJob {
  id: string
  state: 'starting' | 'waiting' | 'configuring' | 'complete' | 'failed' | 'cancelled'
  code: string | null
  error: string | null
}

export interface GitHubAuthStatus {
  verificationUrl?: string
  available: boolean
  login: string | null
  environmentToken: boolean
  busy: boolean
  job: GitHubLoginJob | null
}

export function githubLoginPending(job: GitHubLoginJob | null): boolean {
  return !!job && ['starting', 'waiting', 'configuring'].includes(job.state)
}
