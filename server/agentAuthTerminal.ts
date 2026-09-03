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

export type BrowserLoginDetails = {
  verificationUrl: string | null
  verificationCode: string | null
}

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}(?:[@-_][0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|${String.fromCharCode(27)}\\\\))`, 'g')

function plainOutput(output: string): string {
  // tmux pane에 남은 ANSI 제어 문자가 URL·오류 파싱에 끼지 않게 한다.
  return output.replaceAll(ANSI_ESCAPE, '')
}

/** 고정된 공급자 CLI 출력에서만, 등록표가 허용한 HTTPS 인증 주소와 일회용 코드를 넘긴다. */
export function browserLoginDetailsFromOutput(output: string, verificationHosts: readonly string[]): BrowserLoginDetails {
  const allowed = new Set(verificationHosts.map((host) => host.toLowerCase()))
  const plain = plainOutput(output)
  let verificationUrl: string | null = null
  // tmux capture-pane는 폭에서 줄을 강제로 접는다. Kimi의 기기 인증 URL은 user_code가
  // 고정된 `AAAA-BBBB` 꼴이라, 모든 공백을 잠시 뺀 뒤 이 완전한 주소까지만 안전하게 복원할 수 있다.
  // global 로그인은 kimi.ai, mainland-cn 로그인은 kimi.com을 쓴다.
  const compact = plain.replaceAll(/\s+/g, '')
  const kimiDeviceUrl = compact.match(/https:\/\/(?:www\.)?kimi\.(?:ai|com)\/code\/authorize_device\?user_code=[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0]
  if (kimiDeviceUrl) {
    const url = new URL(kimiDeviceUrl)
    if (allowed.has(url.hostname.toLowerCase())) verificationUrl = url.toString()
  }
  for (const raw of plain.match(/https:\/\/[^\s<>"']+/g) ?? []) {
    if (verificationUrl) break
    try {
      const url = new URL(raw.replace(/[),.;\]]+$/, ''))
      if (allowed.has(url.hostname.toLowerCase())) verificationUrl = url.toString()
    } catch { /* 다음 URL 후보 */ }
  }
  let verificationCode: string | null = null
  if (verificationUrl) {
    try { verificationCode = new URL(verificationUrl).searchParams.get('user_code') } catch { /* 이미 URL 검증을 통과했다 */ }
  }
  verificationCode ??= plain.match(/(?:one[- ]time|device|verification|user)\s+code(?:\s+is)?\s*[:\n]\s*([A-Z0-9]{4}(?:-[A-Z0-9]{4})?)/i)?.[1]?.toUpperCase() ?? null
  return { verificationUrl, verificationCode }
}

export function browserLoginUrlFromOutput(output: string, verificationHosts: readonly string[]): string | null {
  return browserLoginDetailsFromOutput(output, verificationHosts).verificationUrl
}

/** 브라우저형 인증에서 터미널을 안 열어도 알 수 있게, 비밀값을 제거한 실패 한 줄만 돌려준다. */
export function authFailureMessageFromOutput(output: string): string | null {
  const lines = plainOutput(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const candidate = lines.reverse().find((line) => /\b(?:error|failed|failure|denied|expired|cancelled|canceled|timed? out)\b/i.test(line))
  if (!candidate) return null
  return candidate
    .replaceAll(/https:\/\/[^\s<>"']+/g, '[인증 URL]')
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [비밀값]')
    .replaceAll(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|code)\s*["']?\s*[:=]\s*["']?)[^\s,"';}]+/gi, '$1[비밀값]')
    .replaceAll(/\b(?:sk|key|token|secret|code)[-_A-Za-z0-9]{8,}\b/gi, '[비밀값]')
    .replaceAll(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '[일회용 코드]')
    .slice(0, 300)
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
