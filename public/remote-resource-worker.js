/* Work and installed UI resources stay on the exact tab's authenticated P2P link. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__mew_ui/') && !event.clientId)) return
  if (['/launcher.js', '/launcher.css', '/remote-resource-worker.js', '/central/key', '/central/signal'].includes(url.pathname) || url.pathname.startsWith('/launch/')) return
  event.respondWith((async () => {
    const clientId = event.clientId || event.replacesClientId
    let client = clientId ? await self.clients.get(clientId) : null
    const appMatch = /^\/__mew_ui\/([A-Za-z0-9_-]{20,64})\/(.*)$/.exec(url.pathname)
    const sourceMatch = client ? /^\/__mew_ui\/([A-Za-z0-9_-]{20,64})\//.exec(new URL(client.url).pathname) : null
    const token = appMatch?.[1] || sourceMatch?.[1]
    if (token) {
      // Exact launch token matching survives worker eviction; never choose an arbitrary connected tab.
      const windows = await self.clients.matchAll({ type: 'window' })
      const matches = windows.filter(value => new URL(value.url).pathname === '/launch/' + token)
      if (matches.length !== 1) return new Response('Direct connection required', { status: 503 })
      if (appMatch && !sourceMatch && client && client.id !== matches[0].id) return new Response('Wrong connection', { status: 403 })
      client = matches[0]
    }
    if (!client) return new Response('Direct connection required', { status: 503 })
    let path = url.pathname + url.search
    const ui = !!token && !url.pathname.startsWith('/api/')
    if (ui && !appMatch) return Response.redirect(url.origin + '/__mew_ui/' + token + url.pathname + url.search, 307)
    if (ui) path = '/api/remote-ui/file?path=' + encodeURIComponent(appMatch ? '/' + appMatch[2] : url.pathname)
    else if (!url.pathname.startsWith('/api/')) return fetch(event.request)
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
          if (ui) {
            const central = typeof data.centralOrigin === 'string' ? data.centralOrigin : ''
            if (!/^https?:\/\//.test(central) || new URL(central).origin !== central) { done(); resolve(new Response('Invalid app origin', { status: 503 })); return }
            headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' blob: data: https:; media-src 'self' blob: data: https:; worker-src 'self' blob:; frame-src 'self' blob:; frame-ancestors 'self' ${central}; object-src 'none'; base-uri 'self'; form-action 'self'`)
          } else if (/text\/html|image\/svg\+xml/.test(headers.get('content-type') ?? '')) headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'")
          headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Cache-Control', 'no-store')
          const stream = new ReadableStream({ start(value) { controller = value }, pull() { channel.port1.postMessage({ type: 'pull' }) }, cancel() { channel.port1.postMessage({ type: 'cancel' }); done() } })
          resolve(new Response(event.request.method === 'HEAD' || [204,205,304].includes(data.status) ? null : stream, { status: data.status, headers }))
          if (event.request.method === 'HEAD' || [204,205,304].includes(data.status)) { channel.port1.postMessage({ type: 'cancel' }); done() }
        } else if (data.type === 'chunk') controller?.enqueue(new Uint8Array(data.bytes))
        else if (data.type === 'end') { controller?.close(); done() }
        else if (data.type === 'error') { if (!resolved) { resolved = true; resolve(new Response('Direct connection unavailable', { status: 503 })) } else controller?.error(new Error('Direct connection interrupted')); done() }
      }
      if (!['GET','HEAD'].includes(event.request.method)) { resolved = true; done(); resolve(new Response('Unsupported resource request', { status: 405 })); return }
      client.postMessage({ type: 'mew-resource', path, method: event.request.method, headers: [...event.request.headers] }, [channel.port2])
    })
  })())
})
