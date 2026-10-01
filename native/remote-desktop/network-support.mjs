import { accessSync, constants } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { release as osRelease } from 'node:os'
const run = promisify(execFile)

/** Desktop services often omit /sbin from PATH. Never select a user PATH tool. */
export function linuxNetworkTool(name, executable = file => { try { accessSync(file, constants.X_OK); return true } catch { return false } }) {
  if (!['ip', 'ufw', 'firewall-cmd'].includes(name)) throw new Error('Unsupported network tool')
  return ['/usr/sbin', '/sbin', '/usr/bin', '/bin'].map(root => `${root}/${name}`).find(executable)
}

/** Recovery hints only: no sudo, policy mutation, or claim that packets are blocked. */
export async function nativeFirewallHint({ platform = process.platform, executable, release = osRelease(), execute = run, read = readFile, tool = linuxNetworkTool } = {}) {
  const query = (command, args) => execute(command, args, { timeout: 1500, maxBuffer: 8192, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } }).then(result => String(result.stdout)).catch(() => '')
  if (platform === 'darwin') {
    const command = '/usr/libexec/ApplicationFirewall/socketfilterfw'
    const global = await query(command, ['--getglobalstate'])
    const hints = []
    if (/\b(?:enabled|on)\b|State\s*=\s*[12]\b/i.test(global)) {
      const [all, app] = await Promise.all([query(command, ['--getblockall']), query(command, ['--getappblocked', executable])])
      if (/\b(?:enabled|on)\b/i.test(all)) hints.push('Mac 방화벽에서 모든 수신 연결을 차단하고 있습니다. 서버 Mac의 네트워크 보안 정책을 확인해 주세요.')
      else if (/^\s*(?:Block incoming connections|Incoming connections:\s*(?:block|deny))\s*$/im.test(app)) hints.push('Mac 방화벽에 MewDesktop의 수신 차단이 있습니다. 서버 Mac의 방화벽에서 이 앱의 수신 권한을 확인해 주세요.')
      else if (!/^\s*(?:Allow incoming connections|Incoming connections:\s*allow)\s*$/im.test(app)) hints.push('서버 Mac의 방화벽에서 MewDesktop의 수신 연결 허용을 확인해 주세요.')
    }
    if (Number(release.split('.')[0]) >= 24) hints.push('macOS 15 이상에서는 서버 Mac의 개인정보 보호 및 보안 → 로컬 네트워크에서 Mew Desktop 또는 이를 시작한 앱의 승인을 확인해 주세요.')
    return hints.join(' ') || undefined
  }
  if (platform !== 'linux') return undefined
  const ufw = await read('/etc/ufw/ufw.conf', 'utf8').catch(() => '')
  if (/^\s*ENABLED\s*=\s*yes\s*(?:#.*)?$/im.test(ufw)) return '서버 Linux에서 UFW가 켜져 있습니다. 원격 데스크톱 UDP 수신 정책을 확인해 주세요. 공유기 임시 매핑과 PC 방화벽 허용은 별개입니다.'
  const firewall = tool('firewall-cmd')
  if (firewall && /^running\s*$/i.test((await query(firewall, ['--state'])).trim())) return '서버 Linux에서 firewalld가 켜져 있습니다. 현재 네트워크 zone의 원격 데스크톱 UDP 수신 정책을 확인해 주세요. 공유기 임시 매핑과 PC 방화벽 허용은 별개입니다.'
}
