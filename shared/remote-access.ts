import { previewRemotePath } from './port-preview.ts'
export const REMOTE_PROTOCOL = 1
export const REMOTE_TOKEN_CLOCK_TOLERANCE = 2
export const REMOTE_REQUEST_HEADERS = ['accept', 'content-type', 'range', 'if-match', 'if-none-match', 'if-range', 'x-mew-task-owner', 'x-mew-git-owner', 'x-mew-git-workspace', 'x-mew-debug-workspace'] as const
export const REMOTE_LIMITS = Object.freeze({ frame: 32 * 1024, chunk: 12 * 1024, responseWindow: 8, queue: 512 * 1024, streams: 16, body: 25 * 1024 * 1024, uploads: 64 * 1024 * 1024, signal: 96 * 1024, lease: 60_000, renew: 20_000, ticket: 60_000 })
export type RemoteFlowControl = { version: 1; maxWindow: number; separateStreams?: true }
export const REMOTE_FLOW_CONTROL: RemoteFlowControl = Object.freeze({ version: 1, maxWindow: 256, separateStreams: true })
export type RemoteNetworkStatus = { state: 'checking' | 'ready' | 'blocked' | 'unknown' | 'preparing'; reason?: string; error?: string }
export type RemoteConnectivityStatus = { gathering: 'new' | 'gathering' | 'complete'; host: number; srflx: number; public4: number; ipv6: number; mapping?: string }
export type RemoteStatus = { enabled: boolean; state: 'disabled' | 'connecting' | 'online' | 'offline' | 'registering' | 'error'; url?: string; username?: string; deviceName?: string; dashboardUrl?: string; addressError?: string; registrationUrl?: string; expiresAt?: number; error?: string; network?: RemoteNetworkStatus; connectivity?: RemoteConnectivityStatus }
export type RemoteFrame =
  | { type: 'request'; capability?: 'port-preview'; id: string; method: string; path: string; headers: Record<string, string>; body?: string; responseWindow?: number; flowControl?: RemoteFlowControl }
  | { type: 'response'; id: string; status: number; headers: Record<string, string>; responseWindow?: number; flowControl?: RemoteFlowControl }
  | { type: 'chunk'; id: string; data: string }
  | { type: 'end'; id: string }
  | { type: 'cancel'; id: string }
  | { type: 'credit'; id: string; count?: number }
  | { type: 'socket'; capability?: 'port-preview'; id: string; path: string; protocols?: string[]; flowControl?: RemoteFlowControl }
  | { type: 'open'; id: string; protocol?: string; flowControl?: RemoteFlowControl }
  | { type: 'message'; id: string; data: string; binary: boolean; sequence?: number; final?: boolean }
  | { type: 'close'; id: string; code?: number }
  | { type: 'error'; id: string; code: string }
