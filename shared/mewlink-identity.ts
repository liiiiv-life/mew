export const MEWLINK_PROVIDERS = ['google', 'github', 'apple', 'email', 'email-code'] as const
export type MewlinkProvider = (typeof MEWLINK_PROVIDERS)[number]

/** A central account is identified by its issuer and immutable subject, never its email. */
export interface MewlinkIdentity {
  issuer: string
  subject: string
  displayName: string
  provider: MewlinkProvider
  username: string | null
}

export interface MewlinkAccessRequest {
  id: string
  identity: MewlinkIdentity
  requestedAt: number
  status: 'pending' | 'denied' | 'approved'
  accountId?: string
}

export interface MewlinkIdentityLink {
  id: string
  identity: MewlinkIdentity
  accountId: string
  linkedAt: number
}

export interface MewlinkAccessStatus {
  identity: MewlinkIdentity | null
  state: 'unavailable' | 'unlinked' | 'pending' | 'denied' | 'approved'
  accountId?: string
}

export interface MewlinkAccessOverview {
  requests: MewlinkAccessRequest[]
  links: MewlinkIdentityLink[]
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim() && !Array.from(value).some(char => {
      const code = char.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f
    })
}

/** Parse only the signed ticket's identity; HTTP bodies and headers are not proof of identity. */
export function parseMewlinkIdentity(value: unknown, expectedIssuer?: string): MewlinkIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const { issuer, subject, displayName, provider, username } = candidate
  if (typeof issuer !== 'string' || issuer.length > 2048) return null
  try {
    const url = new URL(issuer)
    if (url.protocol !== 'https:' || url.origin !== issuer || url.username || url.password) return null
  } catch { return null }
  if (expectedIssuer !== undefined && issuer !== expectedIssuer) return null
  if (typeof subject !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(subject)) return null
  if (!boundedText(displayName, 200) || !MEWLINK_PROVIDERS.includes(provider as MewlinkProvider)) return null
  if (username !== null && !boundedText(username, 100)) return null
  return { issuer, subject, displayName, provider: provider as MewlinkProvider, username }
}

export function mewlinkIdentityKey(identity: MewlinkIdentity): string {
  return JSON.stringify([identity.issuer, identity.subject])
}
