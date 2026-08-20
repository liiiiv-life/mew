import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface AndroidEnvFix { context: string; command?: string }
export interface AndroidEnvCheck { id: string; label: string; ok: boolean; detail: string; fixes?: AndroidEnvFix[] }
export interface AndroidSuggestedCommand { context: string; command: string }
export interface AndroidEnvStatus {
  platform: NodeJS.Platform
  architecture: string
  isWsl: boolean
  sdkRoot: string
  checks: AndroidEnvCheck[]
  suggestedCommands: AndroidSuggestedCommand[]
}

function fileExists(file: string): boolean {
  try { fs.accessSync(file, fs.constants.F_OK); return true } catch { return false }
}

function canReadWrite(file: string): boolean {
  try { fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK); return true } catch { return false }
}

function executable(file: string): boolean {
  try { fs.accessSync(file, fs.constants.X_OK); return true } catch { return false }
}

export function defaultSdkRoot(platform: NodeJS.Platform, home: string): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Android', 'sdk')
  return path.join(home, 'Android', 'Sdk')
}

function sdkRoot(): string {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdkRoot(process.platform, os.homedir())
}

function isWsl(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase()
    return version.includes('microsoft') || version.includes('wsl')
  } catch { return false }
}

function commandPaths(root: string) {
  return {
    adb: path.join(root, 'platform-tools', 'adb'),
    emulator: path.join(root, 'emulator', 'emulator'),
    avdmanager: path.join(root, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    sdkmanager: path.join(root, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'),
  }
}

export function systemImageArchitecture(architecture: string): 'arm64-v8a' | 'x86_64' {
  return architecture === 'arm64' ? 'arm64-v8a' : 'x86_64'
}

async function avdCount(avdmanager: string): Promise<number | null> {
  if (!executable(avdmanager)) return null
  try {
    const { stdout } = await run(avdmanager, ['list', 'avd'], { timeout: 5000 })
    return stdout.split('\n').filter((line) => line.trim().startsWith('Name:')).length
  } catch { return null }
}

async function accelerationStatus(emulator: string): Promise<{ ok: boolean; detail: string } | null> {
  if (!executable(emulator)) return null
  try {
    const { stdout, stderr } = await run(emulator, ['-accel-check'], { timeout: 5000 })
    const detail = `${stdout}\n${stderr}`.trim().split('\n').filter(Boolean).at(-1)
    return { ok: true, detail: detail || '하드웨어 가속 사용 가능' }
  } catch (error) {
    const output = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : ''
    return { ok: false, detail: output.split('\n').filter(Boolean).at(-1) || '하드웨어 가속 사용 불가' }
  }
}

export async function collectAndroidEnvStatus(): Promise<AndroidEnvStatus> {
  const platform = process.platform
  const architecture = os.arch()
  const wsl = platform === 'linux' && isWsl()
  const supported = platform === 'linux' || platform === 'darwin'
  const root = sdkRoot()
  const tools = commandPaths(root)
  const hasSdkManager = executable(tools.sdkmanager)
  const hasEmulator = executable(tools.emulator)
  const imageArchitecture = systemImageArchitecture(architecture)
  const imagePackage = `system-images;android-36;google_apis;${imageArchitecture}`
  const count = await avdCount(tools.avdmanager)
  const acceleration = await accelerationStatus(tools.emulator)
  const createCommand = `${tools.avdmanager} create avd -n mew-api36 -k "${imagePackage}"`
  const checks: AndroidEnvCheck[] = [{
    id: 'host', label: '호스트', ok: supported,
    detail: platform === 'darwin' ? `macOS ${architecture}` : wsl ? `WSL ${architecture}` : `${platform} ${architecture}`,
  }]

  if (platform === 'linux') {
    const kvmExists = fileExists('/dev/kvm')
    const kvmUsable = kvmExists && canReadWrite('/dev/kvm')
    checks.push(
      {
        id: 'kvm-device', label: '/dev/kvm', ok: kvmExists,
        detail: kvmExists ? '/dev/kvm 존재' : '/dev/kvm 없음',
        fixes: kvmExists ? undefined : [{ context: wsl ? 'WSL nested virtualization과 KVM 노출을 확인' : 'BIOS/UEFI 가상화와 KVM 설치를 확인' }],
      },
      {
        id: 'kvm-permission', label: 'KVM 권한', ok: kvmUsable,
        detail: kvmUsable ? '현재 사용자가 /dev/kvm 읽기/쓰기 가능' : '현재 사용자가 /dev/kvm 읽기/쓰기 불가',
        fixes: kvmUsable ? undefined : wsl
          ? [
              { context: 'WSL에서 실행', command: `sudo usermod -aG kvm ${os.userInfo().username}` },
              { context: '그다음 Windows PowerShell 또는 CMD에서 실행', command: 'wsl --shutdown' },
            ]
          : [
              { context: 'Linux에서 실행', command: `sudo usermod -aG kvm ${os.userInfo().username}` },
              { context: '그다음 로그아웃 후 다시 로그인' },
            ],
      },
    )
  } else if (platform === 'darwin' && acceleration) {
    checks.push({
      id: 'acceleration', label: '가속', ok: acceleration.ok, detail: acceleration.detail,
      fixes: acceleration.ok ? undefined : [{ context: 'macOS와 Android Emulator를 최신 버전으로 업데이트' }],
    })
  }

  checks.push(
    {
      id: 'sdkmanager', label: 'sdkmanager', ok: hasSdkManager,
      detail: hasSdkManager ? tools.sdkmanager : 'Android SDK Command-Line Tools 없음',
      fixes: hasSdkManager ? undefined : [{ context: 'Android Studio의 SDK Manager에서 Android SDK Command-Line Tools (latest)를 설치' }],
    },
    {
      id: 'adb', label: 'adb', ok: executable(tools.adb),
      detail: executable(tools.adb) ? tools.adb : 'Android SDK Platform-Tools 없음',
      fixes: executable(tools.adb) || !hasSdkManager ? undefined : [{ context: '터미널에서 실행', command: `${tools.sdkmanager} "platform-tools"` }],
    },
    {
      id: 'emulator', label: 'emulator', ok: hasEmulator,
      detail: hasEmulator ? tools.emulator : 'Android Emulator 패키지 없음',
      fixes: hasEmulator || !hasSdkManager ? undefined : [{ context: '터미널에서 실행', command: `${tools.sdkmanager} "emulator"` }],
    },
    {
      id: 'avdmanager', label: 'avdmanager', ok: executable(tools.avdmanager),
      detail: executable(tools.avdmanager) ? tools.avdmanager : 'Android SDK Command-Line Tools 없음',
    },
    {
      id: 'avd', label: 'AVD', ok: typeof count === 'number' && count > 0,
      detail: typeof count === 'number' ? `${count}개` : 'avdmanager가 없어 확인 불가',
      fixes: typeof count === 'number' && count === 0 ? [{ context: `${imageArchitecture} AVD 생성`, command: createCommand }] : undefined,
    },
  )

  const suggestedCommands: AndroidSuggestedCommand[] = []
  if (hasSdkManager) {
    suggestedCommands.push(
      { context: 'SDK 라이선스 확인', command: `${tools.sdkmanager} --licenses` },
      { context: `${imageArchitecture} 도구와 system image 설치`, command: `${tools.sdkmanager} "platform-tools" "emulator" "${imagePackage}"` },
    )
  }
  if (executable(tools.avdmanager)) suggestedCommands.push({ context: 'AVD가 없을 때 생성', command: createCommand })
  if (hasEmulator) suggestedCommands.push({ context: '헤드리스 emulator 실행', command: `${tools.emulator} @mew-api36 -no-window -no-snapshot` })

  return { platform, architecture, isWsl: wsl, sdkRoot: root, checks, suggestedCommands }
}
