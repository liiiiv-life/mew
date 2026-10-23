import type { IncomingMessage } from 'node:http'

/** Browsers send Origin for WS; keep Origin-less native clients compatible. */
export function sameWebSocketOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const source = new URL(origin)
    const host = req.headers.host
    if (!host || !['http:', 'https:'].includes(source.protocol) || source.origin !== origin) return false
    const secure = (req.socket as { encrypted?: boolean }).encrypted === true || req.headers['x-forwarded-proto'] === 'https'
    const target = new URL(`${secure ? 'https' : 'http'}://${host}`)
    if (target.username || target.password || target.pathname !== '/' || target.search || target.hash) return false
    return source.origin === target.origin
  } catch { return false }
}
