import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TmuxManager } from '@mew/tmux-term/server'
import type { AgentCommandRecord, AgentCommandScope } from '../shared/agent-command.ts'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'
import { spawnSpecCommand } from './spawnSpecCommand.ts'

export type StoredAgentCommand = AgentCommandRecord & { owner: string; queueHostPid?: number }
export type AgentCommandInput = AgentCommandScope & { id: string; tab: string; command: string; afterUserCount: number }
const ID = /^[a-f0-9-]{36}$/
const TAB = /^[A-Za-z0-9_-]{1,64}$/
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const runner = fileURLToPath(new URL('./agent-command-runner.ts', import.meta.url))

export class AgentCommandError extends Error {}

export function validateCommandScope(value: AgentCommandScope): void {
  if (typeof value.runtime !== 'string' || !TAB.test(value.runtime)
    || typeof value.cwd !== 'string' || !path.isAbsolute(value.cwd)
    || typeof value.sessionId !== 'string' || !SESSION.test(value.sessionId)) {
    throw new AgentCommandError('명령의 대화 정보가 올바르지 않습니다')
  }
}

export class AgentCommandStore {
  readonly manager: TmuxManager
  readonly root: string
  constructor(manager: TmuxManager, root = path.join(DATA_DIR, 'agent-commands')) {
    this.manager = manager
    this.root = root
  }

  ownerDirectory(owner: string) {
    return path.join(this.root, crypto.createHash('sha256').update(owner).digest('hex'))
  }

  directory(owner: string, id: string) {
    if (!ID.test(id)) throw new AgentCommandError('명령 ID가 올바르지 않습니다')
    return path.join(this.ownerDirectory(owner), id)
  }

  read(owner: string, id: string): StoredAgentCommand {
    const file = path.join(this.directory(owner, id), 'record.json')
    if (!fs.existsSync(file)) throw new AgentCommandError('명령 기록을 찾을 수 없습니다')
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredAgentCommand
    if (record.owner !== owner) throw new AgentCommandError('명령 기록을 찾을 수 없습니다')
    return record
  }

