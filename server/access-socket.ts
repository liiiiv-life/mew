import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import { accessChanges } from './access-policy.ts'

/** Drop old authority immediately on policy changes, and revalidate cookies while idle. */
export function watchSocketAccess(ws: WebSocket, req: IncomingMessage, authorize?: (req: IncomingMessage) => boolean) {
  if (!authorize) return
  const check = () => { if (!authorize(req)) ws.terminate() }
  accessChanges.on('change', check)
  const timer = setInterval(check, 5000)
  timer.unref()
  ws.once('close', () => { clearInterval(timer); accessChanges.off('change', check) })
  check()
}
