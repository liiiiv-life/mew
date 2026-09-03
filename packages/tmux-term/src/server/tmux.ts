import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const TMUX_BIN = 'tmux'

// tmux 타겟 문법(: 은 윈도우, . 은 페인 구분자)과 충돌하지 않는 문자만 허용.
// 셸 인젝션 자체는 execFile이 배열 인자를 쓰므로 이미 막혀 있음.
const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,50}$/

export class TmuxError extends Error {}

export function isValidSessionName(name: string): boolean {
  return SESSION_NAME_RE.test(name)
}

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

export interface TmuxManagerOptions {
  /** 새 세션·attach가 시작할 작업 디렉터리 */
  cwd: string
}

export interface TmuxManager {
  cwd: string
  list: () => Promise<TmuxSession[]>
  create: (name: string) => Promise<void>
  kill: (name: string) => Promise<void>
  rename: (oldName: string, newName: string) => Promise<void>
  /** 세션이 없으면 cwd에서 새로 띄운 뒤, 명령을 셸에 "타이핑하고 Enter"로 실행한다(재호출 = 재실행) */
  runCommand: (name: string, command: string, cwd: string) => Promise<void>
  /** 고정된 제어 키 하나를 현재 pane에 보낸다. 사용자 입력을 이 경로로 전달하지 않는다. */
  sendKey: (name: string, key: 'Escape') => Promise<void>
  /** 화면에 보이는 최근 pane 내용을 텍스트로 회수한다. 서버가 만든 고정 진단 세션에서만 쓴다. */
  capture: (name: string, lines?: number) => Promise<string>
}

async function listTmuxSessions(): Promise<TmuxSession[]> {
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

export function createTmuxManager({ cwd }: TmuxManagerOptions): TmuxManager {
  // 새 세션은 항상 **지금의** manager.cwd에서 연다 — 호스트 앱이 작업 폴더를 갈아끼울 수 있다(mew 워크스페이스 바꾸기)
  const manager: TmuxManager = {
    cwd,

    list: listTmuxSessions,

    async create(name) {
      assertValidName(name)
      if (await sessionExists(name)) {
        throw new TmuxError(`이미 존재하는 세션입니다: ${name}`)
      }
      await run(['new-session', '-d', '-s', name, '-c', manager.cwd])
    },

    async kill(name) {
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
    },

    async rename(oldName, newName) {
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
    },

    async runCommand(name, command, sessionCwd) {
      assertValidName(name)
      if (!(await sessionExists(name))) {
        await run(['new-session', '-d', '-s', name, '-c', sessionCwd])
      }
      // -l(리터럴)로 명령 문자열을 그대로 보낸다 — 안에 "Enter" 같은 키 이름이 있어도 키로 해석되지
      // 않는다. 제출용 Enter는 별도 send-keys로 보낸다(사용자가 직접 친 것과 동일).
      await run(['send-keys', '-t', name, '-l', command])
      await run(['send-keys', '-t', name, 'Enter'])
    },

    async sendKey(name, key) {
      assertValidName(name)
      await run(['send-keys', '-t', name, key])
    },

    async capture(name, lines = 200) {
      assertValidName(name)
      // 음수 시작 줄로 최근 출력만 제한한다. 호출자는 이 값을 사용자 입력으로 받지 않는다.
      const start = -Math.min(Math.max(lines, 1), 500)
      // -J로 pane 폭 때문에 접힌 만 줄을 다시 이어 붙인다. 긴 OAuth URL이 중간에서
      // 끊기면 호스트 allowlist 검사를 통과해도 브라우저가 열 수 없다.
      return run(['capture-pane', '-p', '-J', '-t', name, '-S', String(start)])
    },
  }
  return manager
}