  async list(owner: string, scope?: AgentCommandScope): Promise<AgentCommandRecord[]> {
    if (scope) validateCommandScope(scope)
    const directory = this.ownerDirectory(owner)
    if (!fs.existsSync(directory)) return []
    const records = fs.readdirSync(directory).filter(id => ID.test(id)).map(id => this.read(owner, id))
      .filter(record => !scope || record.runtime === scope.runtime && record.cwd === scope.cwd && record.sessionId === scope.sessionId)
    for (const record of records) {
      if (record.state !== 'queued' || !record.queueHostPid) continue
      try { process.kill(record.queueHostPid, 0) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue
        Object.assign(record, this.read(owner, record.id))
        if (record.state !== 'queued') continue
        record.state = 'interrupted'
        record.finishedAt = Date.now()
        record.error = '대기열을 관리하던 에이전트 세션이 종료되었습니다'
        writeFileAtomic(path.join(this.directory(owner, record.id), 'record.json'), JSON.stringify(record))
      }
    }
    if (records.some(record => record.state === 'running')) {
      const live = new Set((await this.manager.list()).map(session => session.name))
      for (const record of records) {
        if (record.state !== 'running' || live.has(record.session) || Date.now() - record.startedAt < 10_000) continue
        // Re-read after querying tmux: the runner may have finished and saved the archive in between.
        Object.assign(record, this.read(owner, record.id))
        if (record.state !== 'running') continue
        record.state = 'interrupted'
        record.finishedAt = Date.now()
        record.error = '터미널 세션이 종료되었습니다'
        writeFileAtomic(path.join(this.directory(owner, record.id), 'record.json'), JSON.stringify(record))
      }
    }
    return records.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).map(publicCommand)
  }

  prepare(owner: string, input: AgentCommandInput): AgentCommandRecord {
    validateCommandScope(input)
    if (!owner || !TAB.test(input.tab) || typeof input.command !== 'string' || !input.command.trim()
      || input.command.length > 64 * 1024 || input.command.includes('\0')
      || !Number.isSafeInteger(input.afterUserCount) || input.afterUserCount < 0) throw new AgentCommandError('명령 입력이 올바르지 않습니다')
    const directory = this.directory(owner, input.id)
    fs.mkdirSync(this.ownerDirectory(owner), { recursive: true, mode: 0o700 })
    try { fs.mkdirSync(directory, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const previous = this.read(owner, input.id)
      if (previous.command !== input.command || previous.runtime !== input.runtime || previous.cwd !== input.cwd || previous.sessionId !== input.sessionId || previous.tab !== input.tab) {
        throw new AgentCommandError('이미 다른 명령에 사용한 ID입니다')
      }
      return publicCommand(previous)
    }
    const record: StoredAgentCommand = {
      ...input, owner, session: `mewcmd-cli-${crypto.randomBytes(12).toString('hex')}`,
      state: 'queued', queuedAt: Date.now(), startedAt: Date.now(), finishedAt: null, exitCode: null,
      queueHostPid: process.pid,
    }
    writeFileAtomic(path.join(directory, 'record.json'), JSON.stringify(record))
    return publicCommand(record)
  }

  async start(owner: string, input: AgentCommandInput): Promise<AgentCommandRecord> {
    this.prepare(owner, input)
    return this.launch(owner, input.id)
  }

  async launch(owner: string, id: string, context?: { sessionId: string; afterUserCount: number }): Promise<AgentCommandRecord> {
    const record = this.read(owner, id)
    if (record.state !== 'queued') return publicCommand(record)
    const directory = this.directory(owner, id)
    if (context) Object.assign(record, context)
    record.state = 'running'
    record.startedAt = Date.now()
    writeFileAtomic(path.join(directory, 'record.json'), JSON.stringify(record))
    try {
      await this.manager.startCommand(record.session, spawnSpecCommand({ cmd: process.execPath, args: [runner, directory] }), record.cwd)
    } catch (error) {
      record.state = 'failed'
      record.finishedAt = Date.now()
      record.error = error instanceof Error ? error.message : String(error)
      writeFileAtomic(path.join(directory, 'record.json'), JSON.stringify(record))
    }
    return publicCommand(record)
  }

  stop(owner: string, id: string): void {
    const record = this.read(owner, id)
    if (record.state === 'queued') {
      record.cancelledBeforeStart = true
      record.state = 'interrupted'
      record.finishedAt = Date.now()
      record.startedAt = record.finishedAt
      writeFileAtomic(path.join(this.directory(owner, id), 'record.json'), JSON.stringify(record))
    }
    if (record.state === 'running') fs.writeFileSync(path.join(this.directory(owner, id), 'stop'), '', { mode: 0o600 })
  }

  fail(owner: string, id: string, message: string): void {
    const record = this.read(owner, id)
    if (record.state !== 'queued') return
    record.state = 'failed'
    record.error = message
    record.finishedAt = Date.now()
    writeFileAtomic(path.join(this.directory(owner, id), 'record.json'), JSON.stringify(record))
  }

  async stopTab(owner: string, tab: string): Promise<void> {
    if (!TAB.test(tab)) throw new AgentCommandError('탭 ID가 올바르지 않습니다')
    for (const record of await this.list(owner)) if (record.tab === tab) this.stop(owner, record.id)
  }
}

export function publicCommand(record: StoredAgentCommand): AgentCommandRecord {
  const { owner: _owner, queueHostPid: _queueHostPid, ...result } = record
  // Older queued cancellations used equal timestamps, with no execution output/error.
  // Return a tombstone so polling also replaces an already cached interrupted bubble.
  const legacyCancellation = record.state === 'interrupted' && record.queuedAt !== undefined
    && record.startedAt === record.finishedAt && !record.archived && !record.error
  return legacyCancellation ? { ...result, cancelledBeforeStart: true } : result
}