export function remotePath(path: unknown, socket = false, capability?: 'port-preview'): path is string {
  if (capability === 'port-preview') return previewRemotePath(path, socket)
  if (typeof path !== 'string' || path.length > 8192 || /[\r\n\\#]/.test(path) || /%(?:00|0d|0a)/i.test(path) || /%(?:2f|5c)/i.test(path.split('?')[0])) return false
  const url = new URL(path, 'https://mew.invalid')
  if (url.origin !== 'https://mew.invalid' || !path.startsWith('/api/') || url.pathname !== path.split('?')[0]) return false
  if (url.pathname.startsWith('/api/port-preview/') && !['/api/port-preview/session', '/api/port-preview/access-url'].includes(url.pathname)) return false
  if (socket) return ['/api/tmux/ws', '/api/agent/ws', '/api/presence', '/api/live/ws', '/api/collab', '/api/db/ws', '/api/login-desktop/ws', '/api/remote-desktop/ws'].includes(url.pathname)
  return (!url.pathname.startsWith('/api/remote-access') || url.pathname === '/api/remote-access/members' || url.pathname === '/api/remote-access') && (!url.pathname.startsWith('/api/auth/') || ['/api/auth/me', '/api/auth/login', '/api/auth/logout', '/api/auth/change-password', '/api/auth/profile', '/api/auth/remote-device', '/api/auth/mewlink', '/api/auth/mewlink/request', '/api/auth/mewlink/login', '/api/auth/mewlink/link'].includes(url.pathname))
}
export function parseRemoteFrame(raw: string): RemoteFrame {
  if (new TextEncoder().encode(raw).byteLength > REMOTE_LIMITS.frame) throw new Error('frame-limit')
  const value = JSON.parse(raw) as RemoteFrame
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) throw new Error('invalid-frame')
  if (!['request', 'response', 'chunk', 'end', 'cancel', 'credit', 'socket', 'open', 'message', 'close', 'error'].includes(value.type)) throw new Error('invalid-frame')
  if (value.type === 'request' && (!remotePath(value.path, false, value.capability) || (value.capability !== undefined && value.capability !== 'port-preview') || !(value.capability === 'port-preview' ? ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] : ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).includes(value.method) || !value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers) || Object.values(value.headers).some(v => typeof v !== 'string' || v.length > 8192 || /[\r\n]/.test(v)) || (value.body !== undefined && typeof value.body !== 'string'))) throw new Error('invalid-request')
  if ((value.type === 'request' || value.type === 'response') && value.responseWindow !== undefined && (!Number.isSafeInteger(value.responseWindow) || value.responseWindow < 1 || value.responseWindow > REMOTE_LIMITS.responseWindow)) throw new Error('invalid-response-window')
  if (['request', 'response', 'socket', 'open'].includes(value.type) && 'flowControl' in value && value.flowControl !== undefined) {
    const flow = value.flowControl as RemoteFlowControl
    if (!flow || typeof flow !== 'object' || Array.isArray(flow) || flow.version !== 1 || !Number.isSafeInteger(flow.maxWindow) || flow.maxWindow < REMOTE_LIMITS.responseWindow || flow.maxWindow > REMOTE_FLOW_CONTROL.maxWindow || (flow.separateStreams !== undefined && flow.separateStreams !== true)) throw new Error('invalid-flow-control')
  }
  if (value.type === 'credit' && value.count !== undefined && (!Number.isSafeInteger(value.count) || value.count < 1 || value.count > REMOTE_FLOW_CONTROL.maxWindow)) throw new Error('invalid-credit')
  if (value.type === 'socket' && ((value.capability !== undefined && value.capability !== 'port-preview') || !remotePath(value.path, true, value.capability))) throw new Error('invalid-socket')
  if (value.type === 'socket' && value.protocols !== undefined && (!Array.isArray(value.protocols) || value.protocols.length > 16 || new Set(value.protocols).size !== value.protocols.length || value.protocols.some(protocol => typeof protocol !== 'string' || protocol.length > 256 || !/^[!#$%&'*+\-.^_`|~\w]+$/.test(protocol)))) throw new Error('invalid-protocols')
  if (value.type === 'open' && value.protocol !== undefined && (typeof value.protocol !== 'string' || value.protocol.length > 256 || value.protocol !== '' && !/^[!#$%&'*+\-.^_`|~\w]+$/.test(value.protocol))) throw new Error('invalid-protocol')
  if ((value.type === 'chunk' || value.type === 'message') && (typeof value.data !== 'string' || value.data.length > Math.ceil(REMOTE_LIMITS.chunk / 3) * 4 || value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))) throw new Error('invalid-chunk')
  if (value.type === 'message' && (typeof value.binary !== 'boolean' || (value.sequence !== undefined && (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.sequence > 4096 || typeof value.final !== 'boolean')))) throw new Error('invalid-message')
  return value
}
export function sdpFingerprint(sdp: string): string {
  const values = [...sdp.matchAll(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)\r?$/gm)].map(value => value[1].toUpperCase())
  if (!values.length || values.some(value => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value) || value !== values[0])) throw new Error('invalid-fingerprint')
  return values[0]
}
