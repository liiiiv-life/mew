import type { JWK } from 'jose'

export type RemoteConnectionTarget = { instance: string } | { owner: string; name: string }

export type RemoteBootstrapContext = {
  instance: string
  account: string
  authMode: 'local'
  appOrigin: string
  centralOrigin: string
  ticketIssuers: string[]
  previewDomain?: string | null
  identity: boolean
  publicKey: JWK
}

export function remoteBootstrapUrl(origin: string, target: RemoteConnectionTarget, identity = true) {
  const url = new URL('/central/signal', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('role', 'browser')
  url.searchParams.set('bootstrap', '1')
  for (const [key, value] of Object.entries(target)) url.searchParams.set(key, value)
  if (!identity) url.searchParams.set('identity', '0')
  return url.href
}

export function parseRemoteBootstrap(value: unknown, origin: string): RemoteBootstrapContext {
  const context = value as Partial<RemoteBootstrapContext> | null
  const isOrigin = (input: unknown): input is string => {
    if (typeof input !== 'string') return false
    try { const url = new URL(input); return ['https:', 'http:'].includes(url.protocol) && url.origin === input }
    catch { return false }
  }
  if (!context || typeof context !== 'object' ||
    typeof context.instance !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(context.instance) ||
    typeof context.account !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(context.account) ||
    context.authMode !== 'local' || context.centralOrigin !== origin || !isOrigin(context.appOrigin) ||
    !Array.isArray(context.ticketIssuers) || !context.ticketIssuers.length || context.ticketIssuers.some(issuer => !isOrigin(issuer)) ||
    typeof context.identity !== 'boolean' || context.publicKey?.kty !== 'OKP' || context.publicKey.crv !== 'Ed25519' ||
    typeof context.publicKey.x !== 'string' || context.publicKey.d !== undefined ||
    context.previewDomain !== undefined && context.previewDomain !== null && typeof context.previewDomain !== 'string') {
    throw new Error('중앙 연결 정보를 확인하지 못했습니다.')
  }
  return context as RemoteBootstrapContext
}
