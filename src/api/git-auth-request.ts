import { uiText } from '@mew/ui/i18n-core'
/** One pending user action; closing/unmounting the login dialog cancels its continuation. */
export const GIT_LOGIN_EVENT = 'mew:git-login-required'
export const GIT_CONNECTION_CHANGED = 'mew:git-connection-changed'
export interface GitLoginRequest { project: string; finish: (connected: boolean) => void }
let pending = false
export async function gitFetch(url: string, init: RequestInit, project: string): Promise<Response> {
  const response = await fetch(url, init)
  if (response.status !== 428) return response
  const challenge = await response.clone().json().catch(() => ({}))
  if (challenge.code !== 'git-auth-required') return response
  if (pending) throw new Error(uiText('Git 로그인 창에서 먼저 연결을 완료하세요.'))
  pending = true
  try {
    const connected = await new Promise<boolean>(resolve => {
      const event = new CustomEvent<GitLoginRequest>(GIT_LOGIN_EVENT, { detail: { project, finish: resolve }, cancelable: true })
      window.dispatchEvent(event)
      if (!event.defaultPrevented) resolve(false)
    })
    if (!connected) throw new Error(uiText('Git 로그인을 취소했습니다. 작성 내용은 유지됩니다.'))
    // Only the auth-required response is retried. A possibly executed mutation is never replayed.
    const headers = new Headers(init.headers)
    if (challenge.owner) headers.set('X-Mew-Git-Owner', encodeURIComponent(challenge.owner))
    if (challenge.workspace) headers.set('X-Mew-Git-Workspace', encodeURIComponent(challenge.workspace))
    return await fetch(url, { ...init, headers })
  } finally { pending = false }
}
