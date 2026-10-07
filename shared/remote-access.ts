export const REMOTE_PROTOCOL = 1
export const REMOTE_REQUEST_HEADERS = ['accept', 'content-type', 'range', 'if-match', 'if-none-match', 'if-range', 'x-mew-task-owner', 'x-mew-git-owner', 'x-mew-git-workspace', 'x-mew-debug-workspace'] as const
export const REMOTE_LIMITS = Object.freeze({ frame: 32 * 1024, chunk: 12 * 1024, queue: 512 * 1024, streams: 16, body: 25 * 1024 * 1024, uploads: 64 * 1024 * 1024, signal: 96 * 1024, lease: 60_000, renew: 20_000, ticket: 60_000 })
export type RemoteStatus = { enabled: boolean; state: 'disabled' | 'connecting' | 'online' | 'offline' | 'registering' | 'error'; url?: string; registrationUrl?: string; expiresAt?: number; error?: string }
export type RemoteFrame =
  | { type: 'request'; id: string; method: string; path: string; headers: Record<string, string>; body?: string }
  | { type: 'response'; id: string; status: number; headers: Record<string, string> }
  | { type: 'chunk'; id: string; data: string }
  | { type: 'end'; id: string }
  | { type: 'cancel'; id: string }
  | { type: 'credit'; id: string }
  | { type: 'socket'; id: string; path: string }
  | { type: 'open'; id: string }
  | { type: 'message'; id: string; data: string; binary: boolean; sequence?: number; final?: boolean }
  | { type: 'close'; id: string; code?: number }
  | { type: 'error'; id: string; code: string }
export function remotePath(path: unknown, socket = false): path is string {
  if (typeof path !== 'string' || path.length > 8192 || /[\r\n\\#]/.test(path) || /%(?:00|0d|0a)/i.test(path) || /%(?:2f|5c)/i.test(path.split('?')[0])) return false
  const url = new URL(path, 'https://mew.invalid')
  if (url.origin !== 'https://mew.invalid' || !path.startsWith('/api/') || url.pathname !== path.split('?')[0]) return false
  if (socket) return ['/api/tmux/ws', '/api/agent/ws', '/api/presence', '/api/collab', '/api/db/ws', '/api/browser-dom/ws', '/api/remote-desktop/ws'].includes(url.pathname)
  return (!url.pathname.startsWith('/api/remote-access') || url.pathname === '/api/remote-access/members' || url.pathname === '/api/remote-access') && (!url.pathname.startsWith('/api/auth/') || url.pathname === '/api/auth/me' || url.pathname === '/api/auth/profile')
}
export function parseRemoteFrame(raw: string): RemoteFrame {
  if (new TextEncoder().encode(raw).byteLength > REMOTE_LIMITS.frame) throw new Error('frame-limit')
  const value = JSON.parse(raw) as RemoteFrame
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) throw new Error('invalid-frame')
  if (!['request', 'response', 'chunk', 'end', 'cancel', 'credit', 'socket', 'open', 'message', 'close', 'error'].includes(value.type)) throw new Error('invalid-frame')
  if (value.type === 'request' && (!remotePath(value.path) || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value.method) || !value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers) || Object.values(value.headers).some(v => typeof v !== 'string' || v.length > 8192 || /[\r\n]/.test(v)) || (value.body !== undefined && typeof value.body !== 'string'))) throw new Error('invalid-request')
  if (value.type === 'socket' && !remotePath(value.path, true)) throw new Error('invalid-socket')
  if ((value.type === 'chunk' || value.type === 'message') && (typeof value.data !== 'string' || value.data.length > Math.ceil(REMOTE_LIMITS.chunk / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data))) throw new Error('invalid-chunk')
  if (value.type === 'message' && (typeof value.binary !== 'boolean' || (value.sequence !== undefined && (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.sequence > 4096 || typeof value.final !== 'boolean')))) throw new Error('invalid-message')
  return value
}
export function sdpFingerprint(sdp: string): string {
  const values = [...sdp.matchAll(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)\r?$/gm)].map(value => value[1].toUpperCase())
  if (!values.length || values.some(value => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value) || value !== values[0])) throw new Error('invalid-fingerprint')
  return values[0]
}
