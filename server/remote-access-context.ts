import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AuthenticatedSession } from './auth.ts'
import type { MewlinkIdentity } from '../shared/mewlink-identity.ts'
export interface RemoteContext {
  /** Set by the verified dispatcher for the isolated preview bridge, never from HTTP headers. */
  capability?: 'port-preview'
  current(): AuthenticatedSession | null
  alive?(): boolean
  sessionToken?(): string | null
  setSessionToken?(token: string | null): void
  identity?(): MewlinkIdentity | null
  activateMewlink?(): void
  /** Preserve only the initiating request across its synchronous account access update. */
  updateAccountAccess?<T>(action: () => T): T
  /** Changes connection authority synchronously before returning its resolved token. */
  trustDevice?(label: string): Promise<string>
  clientIp?: string
}
const remoteSockets = new WeakMap<Duplex, RemoteContext>()
/** Only the verified P2P dispatcher can attach authority to an in-process socket. */
export function bindRemoteSocket(socket: Duplex, context: RemoteContext | (() => AuthenticatedSession | null)) { remoteSockets.set(socket, typeof context === 'function' ? { current: context } : context) }
export function remoteContext(req: IncomingMessage): RemoteContext | undefined { return remoteSockets.get(req.socket) }
export function remoteSession(req: IncomingMessage): AuthenticatedSession | null | undefined { return remoteContext(req)?.current() }
export function remoteTransport(req: IncomingMessage): boolean { const context = remoteContext(req); return !!context && (context.alive?.() ?? !!context.current()) }
export function remoteUiRequest(method: string, path: string): boolean { return ['GET', 'HEAD'].includes(method) && ['/api/remote-ui', '/api/remote-ui/file'].includes(path.split('?')[0]) }
