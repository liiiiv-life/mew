import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { wslPowerShell } from './wsl-powershell.mjs'
import { installNativeRuntime } from './install-native-runtime.mjs'
import { installPosixVideo } from './install-posix-video.mjs'
import { HELPER_FILES, markHelperReady, dependenciesCurrent } from './helper-version.mjs'
import { runtimeSupportError } from './runtime-support.mjs'

const entry = fileURLToPath(import.meta.url)
export function installDesktopHelper({ platform = process.platform, release = os.release(), env = process.env, run = spawnSync, directory = path.dirname(entry), resolvePowerShell = wslPowerShell, installRuntime = installNativeRuntime, installCapture = installPosixVideo } = {}) {
  const unsupported = runtimeSupportError({ platform, release })
  if (unsupported) throw new Error(unsupported)
  const wsl = platform === 'linux' && /microsoft/i.test(release)
  const target = env.MEW_DESKTOP_HELPER_DIR || (wsl ? undefined : directory)
  if (target && !(wsl ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(target) : path.isAbsolute(target))) throw new Error('MEW_DESKTOP_HELPER_DIR에는 호스트의 절대 경로가 필요합니다. WSL에서는 Windows 경로를 사용하세요.')
  let command, args
  if (wsl) {
    const converted = run('wslpath', ['-w', path.join(directory, 'install.ps1')], { encoding: 'utf8' })
    if (converted.status !== 0) throw new Error('Windows 경로를 찾을 수 없습니다. WSL interop를 확인해 주세요.')
    command = resolvePowerShell({ env }); args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', converted.stdout.trim()]
    if (target) args.push('-Target', target)
  } else if (platform === 'win32') {
    command = 'powershell.exe'; args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'install.ps1'), '-Target', target]
  } else if (platform === 'darwin' || platform === 'linux') {
    command = 'npm'
    rmSync(path.join(target, '.mew-ready'), { force: true })
    if (path.resolve(target) !== directory) {
      mkdirSync(target, { recursive: true })
      for (const file of HELPER_FILES) copyFileSync(path.join(directory, file), path.join(target, file))
    }
    console.log('[1/3] Installing helper dependencies...')
    args = ['ci', '--prefix', target, '--omit=dev', '--no-audit', '--no-fund']
  } else throw new Error('이 운영체제에서는 원격 데스크톱을 사용할 수 없습니다.')
  const reuse = !wsl && platform !== 'win32' && dependenciesCurrent(target)
  if (reuse) console.log('Dependencies unchanged; reusing the installed runtime.')
  const result = reuse ? { status: 0 } : run(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`${command}: ${result.error.message}${wsl ? ' PowerShell 실행에 실패했습니다. WSL interop가 켜져 있고 현재 세션의 WSL_INTEROP 소켓이 유효한지 확인해 주세요.' : ''}`)
  if (result.status !== 0) return result.status ?? 1
  if (wsl || platform === 'win32') return 0
  const code = installRuntime({ target, platform })
  if (code === 0) {
    installCapture({ target, platform })
    markHelperReady(target)
    console.log('Mew remote desktop helper installed and verified. The viewer will connect automatically.')
  }
  return code
}

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  try { process.exitCode = installDesktopHelper() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
