import { createTrustedDeviceSession, getSession, resumeRemoteSession, type AuthenticatedSession } from './auth.ts'
import { resolveMewlinkSession } from './mewlink-identities.ts'
import type { MewlinkIdentity } from '../shared/mewlink-identity.ts'

export const REMOTE_LOGIN_TIMEOUT = 5 * 60_000

/** Authentication belongs to a connection; an external identity never becomes a password bearer. */
export function createRemoteAuthentication(identity: MewlinkIdentity | null, browserKey?: string) {
  let token: string | null = null
  let external = identity ? resolveMewlinkSession(identity) : null
  let loginDeadline: number | null = Date.now() + REMOTE_LOGIN_TIMEOUT

  function current(): AuthenticatedSession | null {
    if (token) return getSession(token, browserKey)
    if (!external || !identity) return null
    const session = resolveMewlinkSession(identity)
    if (!session || session.email !== external.email || session.credentialId !== external.credentialId) {
      external = null
      return null
    }
    return session
  }

  function ready() {
    const session = current()
    if (session && !session.user.mustChangePassword) loginDeadline = null
    else loginDeadline ??= Date.now() + REMOTE_LOGIN_TIMEOUT
    return loginDeadline === null || loginDeadline > Date.now()
  }

  function setSessionToken(value: string | null) {
    external = null
    token = value
    ready()
  }

  function activateMewlink() {
    const session = identity ? resolveMewlinkSession(identity) : null
    if (!session) throw new Error('승인된 Mewlink 계정이 아닙니다.')
    token = null
    external = session
    ready()
  }

  function resume(value: string | null) {
    const session = value ? resumeRemoteSession(value, browserKey) : null
    if (session) setSessionToken(value)
    return session?.trustedDevice ?? null
  }

  function trustDevice(label: string): Promise<string> {
    const session = current()
    if (!session || session.user.mustChangePassword || !browserKey) throw new Error('login-required')
    const next = createTrustedDeviceSession(session, browserKey, label, token)
    setSessionToken(next)
    return Promise.resolve(next)
  }

  return { current, ready, resume, trustDevice, setSessionToken, activateMewlink, sessionToken: () => token, identity: () => identity }
}
