import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, copyFileSync } from 'node:fs'
import { wslPowerShell } from './wsl-powershell.mjs'
import { installDesktopRuntime } from './install-runtime.mjs'

const entry = fileURLToPath(import.meta.url)
export function installDesktopHelper({ platform = process.platform, release = os.release(), env = process.env, run = spawnSync, directory = path.dirname(entry), resolvePowerShell = wslPowerShell, installRuntime = installDesktopRuntime } = {}) {
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
    if (path.resolve(target) !== directory) {
      mkdirSync(target, { recursive: true })
      for (const file of ['package.json', 'package-lock.json', 'main.mjs', 'preload.cjs', 'app.html', 'sender.mjs', 'protocol.mjs', 'keys.mjs', 'input-native.mjs', 'input-portal.mjs']) copyFileSync(path.join(directory, file), path.join(target, file))
    }
    console.log('[1/3] Installing helper dependencies...')
    args = ['ci', '--prefix', target, '--omit=dev', '--no-audit', '--no-fund']
  } else throw new Error('이 운영체제에서는 원격 데스크톱을 사용할 수 없습니다.')
  const result = run(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`${command}: ${result.error.message}${wsl ? ' PowerShell 실행에 실패했습니다. WSL interop가 켜져 있고 현재 세션의 WSL_INTEROP 소켓이 유효한지 확인해 주세요.' : ''}`)
  if (result.status !== 0) return result.status ?? 1
  return wsl || platform === 'win32' ? 0 : installRuntime({ target, platform })
}

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  try { process.exitCode = installDesktopHelper() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
