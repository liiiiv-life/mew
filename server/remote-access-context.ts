import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AuthenticatedSession } from './auth.ts'
const remoteSockets = new WeakMap<Duplex, () => AuthenticatedSession | null>()
/** Only the verified P2P dispatcher can attach authority to an in-process socket. */
export function bindRemoteSocket(socket: Duplex, current: () => AuthenticatedSession | null) { remoteSockets.set(socket, current) }
export function remoteSession(req: IncomingMessage): AuthenticatedSession | null | undefined { return remoteSockets.get(req.socket)?.() }
