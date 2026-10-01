import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import { wslPowerShell } from '../native/remote-desktop/wsl-powershell.mjs'
import { helperVersion } from '../native/remote-desktop/helper-version.mjs'
import { runtimeSupportError } from '../native/remote-desktop/runtime-support.mjs'
import { nativeFirewallHint } from '../native/remote-desktop/network-support.mjs'

const execute = promisify(execFile)
const DEFAULT_ROOT = path.resolve(import.meta.dirname, '../native/remote-desktop')
export type DesktopPlatform = 'mac' | 'linux' | 'windows' | 'wsl'
export type DesktopHostSpec = { platform: DesktopPlatform; executable: string; entry: string }
export type DesktopIceServer = { urls: string | string[]; username?: string; credential?: string }
export class DesktopHostLaunchError extends Error {}
export type DesktopHostProcess = EventEmitter & { stdin: Writable; stdout: Readable; stderr: Readable; kill(signal?: NodeJS.Signals): boolean; desktopNetworkHint?: string | Promise<string | undefined> }

async function resolveWindowsBridgeSpec(spec: DesktopHostSpec, run = execute, resolvePowerShell = wslPowerShell) {
  const bridgePath = run('wslpath', ['-w', path.join(DEFAULT_ROOT, 'windows-bridge.mjs')], { timeout: 5000 })
  const nodePath = (async () => {
    // The installer puts Node beside the helper. Probe it directly through WSL
    // instead of starting PowerShell just to rediscover this known location.
    const privateExecutable = spec.entry.endsWith('native-host.mjs') ? spec.executable : path.join(path.resolve(spec.executable, '../../../..'), 'runtime', 'node.exe')
    try {
      const version = (await run(privateExecutable, ['--version'], { timeout: 5000, maxBuffer: 8192 })).stdout.toString().trim()
      const match = /^v(\d+)\.(\d+)\./.exec(version)
      if (match && (+match[1] > 22 || +match[1] === 22 && +match[2] >= 12)) return privateExecutable
    } catch { /* Older installations may use Program Files or Windows PATH. */ }
    const privateNode = path.win32.join(path.win32.dirname(spec.entry), 'runtime', 'node.exe').replaceAll("'", "''")
    const query = `$node = $null; $candidates = @('${privateNode}', (Join-Path $env:ProgramFiles "nodejs\\node.exe"), (Get-Command node.exe -ErrorAction SilentlyContinue).Source); foreach ($candidate in $candidates) { if ($candidate -and (Test-Path -LiteralPath $candidate)) { $version = & $candidate --version; if ($LASTEXITCODE -eq 0 -and $version -match '^v(\\d+)\\.(\\d+)\\.' -and ([int]$Matches[1] -gt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 12))) { $node = $candidate; break } } }; if (-not $node) { throw "Windows Node.js is required" }; @{node=$node; session=[System.Diagnostics.Process]::GetCurrentProcess().SessionId} | ConvertTo-Json -Compress`
    let info: { node: string; session: number }
    try { info = JSON.parse((await run(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: 8000, maxBuffer: 8192 })).stdout.toString().trim()) }
    catch { throw new DesktopHostLaunchError('Windows 실행 환경을 확인하지 못했습니다. Windows Node.js와 WSL interop를 확인해 주세요.') }
    if (!Number.isInteger(info.session) || !/^[A-Za-z]:[\\/]/.test(info.node)) throw new DesktopHostLaunchError('Windows 로그인 세션과 Node.js 경로를 확인하지 못했습니다.')
    return (await run('wslpath', ['-u', info.node], { timeout: 5000 })).stdout.toString().trim()
  })()
  const [executable, bridge] = await Promise.all([nodePath, bridgePath])
  return { executable, args: [bridge.stdout.toString().trim(), spec.entry] }
}

export function desktopBridgeLookup(run = execute, resolvePowerShell = wslPowerShell, now = Date.now) {
  const lookup = desktopPathCache(key => resolveWindowsBridgeSpec(JSON.parse(key)[0], run, resolvePowerShell), now)
  return (spec: DesktopHostSpec, env: NodeJS.ProcessEnv = process.env) => lookup(JSON.stringify([spec, env.WSL_INTEROP || '', env.PATH || '']))
}
const cachedBridgeSpec = desktopBridgeLookup()
export function desktopWindowsBridgeSpec(spec: DesktopHostSpec, run?: typeof execute, resolvePowerShell?: typeof wslPowerShell) {
  return run || resolvePowerShell ? resolveWindowsBridgeSpec(spec, run, resolvePowerShell) : cachedBridgeSpec(spec)
}

