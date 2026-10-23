import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { TmuxManager } from '@mew/tmux-term/server'
import { stateDir } from './config.ts'
import { quotePowerShell, windowsShell } from '../packages/tmux-term/src/server/backends/psmux.ts'
import type { UpdateJob } from '../shared/updates.ts'
import type { SpawnSpec } from './agentRuntimes.ts'

export type StoredUpdateQueue = {
  job: UpdateJob
  startedAt: number
  workerPid: number | null
  selected: { id: string; label: string; category: 'agent' | 'system' | 'dependency'; command: SpawnSpec }[]
  sessions: Record<string, string>
}

const queueFile = () => path.join(stateDir(), 'dependency-update-job.json')
const quoteShell = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

export function updateSessionName(ids: string[]): string {
  if (ids.length > 1) return 'mewcmd-updates-system'
  return `mewcmd-update-${crypto.createHash('sha256').update(ids[0]).digest('hex').slice(0, 16)}`
}

/** Run before entering an interactive shell so shell startup cannot consume the update command. */
export function retainedUpdateCommand(command: string): string {
  return process.platform === 'win32'
    ? `${command}; & ${quotePowerShell(windowsShell())} -NoLogo -NoProfile -NoExit`
    : `${command}; ENV= exec /bin/sh -i`
}

export function updateWorkerCommand(file: string): string {
  const quote = process.platform === 'win32' ? quotePowerShell : quoteShell
  return retainedUpdateCommand(`${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(file)}`)
}

export function updateWorkerAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

export function writeUpdateQueue(queue: StoredUpdateQueue): void {
  const file = queueFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temporary, `${JSON.stringify(queue)}\n`, { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(temporary, file)
}

export function readUpdateQueue(): StoredUpdateQueue | null {
  try {
    const queue = JSON.parse(fs.readFileSync(queueFile(), 'utf8')) as StoredUpdateQueue
    if (!queue.job || !Array.isArray(queue.job.items) || !Array.isArray(queue.selected) || typeof queue.startedAt !== 'number' || !queue.sessions || typeof queue.sessions !== 'object') return null
    if (queue.job.running && !(queue.workerPid ? updateWorkerAlive(queue.workerPid) : Date.now() - queue.startedAt < 30_000)) {
      queue.job.running = false
      for (const entry of queue.job.items) {
        if (entry.state !== 'running' && entry.state !== 'queued') continue
        entry.state = 'failed'
        entry.error = '업데이트 작업이 중단되었습니다. 세션 출력을 확인한 뒤 다시 시도해 주세요.'
      }
      writeUpdateQueue(queue)
    }
    return queue
  } catch { return null }
}

export async function replaceUpdateSession(manager: Pick<TmuxManager, 'list' | 'kill' | 'startCommand'>, session: string, command: string, cwd: string): Promise<void> {
  if ((await manager.list()).some(row => row.name === session)) await manager.kill(session)
  await manager.startCommand(session, command, cwd)
}
