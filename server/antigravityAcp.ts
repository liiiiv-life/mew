import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'

// Google LLC's ACP Registry distribution, deliberately separate from the agy TUI.
export const ANTIGRAVITY_ACP_VERSION = '1.1.1'

export function antigravityDistribution(platform = process.platform, arch = process.arch) {
  const targets: Record<string, string> = {
    'linux-x64': 'linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip',
    'linux-arm64': 'linux/agy-acp-server-agy_acp_server_1.1.1-linux-arm64.zip',
    'darwin-arm64': 'macos/agy-acp-server-agy_acp_server_1.1.1-darwin-arm64.zip',
  }
  const archive = targets[`${platform}-${arch}`]
  if (!archive) throw new Error(`Antigravity ACP 공식 배포본이 없는 플랫폼입니다: ${platform}/${arch}`)
  return { url: `https://dl.google.com/agy-extensions/releases/${archive}`, args: platform === 'linux' ? ['--uid='] : [] }
}

export function antigravityInstallDir() {
  return path.join(DATA_DIR, 'runtimes', 'antigravity-acp', `${ANTIGRAVITY_ACP_VERSION}-${process.platform}-${process.arch}`)
}

export function antigravityCommand() {
  return path.join(antigravityInstallDir(), 'agy_acp_server.par')
}

/** OAuth URLs stay in transient auth events; never copy stderr into transcripts or logs. */
export function antigravityAuthUrl(line: string): string | null {
  for (const raw of line.match(/https:\/\/[^\s<>"']+/g) ?? []) {
    try {
      const url = new URL(raw)
      if (url.hostname === 'accounts.google.com' && !url.username && !url.password && !url.port
        && /^\/(?:o\/oauth2\/|o\/oauth2$)/.test(url.pathname)) return url.toString()
    } catch { /* Ignore malformed stderr URLs. */ }
  }
  return null
}
