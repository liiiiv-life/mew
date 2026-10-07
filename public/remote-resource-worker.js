/* Only native resource requests are bridged; account and signal requests stay on HTTPS. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) return
  event.respondWith((async () => {
    const clientId = event.clientId || event.replacesClientId
    const client = clientId ? await self.clients.get(clientId) : null
    if (!client) return new Response('Direct connection required', { status: 503 })
    const channel = new MessageChannel()
    return new Promise(resolve => {
      let controller, resolved = false
      const timer = setTimeout(() => { channel.port1.postMessage({ type: 'cancel' }); channel.port1.close(); if (!resolved) resolve(new Response('Direct connection unavailable', { status: 503 })); else controller?.error(new Error('Direct connection interrupted')) }, 30_000)
      const done = () => { clearTimeout(timer); channel.port1.close() }
      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'response' && !resolved) {
          resolved = true
          clearTimeout(timer)
          const headers = new Headers(data.headers)
          if (/text\/html|image\/svg\+xml/.test(headers.get('content-type') ?? '')) headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'")
          headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Cache-Control', 'no-store')
          const stream = new ReadableStream({ start(value) { controller = value }, pull() { channel.port1.postMessage({ type: 'pull' }) }, cancel() { channel.port1.postMessage({ type: 'cancel' }); done() } })
          resolve(new Response(event.request.method === 'HEAD' || [204,205,304].includes(data.status) ? null : stream, { status: data.status, headers }))
          if (event.request.method === 'HEAD' || [204,205,304].includes(data.status)) { channel.port1.postMessage({ type: 'cancel' }); done() }
        } else if (data.type === 'chunk') controller?.enqueue(new Uint8Array(data.bytes))
        else if (data.type === 'end') { controller?.close(); done() }
        else if (data.type === 'error') { if (!resolved) { resolved = true; resolve(new Response('Direct connection unavailable', { status: 503 })) } else controller?.error(new Error('Direct connection interrupted')); done() }
      }
      if (!['GET','HEAD'].includes(event.request.method)) { resolved = true; done(); resolve(new Response('Unsupported resource request', { status: 405 })); return }
      client.postMessage({ type: 'mew-resource', path: url.pathname + url.search, method: event.request.method, headers: [...event.request.headers] }, [channel.port2])
    })
  })())
})
