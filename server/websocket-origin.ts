import type { IncomingMessage } from 'node:http'
import { sameWebSocketOrigin } from '../packages/tmux-term/src/server/websocket-origin.ts'
import { remoteContext } from './remote-access-context.ts'

/** Only the in-process verified transport may use its central browser origin. */
export function webSocketOriginAllowed(req: IncomingMessage): boolean {
  const context = remoteContext(req)
  if (context) return context.alive?.() ?? !!context.current()
  return sameWebSocketOrigin(req)
}
