import { GitConnectionError, type GitIdentity } from './git-connections.ts'

export interface DeviceAuthorization { deviceCode: string; code: string; verificationUrl: string; expiresIn: number; interval: number }
export type DeviceToken = { state: 'pending' | 'slow_down' } | { state: 'complete'; accessToken: string; expiresAt?: number }
export interface GitProvider {
  gitUsername: string; acceptsPath(pathname: string): boolean
  id: string; host: string; verificationUrl: string; configured(): boolean
  begin(): Promise<DeviceAuthorization>
  poll(deviceCode: string): Promise<DeviceToken>
  identify(accessToken: string): Promise<{ login: string; identity: GitIdentity }>
}

// Public OAuth app identifier; device flow does not use a client secret.
const DEFAULT_GITHUB_CLIENT_ID = 'Ov23liKEjrduHJdXyo7m'

export function githubProvider(request: typeof fetch = fetch, clientId = () => process.env.MEW_GITHUB_CLIENT_ID?.trim() || DEFAULT_GITHUB_CLIENT_ID): GitProvider {
  const post = async (endpoint: string, values: Record<string, string>) => {
    const response = await request(`https://github.com/login/${endpoint}`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), ...values }), signal: AbortSignal.timeout(20_000), redirect: 'error',
    })
    if (!response.ok) throw new Error('GitHub 인증 서버에 연결하지 못했습니다. 다시 시도하세요.')
    return await response.json() as Record<string, unknown>
  }
  return {
    gitUsername: 'x-access-token', acceptsPath: pathname => /^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(pathname),
    id: 'github', host: 'github.com', verificationUrl: 'https://github.com/login/device',
    configured: () => !!clientId().trim(),
    async begin() {
      if (!clientId().trim()) throw new GitConnectionError('서버에 MEW_GITHUB_CLIENT_ID를 설정하고 앱의 Device flow를 활성화하세요.', 503, 'git-provider-unconfigured')
      const data = await post('device/code', { scope: 'repo read:user' })
      if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string' || !/^[A-Z0-9-]{4,32}$/.test(data.user_code) || data.verification_uri !== 'https://github.com/login/device') throw new Error('GitHub 승인 코드를 받지 못했습니다. 앱의 Device flow 설정을 확인하세요.')
      return { deviceCode: data.device_code, code: data.user_code, verificationUrl: data.verification_uri, expiresIn: Math.min(Number(data.expires_in) || 900, 900), interval: Math.max(Number(data.interval) || 5, 5) }
    },
    async poll(deviceCode) {
      const data = await post('oauth/access_token', { device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
      if (data.error === 'authorization_pending') return { state: 'pending' }
      if (data.error === 'slow_down') return { state: 'slow_down' }
      if (typeof data.access_token !== 'string' || !data.access_token) throw new Error(data.error === 'access_denied' ? 'GitHub 로그인을 취소했습니다.' : 'GitHub 로그인이 만료되었거나 실패했습니다. 다시 로그인하세요.')
      return { state: 'complete', accessToken: data.access_token, ...(typeof data.expires_in === 'number' ? { expiresAt: Date.now() + data.expires_in * 1000 } : {}) }
    },
    async identify(accessToken) {
      const response = await request('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' })
      if (response.status === 401) throw new GitConnectionError('GitHub 연결이 만료되었습니다. 다시 로그인하세요.')
      if (!response.ok) throw new GitConnectionError('GitHub 계정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.', 503, 'git-provider-unavailable')
      const user = await response.json() as { id: number; login: string; name?: string }
      if (!Number.isSafeInteger(user.id) || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(user.login)) throw new Error('GitHub 계정 정보가 올바르지 않습니다.')
      const name = (user.name || user.login).replace(/[<>\r\n]/g, '').replaceAll('\0', '').trim().slice(0, 200) || user.login
      return { login: user.login, identity: { name, email: `${user.id}+${user.login}@users.noreply.github.com` } }
    },
  }
}
export const gitProviders: readonly GitProvider[] = [githubProvider()]
export function gitProvider(id = 'github', host = 'github.com'): GitProvider {
  const provider = gitProviders.find(item => item.id === id && item.host === host)
  if (!provider) throw new GitConnectionError('아직 지원하지 않는 Git 제공자입니다.', 400, 'git-provider-unsupported')
  return provider
}
