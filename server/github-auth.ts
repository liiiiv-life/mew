import { randomUUID } from 'node:crypto'
import { githubLoginPending, type GitHubAuthStatus, type GitHubLoginJob } from '../shared/github-auth.ts'
import { gitConnections, GitConnections, GitConnectionError } from './git-connections.ts'
import { gitProvider, type GitProvider } from './git-providers.ts'

export const GITHUB_DEVICE_URL = 'https://github.com/login/device'
export class GitHubAuthError extends GitConnectionError {}
type Job = GitHubLoginJob & { deviceCode?: string; timer?: NodeJS.Timeout; deadline: number; interval: number }

/** Jobs and durable credentials both belong to the Mew account, never the OS account. */
export class GitHubAuth {
  private jobs = new Map<string, Job>()
  private closeBrowser: (owner: string, job: string) => Promise<void>
  private provider: GitProvider
  private connections: GitConnections
  constructor(closeBrowser: (owner: string, job: string) => Promise<void>, provider: GitProvider = gitProvider(), connections: GitConnections = gitConnections) { this.closeBrowser = closeBrowser; this.provider = provider; this.connections = connections }
  async status(owner: string): Promise<GitHubAuthStatus> {
    const record = await this.connections.resolve(owner, this.provider.id, this.provider.host, this.provider.refresh)
    const job = this.jobs.get(owner)
    return { available: this.provider.configured(), login: record && (!record.expiresAt || record.expiresAt > Date.now()) ? record.login : null, environmentToken: false, busy: false, job: job ? this.snapshot(job) : null, verificationUrl: this.provider.verificationUrl }
  }
  start(owner: string): GitHubLoginJob {
    const existing = this.jobs.get(owner)
    if (githubLoginPending(existing ?? null)) return this.snapshot(existing!)
    if (!this.provider.configured()) throw new GitHubAuthError('서버에 MEW_GITHUB_CLIENT_ID를 설정하고 앱의 Device flow를 활성화하세요.', 503, 'git-provider-unconfigured')
    const job: Job = { id: randomUUID(), state: 'starting', code: null, error: null, deadline: Date.now() + 900_000, interval: 5000 }
    this.jobs.set(owner, job)
    void this.begin(owner, job)
    return this.snapshot(job)
  }
  private async begin(owner: string, job: Job) {
    try {
      const device = await this.provider.begin()
      if (!githubLoginPending(job)) return
      Object.assign(job, { state: 'waiting', code: device.code, deviceCode: device.deviceCode, deadline: Date.now() + device.expiresIn * 1000, interval: device.interval * 1000 })
      this.schedule(owner, job)
    } catch { this.finish(owner, job, 'failed', 'GitHub 승인을 시작하지 못했습니다. 앱 설정과 연결을 확인하세요.') }
  }
  private schedule(owner: string, job: Job) {
    job.timer = setTimeout(() => { void this.poll(owner, job) }, Math.min(job.interval, Math.max(0, job.deadline - Date.now())))
    job.timer.unref()
  }
  private async poll(owner: string, job: Job) {
    if (!githubLoginPending(job)) return
    if (Date.now() >= job.deadline) { this.finish(owner, job, 'failed', '로그인 시간이 만료되었습니다. 다시 시도하세요.'); return }
    try {
      const token = await this.provider.poll(job.deviceCode!)
      if (!githubLoginPending(job)) return
      if (token.state !== 'complete') { if (token.state === 'slow_down') job.interval += 5000; this.schedule(owner, job); return }
      job.state = 'configuring'; job.code = null
      const account = await this.provider.identify(token.accessToken)
      if (!githubLoginPending(job) || Date.now() >= job.deadline) { this.finish(owner, job, 'failed', '로그인 시간이 만료되었습니다. 다시 시도하세요.'); return }
      this.connections.set(owner, { provider: this.provider.id, host: this.provider.host, ...account, accessToken: token.accessToken, expiresAt: token.expiresAt, refreshToken: token.refreshToken, refreshExpiresAt: token.refreshExpiresAt })
      this.finish(owner, job, 'complete')
    } catch { this.finish(owner, job, 'failed', 'GitHub 로그인이 취소되었거나 실패했습니다. 다시 로그인하세요.') }
  }
  stop(owner: string, id: string) { this.finish(owner, this.owned(owner, id), 'cancelled') }
  disconnect(owner: string) {
    const job = this.jobs.get(owner)
    if (job) this.finish(owner, job, 'cancelled')
    this.jobs.delete(owner)
    this.connections.remove(owner, this.provider.id, this.provider.host)
  }
  browserJob(owner: string, id: string): string {
    const job = this.owned(owner, id)
    if (job.state !== 'waiting' || !job.code) throw new GitHubAuthError('승인 코드를 준비 중이거나 로그인이 종료되었습니다.', 409)
    return `github-${job.id}`
  }
  private owned(owner: string, id: string) {
    const job = this.jobs.get(owner)
    if (!job || job.id !== id) throw new GitHubAuthError('로그인 작업을 찾을 수 없습니다.', 404)
    return job
  }
  private finish(owner: string, job: Job, state: GitHubLoginJob['state'], error: string | null = null) {
    if (!githubLoginPending(job)) return
    clearTimeout(job.timer)
    Object.assign(job, { state, error, code: null, deviceCode: undefined })
    void this.closeBrowser(owner, `github-${job.id}`).catch(() => {})
  }
  private snapshot(job: Job): GitHubLoginJob { return { id: job.id, state: job.state, code: job.code, error: job.error } }
}