/** Firewall diagnostics must never gate launching the login helper. */
export async function desktopWindowsFirewallHint(spec: DesktopHostSpec, run = execute, resolvePowerShell = wslPowerShell): Promise<string | undefined> {
  const node = path.win32.join(path.win32.dirname(spec.entry), 'runtime', 'node.exe').replaceAll("'", "''")
  const query = `$rules = @(Get-NetFirewallApplicationFilter -ErrorAction Stop | Where-Object { $_.Program -eq '${node}' } | Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' }); @{ blocked = @($rules | Where-Object { $_.Action -eq 'Block' }).Count -gt 0; allowed = @($rules | Where-Object { $_.Action -eq 'Allow' }).Count -gt 0 } | ConvertTo-Json -Compress`
  try {
    const result = await run(resolvePowerShell(), ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: 8000, maxBuffer: 8192 })
    const state = JSON.parse(result.stdout.toString().trim())
    if (state?.blocked === true) return 'Windows 방화벽에 원격 데스크톱 호스트(Node)의 차단 규칙이 있습니다. Mew 보조 앱의 runtime/node.exe에 대한 네트워크 접근을 허용해 주세요.'
    if (state?.allowed === false) return 'Windows 방화벽에서 Mew 보조 앱의 runtime/node.exe에 대한 명시적 수신 허용 규칙을 확인하지 못했습니다. 원격 연결에 사용할 네트워크 프로필에서 이 앱의 UDP 수신을 허용해 주세요.'
  } catch { /* Optional diagnostics cannot fail an otherwise usable session. */ }
}

/** Cache only resolved paths, never readiness, permissions, capture or credentials. */
export function desktopPathCache<T>(lookup: (key: string) => Promise<T>, now = Date.now, ttl = 30_000) {
  let cached: { key: string; expires: number; value: Promise<T> } | undefined
  return (key: string) => {
    if (cached?.key === key && cached.expires > now()) return cached.value
    const value = lookup(key)
    const entry = { key, expires: now() + ttl, value }; cached = entry
    void value.catch(() => { if (cached === entry) cached = undefined })
    return value
  }
}
const cachedHostSpec = desktopPathCache((key: string) => {
  const [platform, helper] = JSON.parse(key) as [DesktopPlatform | null, string]
  return resolveDesktopHostSpec({ platform, env: { ...process.env, MEW_DESKTOP_HELPER_DIR: helper } })
})

export function desktopPlatform(platform = process.platform, release = os.release()): DesktopPlatform | null {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return /microsoft/i.test(release) ? 'wsl' : 'linux'
  return null
}

export function desktopIceServers(env: NodeJS.ProcessEnv = process.env): DesktopIceServer[] {
  let entries: unknown
  try { entries = JSON.parse(env.MEW_DESKTOP_ICE_SERVERS || '[{"urls":["stun:stun.l.google.com:19302","stun:stun.cloudflare.com:3478"]}]') } catch { throw new Error('MEW_DESKTOP_ICE_SERVERS는 JSON 배열이어야 합니다.') }
  if (!Array.isArray(entries) || entries.length > 8) throw new Error('원격 데스크톱 ICE 서버 설정을 확인해 주세요.')
  return entries.map((value) => {
    const urls = typeof value?.urls === 'string' ? [value.urls] : value?.urls
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some((url) => typeof url !== 'string' || url.length > 2048 || !/^stuns?:[^\s]+$/.test(url))) throw new Error('직접 연결에는 stun: 또는 stuns: 주소만 사용할 수 있습니다. TURN 중계는 지원하지 않습니다.')
    if ([value.username, value.credential].some((entry) => entry !== undefined && (typeof entry !== 'string' || entry.length > 4096))) throw new Error('ICE 서버 인증 설정을 확인해 주세요.')
    return { urls, ...(value.username ? { username: value.username } : {}), ...(value.credential ? { credential: value.credential } : {}) }
  })
}

export function desktopAutoNat(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.MEW_DESKTOP_AUTO_NAT
  if (value === undefined || value === '' || value === '1') return true
  if (value === '0') return false
  throw new Error('MEW_DESKTOP_AUTO_NAT은 0 또는 1이어야 합니다.')
}

/** A fixed UDP socket allows an operator-owned router mapping without a relay. */
export function desktopUdpPort(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = env.MEW_DESKTOP_UDP_PORT
  if (value === undefined || value === '') return undefined
  if (!/^\d{1,5}$/.test(value) || +value < 1024 || +value > 65535) throw new Error('MEW_DESKTOP_UDP_PORT는 1024–65535의 UDP 포트여야 합니다.')
  return +value
}

/** WSL starts a Windows executable; never substitute a WSLg desktop. */
async function resolveDesktopHostSpec({ platform = desktopPlatform(), env = process.env, run = execute, resolvePowerShell = wslPowerShell }: {
  platform?: DesktopPlatform | null; env?: NodeJS.ProcessEnv; run?: typeof execute; resolvePowerShell?: typeof wslPowerShell
} = {}): Promise<DesktopHostSpec> {
  if (!platform) throw new Error('이 운영체제에서는 원격 데스크톱을 사용할 수 없습니다.')
  let root = env.MEW_DESKTOP_HELPER_DIR || DEFAULT_ROOT
  if (platform === 'wsl') {
    if (!env.MEW_DESKTOP_HELPER_DIR) {
      const result = await run(resolvePowerShell({ env }), ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath("LocalApplicationData")'], { timeout: 8000, windowsHide: true, maxBuffer: 8192 })
      root = path.win32.join(String(result.stdout).trim(), 'Mew', 'remote-desktop')
    }
    if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(root)) throw new Error('WSL의 MEW_DESKTOP_HELPER_DIR에는 Windows 절대 경로가 필요합니다.')
    const entry = path.win32.join(root, 'native-host.mjs'), nativeExe = path.win32.join(root, 'runtime', 'node.exe')
    const { stdout } = await run('wslpath', ['-u', nativeExe], { timeout: 5000, maxBuffer: 8192 })
    return { platform, executable: String(stdout).trim(), entry }
  }
  if (!path.isAbsolute(root)) throw new Error('MEW_DESKTOP_HELPER_DIR에는 절대 경로가 필요합니다.')
  if (platform === 'windows') return { platform, executable: path.join(root, 'runtime', 'node.exe'), entry: path.join(root, 'native-host.mjs') }
  const relative = platform === 'mac' ? ['MewDesktop.app', 'Contents', 'MacOS', 'MewDesktop'] : ['runtime', 'node']
  return { platform, executable: path.join(root, ...relative), entry: path.join(root, 'native-host.mjs') }
}

