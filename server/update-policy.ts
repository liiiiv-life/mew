import path from 'node:path'
/** Match agent hosts and CLI process arguments, including script-based npm executables. */
export function agentProcessRunning(processes: string, runtime: string, commands: string[]): boolean {
  return processes.split('\n').some(line => {
    const args = line.trim().split(/\s+/)
    const host = args.indexOf('--host')
    if (host >= 0 && args[host + 1] === runtime && args.some(arg => path.basename(arg) === 'agentHost.ts')) return true
    return args.some(arg => commands.some(command => arg === command || path.basename(arg) === path.basename(command)))
  })
}

export function primeReleaseUrl(installer: string, baseOverride?: string, channel = 'stable'): string {
  if (!['stable', 'beta'].includes(channel)) throw new Error('Prime 릴리스 채널을 확인해 주세요')
  const base = baseOverride || installer.match(/prime_agent_base_url="\$\{PRIME_AGENT_DOWNLOAD_BASE_URL:-(https:\/\/[^}"\s]+)\}"/)?.[1]
  if (!base || new URL(base).protocol !== 'https:') throw new Error('Prime 공식 배포 경로를 읽지 못했습니다')
  return `${base.replace(/\/$/, '')}/${channel}`
}

export function primeReleaseVersion(value: string): string {
  const version = value.trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Prime 최신 버전을 읽지 못했습니다')
  return version
}
