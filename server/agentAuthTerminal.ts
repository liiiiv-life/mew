// GUI terminal auth 작업의 종료 상태. tmux 안의 셸은 명령이 끝나도 살아 있으므로 별도 상태 파일로
// 실제 로그인 명령의 exit code를 전달한다. 비밀값은 쓰지 않고 런타임·탭·method는 해시에만 들어간다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'
import type { TerminalAuthSpec } from './agentAcp.ts'

export type AgentAuthTerminalState = 'running' | 'succeeded' | 'failed' | 'interrupted'

export type AgentAuthTerminalStatus = {
  state: AgentAuthTerminalState
  exitCode: number | null
}

const STATUS_DIR = path.join(DATA_DIR, 'agent-auth')

function shellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function spawnSpecCommand(spec: TerminalAuthSpec): string {
  const env = Object.entries(spec.env ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${shellArg(value)}`)
  return [...env, shellArg(spec.cmd), ...spec.args.map(shellArg)].join(' ')
}

function filesFor(runtime: string, tab: string, methodId: string) {
  const digest = crypto.createHash('sha256').update(`${runtime}\0${tab}\0${methodId}`).digest('hex').slice(0, 32)
  const status = path.join(STATUS_DIR, `${digest}.status`)
  return { status, temporary: `${status}.tmp` }
}

/** 새 terminal auth를 시작하며 지난 결과를 지우고 exit code 기록까지 포함한 고정 셸 명령을 만든다. */
export function prepareAgentAuthTerminal(
  runtime: string,
  tab: string,
  methodId: string,
  spec: TerminalAuthSpec,
): string {
  fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 })
  fs.chmodSync(STATUS_DIR, 0o700)
  const files = filesFor(runtime, tab, methodId)
  fs.rmSync(files.status, { force: true })
  fs.rmSync(files.temporary, { force: true })
  // 로그인 명령은 TTY를 그대로 물려받은 subshell에서 돈다. Ctrl-C/실패도 부모 셸이 exit code를 기록한다.
  return [
    `(${spawnSpecCommand(spec)})`,
    'mew_auth_exit=$?',
    'umask 077',
    `printf '%s\\n' "$mew_auth_exit" > ${shellArg(files.temporary)}`,
    `mv -f ${shellArg(files.temporary)} ${shellArg(files.status)}`,
  ].join('; ')
}

/** 상태 파일이 생기기 전 tmux까지 사라졌으면 사용자가 종료했거나 프로세스가 강제 종료된 것이다. */
export function readAgentAuthTerminalStatus(
  runtime: string,
  tab: string,
  methodId: string,
  tmuxRunning: boolean,
): AgentAuthTerminalStatus {
  const { status } = filesFor(runtime, tab, methodId)
  let raw: string
  try {
    raw = fs.readFileSync(status, 'utf8').trim()
  } catch {
    return { state: tmuxRunning ? 'running' : 'interrupted', exitCode: null }
  }
  if (!/^\d{1,3}$/.test(raw)) return { state: 'failed', exitCode: null }
  const exitCode = Number(raw)
  return { state: exitCode === 0 ? 'succeeded' : 'failed', exitCode }
}