export function desktopHostSpec(options?: Parameters<typeof resolveDesktopHostSpec>[0]): Promise<DesktopHostSpec> {
  if (options && (options.run || options.resolvePowerShell || options.env && options.env !== process.env)) return resolveDesktopHostSpec(options)
  return cachedHostSpec(JSON.stringify([options?.platform === undefined ? desktopPlatform() : options.platform, process.env.MEW_DESKTOP_HELPER_DIR || '', process.env.WSL_INTEROP || '', process.env.PATH || '']))
}

export async function desktopHelperCurrent(spec: DesktopHostSpec) {
  const root = spec.platform === 'wsl' ? path.dirname(path.dirname(spec.executable)) : path.dirname(spec.entry)
  try { return (await fs.readFile(path.join(root, '.mew-ready'), 'utf8')).trim() === helperVersion(DEFAULT_ROOT) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

export async function desktopHostStatus({ platform = desktopPlatform(), env = process.env, getSpec = desktopHostSpec, access = fs.access, current = desktopHelperCurrent }: {
  platform?: DesktopPlatform | null; env?: NodeJS.ProcessEnv; getSpec?: typeof desktopHostSpec; access?: typeof fs.access; current?: typeof desktopHelperCurrent
} = {}) {
  if (!platform) return { platform, ready: false, message: '이 운영체제에서는 원격 데스크톱을 사용할 수 없습니다.' }
  const unsupported = runtimeSupportError()
  if (unsupported) return { platform, ready: false, installable: false, message: unsupported }
  try { desktopIceServers(env); desktopUdpPort(env); desktopAutoNat(env) } catch (error) { return { platform, ready: false, message: (error as Error).message } }
  let spec: DesktopHostSpec
  try {
    spec = await getSpec({ platform, env })
  } catch (error) {
    return { platform, ready: false, installable: false, message: `보조 앱 경로를 확인하지 못했습니다. ${(error as Error).message}` }
  }
  try {
    await access(spec.executable)
    if (platform !== 'wsl') await access(spec.entry)
    if (platform === 'mac' || platform === 'linux') await access(path.join(path.dirname(spec.entry), platform === 'mac' ? 'gpu-macos.dylib' : 'gpu-linux.so'))
    if (platform === 'windows' || platform === 'wsl') await access(path.join(platform === 'wsl' ? path.dirname(path.dirname(spec.executable)) : path.dirname(spec.entry), 'gpu-windows.dll'))
    if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return { platform, ready: false, message: '서버에 로그인한 Linux 데스크톱이 필요합니다. 데스크톱 세션에서 mew를 실행해 주세요.' }
    if (!await current(spec)) return { platform, ready: false, installable: platform !== 'windows', message: '원격 데스크톱 구성 요소를 업데이트합니다.' }
    return { platform, ready: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { platform, ready: false, installable: false, message: '보조 앱 파일에 접근하지 못했습니다. 서버의 파일 권한과 Windows 드라이브 연결을 확인해 주세요.' }
    return { platform, ready: false, installable: platform !== 'windows', message: '원격 데스크톱을 처음 사용하기 위한 파일을 준비합니다.' }
  }
}

export async function spawnDesktopHost() {
  const spec = await desktopHostSpec(), env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  let executable = spec.executable, args = [spec.entry]
  if (spec.platform === 'wsl') {
    const bridge = await desktopWindowsBridgeSpec(spec)
    executable = bridge.executable; args = bridge.args
  } else if (spec.platform === 'windows') {
    executable = process.execPath; args = [path.join(DEFAULT_ROOT, 'windows-bridge.mjs'), spec.entry]
  }
  const child: DesktopHostProcess = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true })
  if (spec.platform === 'wsl') child.desktopNetworkHint = desktopWindowsFirewallHint(spec)
  else if (spec.platform === 'windows') child.desktopNetworkHint = desktopWindowsFirewallHint(spec, execute, () => path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'))
  else child.desktopNetworkHint = nativeFirewallHint({ platform: spec.platform === 'mac' ? 'darwin' : 'linux', executable: spec.executable })
  // Native diagnostics can contain window titles/URLs. Drain without recording them.
  child.stderr.resume()
  return child
}
