import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { stateDir } from './config.ts'

const exec = promisify(execFile)
export const MEW_APP_ROOT = path.resolve(import.meta.dirname, '..')
export const MEW_UPDATE_SESSION = 'mewcmd-mew-update'
const UPDATE_JOB_FILE = path.join(stateDir(), 'update-job.json')
const PID_FILE = path.join(stateDir(), 'mew.pid')

export type MewUpdateJob = {
  state: 'queued' | 'running' | 'succeeded' | 'failed'
  startedAt: number
  finishedAt: number | null
  message: string | null
}

export type MewUpdateStatus = {
  supported: boolean
  canUpdate: boolean
  branch: string | null
  localHash: string | null
  remoteHash: string | null
  ahead: number
  behind: number
  available: boolean
  dirty: boolean
  running: boolean
  managedByMew: boolean
  error: string | null
  job: MewUpdateJob | null
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: MEW_APP_ROOT, timeout: 20_000, maxBuffer: 1024 * 1024 })
  return stdout.trim()
}

export function parseAheadBehind(value: string): { ahead: number; behind: number } {
  const [aheadText, behindText] = value.trim().split(/\s+/)
  const ahead = Number(aheadText)
  const behind = Number(behindText)
  if (!Number.isSafeInteger(ahead) || ahead < 0 || !Number.isSafeInteger(behind) || behind < 0) {
    throw new Error('Git 비교 결과를 읽지 못했습니다')
  }
  return { ahead, behind }
}

function managedByMew(): boolean {
  try {
    return Number(fs.readFileSync(PID_FILE, 'utf-8').trim()) === process.pid
  } catch {
    return false
  }
}

export function readMewUpdateJob(): MewUpdateJob | null {
  try {
    const value = JSON.parse(fs.readFileSync(UPDATE_JOB_FILE, 'utf-8')) as Partial<MewUpdateJob>
    if (!['queued', 'running', 'succeeded', 'failed'].includes(String(value.state))) return null
    if (typeof value.startedAt !== 'number') return null
    return {
      state: value.state as MewUpdateJob['state'],
      startedAt: value.startedAt,
      finishedAt: typeof value.finishedAt === 'number' ? value.finishedAt : null,
      message: typeof value.message === 'string' ? value.message : null,
    }
  } catch {
    return null
  }
}

export function writeMewUpdateJob(job: MewUpdateJob): void {
  fs.mkdirSync(path.dirname(UPDATE_JOB_FILE), { recursive: true, mode: 0o700 })
  // 상태 디렉터리는 DATA_DIR과 다를 수 있어 같은 원자적 쓰기 방식을 여기서 직접 적용한다.
  const temporary = `${UPDATE_JOB_FILE}.tmp-${process.pid}`
  fs.writeFileSync(temporary, `${JSON.stringify(job)}\n`, { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(temporary, UPDATE_JOB_FILE)
}

export function needsMewUpdate(available: boolean, job: MewUpdateJob | null): boolean {
  // Pull may have succeeded before installation/build/restart failed.
  return available || job?.state === 'failed'
}

export async function mewUpdateStatus(refreshRemote: boolean, running: boolean): Promise<MewUpdateStatus> {
  let job = readMewUpdateJob()
  // A concurrent status request can arrive between reserving the job and
  // starting tmux. Give queued workers a short launch window.
  if (!running && (job?.state === 'running' || job?.state === 'queued' && Date.now() - job.startedAt > 30_000)) {
    job = { ...job, state: 'failed', finishedAt: Date.now(), message: '업데이트 작업이 중단되었습니다. 다시 시도해 주세요.' }
    writeMewUpdateJob(job)
  }
  const base = {
    supported: false,
    canUpdate: false,
    branch: null,
    localHash: null,
    remoteHash: null,
    ahead: 0,
    behind: 0,
    available: false,
    dirty: false,
    running,
    managedByMew: managedByMew(),
    error: null,
    job,
  } satisfies MewUpdateStatus

  try {
    const branch = await git(['branch', '--show-current'])
    if (refreshRemote) {
      try {
        await git(['fetch', '--quiet', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
      } catch (err) {
        return { ...base, branch: branch || null, error: err instanceof Error ? err.message : String(err) }
      }
    }
    const [localHash, remoteHash, counts, dirtyText] = await Promise.all([
      git(['rev-parse', '--short', 'HEAD']),
      git(['rev-parse', '--short', 'refs/remotes/origin/main']),
      git(['rev-list', '--left-right', '--count', 'HEAD...refs/remotes/origin/main']),
      git(['status', '--porcelain']),
    ])
    const { ahead, behind } = parseAheadBehind(counts)
    const supported = branch === 'main'
    const isManagedByMew = managedByMew()
    return {
      ...base,
      supported,
      canUpdate: supported && isManagedByMew,
      branch: branch || null,
      localHash,
      remoteHash,
      ahead,
      behind,
      available: behind > 0,
      dirty: dirtyText.length > 0,
      managedByMew: isManagedByMew,
      error: supported ? null : 'main 브랜치에서만 자동 업데이트할 수 있습니다',
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}
