import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { githubLoginPending, type GitHubAuthStatus, type GitHubLoginJob } from '../shared/github-auth.ts'

export const GITHUB_DEVICE_URL = 'https://github.com/login/device'
const LOGIN_TIMEOUT = 15 * 60_000
const env = () => ({ ...process.env, GH_PROMPT_DISABLED: '1', GH_BROWSER: 'true', NO_COLOR: '1', GH_HOST: 'github.com' })
type Result = { ok: boolean; missing?: boolean; output: string }
type Dependencies = {
  run: (args: string[]) => Promise<Result>
  launch: () => ChildProcess
  closeBrowser: (owner: string, id: string) => Promise<void>
  environmentToken: () => boolean
  timeout?: number
}

function run(args: string[]): Promise<Result> {
  return new Promise(resolve => {
    execFile('gh', args, { env: env(), timeout: 20_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, missing: (error as NodeJS.ErrnoException | null)?.code === 'ENOENT', output: stdout })
    })
  })
}

export class GitHubAuthError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

type Job = GitHubLoginJob & { owner: string; child?: ChildProcess; timer?: NodeJS.Timeout }

/** Credentials stay with gh, matching the OS account used by all Git commands. */
export class GitHubAuth {
  private job: Job | null = null
  private deps: Dependencies

  constructor(closeBrowser: Dependencies['closeBrowser'], overrides: Partial<Dependencies> = {}) {
    this.deps = {
      run,
      launch: () => spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] }),
      closeBrowser,
      environmentToken: () => !!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN),
      ...overrides,
    }
  }

  async status(owner: string): Promise<GitHubAuthStatus> {
    const pending = githubLoginPending(this.job)
    // Polling a device approval must not repeatedly query GitHub's account API.
    const result = pending ? null : await this.deps.run(['api', '--hostname', 'github.com', 'user', '--jq', '.login'])
    const login = result?.ok && /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(result.output.trim()) ? result.output.trim() : null
    return {
      available: !result?.missing,
      login,
      environmentToken: this.deps.environmentToken(),
      busy: pending && this.job?.owner !== owner,
      job: this.job?.owner === owner ? this.snapshot(this.job) : null,
    }
  }

  start(owner: string): GitHubLoginJob {
    if (githubLoginPending(this.job)) {
      if (this.job!.owner === owner) return this.snapshot(this.job!)
      throw new GitHubAuthError('다른 사용자가 GitHub 로그인 중입니다. 완료 후 다시 시도하세요.', 409)
    }
    if (this.job?.child) throw new GitHubAuthError('이전 로그인을 종료하고 있습니다. 잠시 뒤 다시 시도하세요.', 409)
    if (this.deps.environmentToken()) throw new GitHubAuthError('환경변수의 GitHub 토큰을 사용 중입니다. 서버에서 GH_TOKEN·GITHUB_TOKEN을 해제한 뒤 로그인하세요.')
    const job: Job = { id: randomUUID(), owner, state: 'starting', code: null, error: null }
    this.job = job
    try {
      const child = this.deps.launch()
      job.child = child
      let output = ''
      const receive = (chunk: Buffer | string) => {
        if (!githubLoginPending(job)) return
        output = (output + chunk.toString()).slice(-8192)
        const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(output)?.[1]
        if (code) { job.code = code; job.state = 'waiting' }
      }
      child.stdout?.on('data', receive)
      child.stderr?.on('data', receive)
      child.once('error', (error: NodeJS.ErrnoException) => {
        this.finish(job, 'failed', error.code === 'ENOENT' ? 'GitHub CLI(gh)를 설치한 뒤 다시 시도하세요.' : 'GitHub 로그인을 시작하지 못했습니다. 다시 시도하세요.')
      })
      child.once('close', code => {
        job.child = undefined
        if (!githubLoginPending(job)) return
        if (code !== 0) { this.finish(job, 'failed', 'GitHub 로그인이 완료되지 않았습니다. 승인이 만료되었거나 연결에 실패했습니다. 다시 시도하세요.'); return }
        job.state = 'configuring'
        job.code = null
        void this.configure(job)
      })
      job.timer = setTimeout(() => {
        this.finish(job, 'failed', '로그인 시간이 만료되었습니다. 다시 시도하세요.')
        this.terminate(job)
      }, this.deps.timeout ?? LOGIN_TIMEOUT)
      job.timer.unref()
    } catch {
      this.finish(job, 'failed', 'GitHub 로그인을 시작하지 못했습니다. GitHub CLI 설치를 확인하세요.')
    }
    return this.snapshot(job)
  }

  stop(owner: string, id: string): void {
    const job = this.owned(owner, id)
    if (job.state === 'configuring') throw new GitHubAuthError('로그인을 마무리하고 있습니다. 잠시 기다려 주세요.', 409)
    if (!githubLoginPending(job)) return
    this.finish(job, 'cancelled')
    this.terminate(job)
  }

  browserJob(owner: string, id: string): string {
    const job = this.owned(owner, id)
    if (job.state !== 'waiting' || !job.code) throw new GitHubAuthError('로그인 코드를 준비 중이거나 로그인이 종료되었습니다.', 409)
    return `github-${job.id}`
  }

  private owned(owner: string, id: string): Job {
    if (!this.job || this.job.owner !== owner || this.job.id !== id) throw new GitHubAuthError('로그인 작업을 찾을 수 없습니다.', 404)
    return this.job
  }

  private async configure(job: Job): Promise<void> {
    try {
      const result = await this.deps.run(['auth', 'setup-git', '--hostname', 'github.com'])
      if (job.state !== 'configuring') return
      this.finish(job, result.ok ? 'complete' : 'failed', result.ok ? null : 'GitHub 인증은 완료됐지만 Git 연결 설정에 실패했습니다. 서버에서 gh auth setup-git을 실행하세요.')
    } catch {
      if (job.state === 'configuring') this.finish(job, 'failed', 'Git 연결 설정에 실패했습니다. 서버에서 gh auth setup-git을 실행하세요.')
    }
  }

  private terminate(job: Job): void {
    const child = job.child
    if (!child) return
    child.kill('SIGTERM')
    const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 2000)
    force.unref()
    child.once('close', () => clearTimeout(force))
  }

  private finish(job: Job, state: GitHubLoginJob['state'], error: string | null = null): void {
    if (!githubLoginPending(job)) return
    clearTimeout(job.timer)
    job.state = state
    job.code = null
    job.error = error
    void this.deps.closeBrowser(job.owner, `github-${job.id}`).catch(() => {})
  }

  private snapshot(job: Job): GitHubLoginJob {
    return { id: job.id, state: job.state, code: job.code, error: job.error }
  }
}
