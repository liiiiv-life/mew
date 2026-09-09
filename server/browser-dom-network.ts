import http from 'node:http'
import net from 'node:net'

/** Chromium's own TLS/HTTP stack talks through this tunnel. Unlike page routing,
 * CONNECT authorization also applies after redirects and to new browser targets. */
export async function createDomNetworkGate(allowed: (url: string) => boolean): Promise<{ server: string; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>()
  const track = (socket: net.Socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    socket.setTimeout(90_000, () => socket.destroy())
    return socket
  }
  const server = http.createServer((req, res) => {
    let url: URL
    try { url = new URL(req.url ?? '') } catch { res.writeHead(400).end(); return }
    if (url.protocol !== 'http:' || !allowed(url.href)) { res.writeHead(403).end(); return }
    const headers: http.IncomingHttpHeaders = { ...req.headers, host: url.host }
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    const upstream = http.request(url, { method: req.method, headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    })
    upstream.on('socket', track)
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.once('aborted', () => upstream.destroy())
    res.once('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  server.on('connection', track)
  server.on('clientError', (_error, socket) => socket.destroy())
  server.on('upgrade', (_req, socket) => socket.destroy())
  server.on('connect', (req, client, head) => {
    let url: URL
    try { url = new URL(`https://${req.url}`) } catch { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return }
    if (!allowed(url.href)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    const upstream = track(net.connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 443) }))
    upstream.once('connect', () => {
      if (client.destroyed) { upstream.destroy(); return }
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    upstream.once('error', () => client.destroy())
    client.once('close', () => upstream.destroy())
    upstream.once('close', () => client.destroy())
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('브라우저 네트워크를 준비하지 못했습니다')
  return {
    server: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
