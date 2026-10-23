self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/__mew_preview_') && url.pathname !== '/__mew_preview_cookies') return
  event.respondWith((async () => {
    const clients = await self.clients.matchAll({ type: 'window' })
    const launchers = clients.filter(client => new URL(client.url).pathname === '/__mew_preview_launch')
    if (launchers.length !== 1) return new Response('Preview connection required', { status: 503 })
    const request = event.request, channel = new MessageChannel()
    let body
    if (!['GET', 'HEAD'].includes(request.method)) {
      const reader = request.body?.getReader(), chunks = []; let length = 0
      while (reader) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 25 * 1024 * 1024) { await reader.cancel(); return new Response('Request too large', { status: 413 }) }; chunks.push(chunk.value) }
      const bytes = new Uint8Array(length); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      body = bytes.buffer
    }
    return new Promise(resolve => {
      let controller, resolved = false
      const done = () => { clearTimeout(timer); channel.port1.close() }
      const timer = setTimeout(() => { channel.port1.postMessage({ type: 'cancel' }); if (!resolved) resolve(new Response('Preview connection unavailable', { status: 503 })); else controller?.error(new Error('Preview connection unavailable')); done() }, 30000)
      channel.port1.onmessage = ({ data }) => {
        if (data?.type === 'response' && !resolved) {
          resolved = true; clearTimeout(timer)
          const headers = new Headers(data.headers)
          for (const name of ['set-cookie', 'content-length', 'content-security-policy', 'clear-site-data', 'service-worker-allowed']) headers.delete(name)
          headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff')
          if (data.status >= 300 && data.status < 400 && headers.has('location')) {
            const destination = new URL(headers.get('location'), url)
            if (destination.origin !== url.origin) { done(); resolve(new Response('Cross-origin redirect denied', { status: 403 })); return }
            headers.set('Location', destination.href)
          }
          const empty = request.method === 'HEAD' || [204, 205, 304].includes(data.status)
          const stream = empty ? null : new ReadableStream({ start(value) { controller = value }, pull() { channel.port1.postMessage({ type: 'pull' }) }, cancel() { channel.port1.postMessage({ type: 'cancel' }); done() } })
          resolve(new Response(stream, { status: data.status, headers }))
          if (empty) { channel.port1.postMessage({ type: 'cancel' }); done() }
        } else if (data?.type === 'chunk') controller?.enqueue(new Uint8Array(data.bytes))
        else if (data?.type === 'end') { controller?.close(); done() }
        else if (data?.type === 'error') { if (!resolved) resolve(new Response('Preview request failed', { status: 502 })); else controller?.error(new Error('Preview request failed')); done() }
      }
      launchers[0].postMessage({ type: 'mew-preview-network', request: { type: 'fetch', path: url.pathname + url.search, method: request.method, headers: [...request.headers], ...(body ? { body } : {}) } }, [channel.port2, ...(body ? [body] : [])])
    })
  })())
})
