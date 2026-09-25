import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const entry = fileURLToPath(import.meta.url)
const execute = promisify(execFile)
const prefix = 'MEW_DESKTOP_PERMISSIONS '
const states = new Set(['not-determined', 'granted', 'denied', 'restricted', 'unknown'])

export function parsePermissionStatus(output) {
  const lines = output.split('\n').filter(line => line.startsWith(prefix))
  if (lines.length !== 1) throw new Error('Mac 보조앱의 권한 상태를 확인하지 못했습니다.')
  const value = JSON.parse(lines[0].slice(prefix.length))
  if (!value || typeof value.accessibility !== 'boolean' || !states.has(value.screen)) throw new Error('잘못된 Mac 권한 상태입니다.')
  return { accessibility: value.accessibility, screen: value.screen }
}

export async function runPermissionHost({ target, profile, mode, env, signal, timeout }, run = execute) {
  if (!['check', 'accessibility', 'screen'].includes(mode)) throw new Error('잘못된 권한 요청입니다.')
  const childEnv = { ...env, MEW_DESKTOP_PERMISSION_PROFILE: profile }
  delete childEnv.ELECTRON_RUN_AS_NODE
  delete childEnv.NODE_OPTIONS
  const executable = path.join(target, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  let exited
  try {
    const operation = run(executable, [path.join(target, 'permissions-host.mjs'), mode], {
      env: childEnv, cwd: target, timeout, maxBuffer: 16_384, killSignal: 'SIGKILL', signal,
    })
    // Abort can reject execFile before the child closes its profile files.
    if (operation.child) exited = new Promise(resolve => operation.child.once('close', resolve))
    const { stdout } = await operation
    return mode === 'check' ? parsePermissionStatus(stdout.toString()) : null
  } catch (error) {
    signal?.throwIfAborted()
    // macOS may quit a requester when the user chooses Quit & Reopen. Verify
    // with a fresh process; a timeout or terminated request never means granted.
    if (mode !== 'check' && (error.killed || error.signal) && String(error.stdout).includes('MEW_DESKTOP_PERMISSION_REQUESTED\n')) return null
    throw new Error('Mac 권한 보조앱을 실행하거나 확인하지 못했습니다. 로그인한 Mac 사용자로 ./mew desktop-setup을 다시 실행해 주세요.', { cause: error })
  } finally { await exited }
}

async function isConsoleUser() {
  const uid = process.getuid?.()
  return uid !== undefined && uid !== 0 && (await fs.stat('/dev/console')).uid === uid
}

export async function prepareDesktopPermissions({
  platform = process.platform, env = process.env, directory = path.dirname(entry),
  run = runPermissionHost, loginUser = isConsoleUser, log = console.log,
  now = () => performance.now(), wait = (ms, signal) => delay(ms, undefined, { signal }),
  timeout = 300_000, signal,
} = {}) {
  signal?.throwIfAborted()
  if (platform !== 'darwin') {
    log('보조앱 파일 준비가 끝났습니다. 원격 데스크톱에서 연결하세요. OS의 로그인·화면 공유 조건은 별도로 필요합니다.')
    return
  }
  const target = env.MEW_DESKTOP_HELPER_DIR || directory
  if (!path.isAbsolute(target)) throw new Error('MEW_DESKTOP_HELPER_DIR에는 Mac의 절대 경로가 필요합니다.')
  if (!await loginUser()) throw new Error('Mac 데스크톱에 로그인한 사용자로 실행해야 합니다. sudo 없이 같은 사용자의 Mew 터미널에서 ./mew desktop-setup을 실행해 주세요.')
  log('서버 Mac의 화면 기록·손쉬운 사용 권한을 확인합니다. 화면 캡처와 입력 제어는 시작하지 않습니다.')
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-desktop-permissions-'))
  const deadline = now() + timeout
  const requested = new Set()
  let last = ''
  try {
    while (now() < deadline) {
      signal?.throwIfAborted()
      // Screen permission can be cached for the lifetime of an Electron process.
      const status = await run({ target, profile, mode: 'check', env, signal, timeout: Math.max(1, Math.min(10_000, deadline - now())) })
      signal?.throwIfAborted()
      if (!status) throw new Error('Mac 권한 상태를 확인하지 못했습니다.')
      const summary = `손쉬운 사용: ${status.accessibility ? '허용됨' : '승인 필요'} / 화면 기록: ${status.screen === 'granted' ? '허용됨' : '승인 필요'}`
      if (summary !== last) { log(summary); last = summary }
      if (status.accessibility && status.screen === 'granted') {
        log('Mac 원격 데스크톱 권한 준비가 완료됐습니다. Mew의 원격 데스크톱에서 연결하세요.')
        return
      }
      if (status.screen === 'restricted') throw new Error('화면 기록이 Mac 관리 정책으로 제한되어 있습니다. 관리자에게 권한을 확인해 주세요.')
      const mode = status.accessibility ? 'screen' : 'accessibility'
      if (!requested.has(mode) && now() < deadline) {
        requested.add(mode)
        log(`${mode === 'accessibility' ? '손쉬운 사용' : '화면 기록'} 설정을 서버 Mac에서 엽니다. Electron 보조앱을 허용해 주세요.`)
        log('승인창은 이 터미널이나 접속 기기가 아닌 서버 Mac의 데스크톱에 표시됩니다. 승인하면 자동으로 계속합니다. 최대 5분 대기하며 Ctrl+C로 중단할 수 있습니다.')
        await run({ target, profile, mode, env, signal, timeout: Math.max(1, Math.min(30_000, deadline - now())) })
      }
      if (now() < deadline) await wait(Math.min(2000, deadline - now()), signal)
    }
    throw new Error('Mac 권한 승인을 기다리는 시간이 끝났습니다. 서버 Mac에서 승인한 뒤 ./mew desktop-setup을 다시 실행해 주세요. 설치 파일은 유지됩니다.')
  } finally {
    await fs.rm(profile, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  const controller = new AbortController()
  let interrupted = 0
  const interrupt = signal => { interrupted = signal === 'SIGINT' ? 130 : 143; controller.abort() }
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
  try { await prepareDesktopPermissions({ signal: controller.signal }) }
  catch (error) { console.error(interrupted ? '권한 준비를 중단했습니다. ./mew desktop-setup으로 다시 진행할 수 있습니다.' : error.message); process.exitCode = interrupted || 1 }
  finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt) }
}
