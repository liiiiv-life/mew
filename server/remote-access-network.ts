import { execFile } from 'node:child_process'
import { release } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { wslPowerShell } from '../native/remote-desktop/wsl-powershell.mjs'
import type { RemoteNetworkStatus } from '../shared/remote-access.ts'

type Execute = (file: string, args: string[], options: { timeout: number; windowsHide: boolean; maxBuffer: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string | Buffer }>
const execute = promisify(execFile) as Execute
const SCRIPT = path.join(import.meta.dirname, 'remote-access-network.ps1')
const ERRORS: Record<string, string> = {
  'approval-required': '직접 연결에 사용할 UDP 수신을 준비해야 합니다. 연결 준비를 누르고 Windows 승인창을 확인해 주세요.',
  'approval-cancelled': 'Windows 승인을 취소했습니다. 연결 준비를 다시 누르면 승인창을 열 수 있습니다.',
  'elevation-failed': 'Windows 관리자 승인을 받지 못했습니다. Windows에 로그인한 상태에서 연결 준비를 다시 시도해 주세요.',
  'rule-conflict': '같은 이름의 다른 방화벽 규칙이 있어 보존했습니다. 관리자가 해당 규칙을 확인해야 합니다.',
  'explicit-block': '직접 연결 포트와 겹치는 방화벽 차단 규칙이 있습니다. 기존 차단은 변경하지 않았습니다.',
  'policy-blocked': 'Windows 정책이 로컬 방화벽 규칙 적용을 제한하고 있습니다. 관리자에게 확인해 주세요.',
  'hyperv-unavailable': '이 Windows 환경에서 WSL Hyper-V 방화벽을 확인하지 못했습니다.',
  'policy-query-failed': 'Windows 방화벽 상태를 확인하지 못했습니다. 현재 정책은 변경하지 않았습니다.',
  'preparation-failed': '직접 연결을 위한 Windows 네트워크 준비에 실패했습니다. 기존 정책은 유지했습니다.',
  'verification-failed': '추가한 방화벽 규칙의 적용을 확인하지 못했습니다. 관리자에게 현재 정책을 확인해 주세요.',
  'program-unavailable': 'Mew를 실행하는 Windows Node 프로그램을 확인하지 못했습니다.',
}
const READY = new Set(['wsl-udp-rule', 'windows-udp-rule'])

/** OS preparation is separate from registration and never proves internet connectivity. */
export function createRemoteNetworkPreparation({
  platform = process.platform, kernel = release(), env = process.env, executable = process.execPath,
  script = SCRIPT, run = execute, resolvePowerShell = wslPowerShell, now = Date.now,
}: {
  platform?: NodeJS.Platform; kernel?: string; env?: NodeJS.ProcessEnv; executable?: string; script?: string
  run?: Execute; resolvePowerShell?: typeof wslPowerShell; now?: () => number
} = {}) {
  const wsl = platform === 'linux' && /microsoft/i.test(kernel)
  const windows = platform === 'win32'
  let checking: Promise<RemoteNetworkStatus> | undefined, preparing: Promise<RemoteNetworkStatus> | undefined
  let cached: RemoteNetworkStatus | undefined, checkedAt = 0
  const remember = (status: RemoteNetworkStatus) => { cached = status; checkedAt = now(); return status }

  async function inspect(prepare: boolean): Promise<RemoteNetworkStatus> {
    if (!wsl && !windows) return { state: 'unknown', reason: 'platform-unmanaged' }
    let command: string, filename = script
    try {
      if (wsl) {
        command = resolvePowerShell({ env })
        const converted = await run('wslpath', ['-w', script], { timeout: 5000, windowsHide: true, maxBuffer: 8192, env })
        filename = String(converted.stdout).trim()
        if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(filename) || /[\r\n"]/.test(filename) || filename.includes('\0')) throw new Error('invalid-script-path')
      } else {
        command = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
      }
    } catch {
      return { state: 'unknown', reason: 'windows-unavailable', error: 'Windows 실행 환경을 확인하지 못했습니다. WSL interop와 Windows 로그인 상태를 확인해 주세요.' }
    }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', filename, '-Mode', wsl ? 'Wsl' : 'Windows']
    if (windows) args.push('-Program', executable)
    if (!prepare) args.push('-CheckOnly')
    let output: string
    try {
      output = String((await run(command, args, { timeout: prepare ? 180_000 : 10_000, windowsHide: true, maxBuffer: 8192, env })).stdout)
    } catch (error) {
      // The fixed script uses nonzero exits for explicit, machine-readable failure states.
      output = typeof (error as { stdout?: unknown }).stdout === 'string' ? (error as { stdout: string }).stdout : ''
    }
    try {
      const result = JSON.parse(output.trim()) as { state?: string; reason?: string }
      if (typeof result.reason !== 'string') throw new Error('invalid-result')
      if (result.state === 'ready' && READY.has(result.reason)) return { state: 'ready', reason: result.reason }
      if (!['blocked', 'unknown'].includes(result.state ?? '') || !ERRORS[result.reason]) throw new Error('invalid-result')
      return { state: result.state as 'blocked' | 'unknown', reason: result.reason, error: ERRORS[result.reason] }
    } catch {
      return { state: 'unknown', reason: prepare ? 'preparation-failed' : 'policy-query-failed', error: ERRORS[prepare ? 'preparation-failed' : 'policy-query-failed'] }
    }
  }

  return {
    check(): Promise<RemoteNetworkStatus> {
      if (preparing) return Promise.resolve({ state: 'preparing' })
      if (cached && now() - checkedAt < 30_000) return Promise.resolve(cached)
      if (!checking) checking = inspect(false).then(remember).finally(() => { checking = undefined })
      return checking
    },
    prepare(): Promise<RemoteNetworkStatus> {
      if (!preparing) {
        const previous = checking
        preparing = (previous ?? Promise.resolve()).then(() => inspect(true)).then(remember).finally(() => { preparing = undefined })
      }
      return preparing
    },
  }
}
