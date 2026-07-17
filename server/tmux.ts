import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { homedir } from 'node:os'

const exec = promisify(execFile)

const TMUX_BIN = 'tmux'
export const DOCS_CWD = path.join(homedir(), 'dev', 'liiiiv')

// tmux 타겟 문법(: 은 윈도우, . 은 페인 구분자)과 충돌하지 않는 문자만 허용.
// 셸 인젝션 자체는 execFile이 배열 인자를 쓰므로 이미 막혀 있음.
const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,50}$/

export class TmuxError extends Error {}

function assertValidName(name: string) {
  if (!SESSION_NAME_RE.test(name)) {
    throw new TmuxError(`세션 이름은 영문/숫자/-/_ 만 사용할 수 있습니다 (1~50자): ${name}`)
  }
}

async function run(args: string[]): Promise<string> {
  const { stdout } = await exec(TMUX_BIN, args)
  return stdout
}

export interface TmuxSession {
  name: string
  createdAt: number
  attached: boolean
  windows: number
}

export async function listTmuxSessions(): Promise<TmuxSession[]> {
  try {
    const stdout = await run(['list-sessions', '-F', '#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}'])
    return stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [name, createdAt, attached, windows] = line.split('\t')
        return { name, createdAt: Number(createdAt), attached: attached === '1', windows: Number(windows) }
      })
  } catch (err) {
    // tmux 서버 자체가 안 떠 있으면 "no server running"으로 실패한다 — 세션이 0개인 정상 상태.
    const message = err instanceof Error ? err.message : String(err)
    if (/no server running|no such file or directory/i.test(message)) return []
    throw err
  }
}

async function sessionExists(name: string): Promise<boolean> {
  const sessions = await listTmuxSessions()
  return sessions.some((s) => s.name === name)
}

export async function createTmuxSession(name: string): Promise<void> {
  assertValidName(name)
  if (await sessionExists(name)) {
    throw new TmuxError(`이미 존재하는 세션입니다: ${name}`)
  }
  await run(['new-session', '-d', '-s', name, '-c', DOCS_CWD])
}

export async function killTmuxSession(name: string): Promise<void> {
  assertValidName(name)
  try {
    await run(['kill-session', '-t', name])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/session not found|can't find session/i.test(message)) {
      throw new TmuxError(`존재하지 않는 세션입니다: ${name}`)
    }
    throw err
  }
}

export async function renameTmuxSession(oldName: string, newName: string): Promise<void> {
  assertValidName(oldName)
  assertValidName(newName)
  if (oldName === newName) return
  if (await sessionExists(newName)) {
    throw new TmuxError(`이미 존재하는 세션입니다: ${newName}`)
  }
  try {
    await run(['rename-session', '-t', oldName, newName])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/session not found|can't find session/i.test(message)) {
      throw new TmuxError(`존재하지 않는 세션입니다: ${oldName}`)
    }
    throw err
  }
}

export function isValidSessionName(name: string): boolean {
  return SESSION_NAME_RE.test(name)
}
