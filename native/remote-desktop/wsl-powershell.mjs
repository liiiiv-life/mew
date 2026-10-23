import { accessSync, constants, readFileSync } from 'node:fs'
import path from 'node:path'

const relative = 'Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
const unescapeMount = value => value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))

/** Resolve without executing anything: installation must never be retried as a discovery probe. */
export function wslPowerShell({ env = process.env, readMounts = () => readFileSync('/proc/mounts', 'utf8'), readInterop = file => readFileSync(file, 'utf8'), executable = file => {
  try { accessSync(file, constants.X_OK); return true } catch { return false }
} } = {}) {
  const fromPath = (env.PATH || '').split(':').filter(Boolean).map(directory => path.posix.join(directory, 'powershell.exe'))
  const found = fromPath.find(executable)
  if (found) { checkInterop(readInterop); return found }
  let mounts = ''
  try { mounts = readMounts() } catch { /* The standard mount remains a fallback. */ }
  const roots = mounts.split('\n').flatMap(line => {
    const [source = '', mount = ''] = line.split(/\s+/).map(unescapeMount)
    // Only Windows drive roots, not binds of arbitrary Windows subdirectories.
    return /^[A-Za-z]:[\\/]?$/.test(source) && mount.startsWith('/') ? [mount] : []
  })
  const candidates = [...new Set([...roots.map(root => path.posix.join(root, relative)), `/mnt/c/${relative}`])]
  const resolved = candidates.find(executable)
  if (resolved) { checkInterop(readInterop); return resolved }
  throw new Error('Windows PowerShell을 찾지 못했습니다. WSL에서 Windows 드라이브가 마운트되어 있는지 확인해 주세요. Windows PATH를 추가할 필요는 없습니다.')
}

function checkInterop(read) {
  let status, registration
  try {
    status = read('/proc/sys/fs/binfmt_misc/status')
    registration = read('/proc/sys/fs/binfmt_misc/WSLInterop')
  } catch {
    throw new Error('WSL interop의 Windows 실행 파일 등록(WSLInterop)을 확인하지 못했습니다. Windows PowerShell에서 wsl --shutdown을 실행한 뒤 WSL과 mew를 다시 시작해 주세요. 실행 중인 모든 WSL 배포판이 종료됩니다.')
  }
  if (!/^enabled\s*$/m.test(status) || !/^enabled\s*$/m.test(registration)) {
    throw new Error('WSL interop의 Windows 실행 파일 실행 기능이 꺼져 있습니다. WSL interop 설정과 binfmt_misc/WSLInterop 활성화 상태를 확인해 주세요.')
  }
}
