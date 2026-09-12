import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../native/remote-desktop')
export type DesktopPlatform = 'mac' | 'linux' | 'windows' | 'wsl'
export type DesktopHostSpec = { platform: DesktopPlatform; executable: string; entry: string }
export type DesktopIceServer = { urls: string | string[]; username?: string; credential?: string }

export function desktopPlatform(platform = process.platform, release = os.release()): DesktopPlatform | null {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return /microsoft/i.test(release) ? 'wsl' : 'linux'
  return null
}

export function desktopIceServers(env: NodeJS.ProcessEnv = process.env): DesktopIceServer[] {
  let entries: unknown
  try { entries = JSON.parse(env.MEW_DESKTOP_ICE_SERVERS || '[]') } catch { throw new Error('MEW_DESKTOP_ICE_SERVERS는 JSON 배열이어야 합니다.') }
  if (!Array.isArray(entries) || entries.length > 8) throw new Error('원격 데스크톱 ICE 서버 설정을 확인해 주세요.')
  return entries.map((value) => {
    const urls = typeof value?.urls === 'string' ? [value.urls] : value?.urls
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some((url) => typeof url !== 'string' || url.length > 2048 || !/^(stun|stuns|turn|turns):[^\s]+$/.test(url))) throw new Error('ICE 서버에는 stun: 또는 turn: 주소가 필요합니다.')
    if ([value.username, value.credential].some((entry) => entry !== undefined && (typeof entry !== 'string' || entry.length > 4096))) throw new Error('ICE 서버 인증 설정을 확인해 주세요.')
    return { urls, ...(value.username ? { username: value.username } : {}), ...(value.credential ? { credential: value.credential } : {}) }
  })
}

/** WSL starts a Windows executable; never substitute a WSLg desktop. */
export async function desktopHostSpec({ platform = desktopPlatform(), env = process.env, run = execute }: {
  platform?: DesktopPlatform | null; env?: NodeJS.ProcessEnv; run?: typeof execute
} = {}): Promise<DesktopHostSpec> {
  if (!platform) throw new Error('이 운영체제에서는 원격 데스크톱을 사용할 수 없습니다.')
  let root = env.MEW_DESKTOP_HELPER_DIR || DEFAULT_ROOT
  if (platform === 'wsl') {
    if (!env.MEW_DESKTOP_HELPER_DIR) {
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath("LocalApplicationData")'], { timeout: 8000, windowsHide: true, maxBuffer: 8192 })
      root = path.win32.join(String(result.stdout).trim(), 'Mew', 'remote-desktop')
    }
    if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(root)) throw new Error('WSL의 MEW_DESKTOP_HELPER_DIR에는 Windows 절대 경로가 필요합니다.')
    const entry = path.win32.join(root, 'main.mjs'), nativeExe = path.win32.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    const { stdout } = await run('wslpath', ['-u', nativeExe], { timeout: 5000, maxBuffer: 8192 })
    return { platform, executable: String(stdout).trim(), entry }
  }
  if (!path.isAbsolute(root)) throw new Error('MEW_DESKTOP_HELPER_DIR에는 절대 경로가 필요합니다.')
  const relative = platform === 'mac' ? ['Electron.app', 'Contents', 'MacOS', 'Electron'] : [platform === 'windows' ? 'electron.exe' : 'electron']
  return { platform, executable: path.join(root, 'node_modules', 'electron', 'dist', ...relative), entry: path.join(root, 'main.mjs') }
}

export async function desktopHostStatus() {
  const platform = desktopPlatform()
  if (!platform) return { platform, ready: false, message: '이 운영체제에서는 원격 데스크톱을 사용할 수 없습니다.' }
  try { desktopIceServers() } catch (error) { return { platform, ready: false, message: (error as Error).message } }
  try {
    const spec = await desktopHostSpec()
    await fs.access(spec.executable)
    if (platform !== 'wsl') await fs.access(spec.entry)
    if (platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return { platform, ready: false, message: '서버에 로그인한 Linux 데스크톱이 필요합니다. 데스크톱 세션에서 mew를 실행해 주세요.' }
    return { platform, ready: true }
  } catch {
    return { platform, ready: false, installable: platform !== 'windows', message: '원격 데스크톱 보조 앱을 준비해야 합니다. 아래 설치 버튼으로 진행해 주세요. WSL은 Windows의 Node.js와 WSL interop가 필요합니다.' }
  }
}

export async function spawnDesktopHost() {
  const spec = await desktopHostSpec(), env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  const child = spawn(spec.executable, [spec.entry], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true })
  // Native diagnostics can contain window titles/URLs. Drain without recording them.
  child.stderr.resume()
  return child
}
