import type { Capabilities } from '../../shared/access-policy'
import { mewFetch } from '../utils/remote-transport.ts'
import { json } from './response.ts'

export type Role = 'owner' | 'manager' | 'member' | 'guest'

export interface AuthStatus {
  authenticated: boolean
  accountId?: string | null
  email: string | null
  role: Role
  mustChangePassword: boolean
  displayName: string | null
  avatarDataUrl: string | null
  hasPassword?: boolean
  authenticationMethod?: 'password' | 'mewlink' | null
  capabilities?: Capabilities
  accessRevision?: string
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return mewFetch('/api/auth/me').then(json<AuthStatus>)
}

export function login(
  email: string,
  password: string,
): Promise<{ ok: true; email: string; role: Role; mustChangePassword: boolean }> {
  return mewFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(json<{ ok: true; email: string; role: Role; mustChangePassword: boolean }>)
}

export function logout(): Promise<{ ok: true }> {
  return mewFetch('/api/auth/logout', { method: 'POST' }).then(json<{ ok: true }>)
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
  return mewFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  }).then(json<{ ok: true }>)
}
