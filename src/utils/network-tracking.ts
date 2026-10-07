import { networkUsage, type NetworkCategory } from './network-usage.ts'

const encoder = new TextEncoder()
const byteLength = (value: string | Blob | ArrayBufferLike | ArrayBufferView) => typeof value === 'string' ? encoder.encode(value).byteLength : value instanceof Blob ? value.size : value.byteLength

export function requestBodyBytes(body: BodyInit | null | undefined): number {
  if (!body || body instanceof ReadableStream) return 0
  if (body instanceof URLSearchParams) return byteLength(body.toString())
  if (body instanceof FormData) {
    let bytes = 0
    body.forEach((value, name) => { bytes += byteLength(name) + byteLength(value) })
    return bytes
  }
  return byteLength(body)
}

export function networkCategory(url: URL): NetworkCategory {
  return url.pathname.startsWith('/api/remote-desktop/') ? 'desktop' : 'other'
}

/** Count streaming SSE in place, preserving backpressure, aborts and Response metadata. */
function trackStream(response: Response, category: NetworkCategory, enabled: () => boolean): Response {
  if (!response.body) return response
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { if (enabled()) networkUsage.add(category, 'received', chunk.byteLength); controller.enqueue(chunk) },
  }))
  const tracked = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  const metadata = (value: Response): Response => {
    for (const key of ['url', 'type', 'redirected'] as const) Object.defineProperty(value, key, { value: response[key] })
    const clone = value.clone.bind(value)
    value.clone = () => metadata(clone())
    return value
  }
  return metadata(tracked)
}

export function startNetworkTracking() {
  const nativeFetch = window.fetch, NativeSocket = window.WebSocket
  let active = true
  const streams: { url: string; from: number; to: number }[] = []
  const local = (url: URL) => url.host === location.host && ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
  const observer = new PerformanceObserver(list => {
    if (!active) return
    for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
      const url = new URL(entry.name, location.href)
      if (!local(url)) continue
      const index = streams.findIndex(stream => stream.url === entry.name && entry.startTime >= stream.from - 1 && entry.startTime <= stream.to)
      if (index >= 0) { streams.splice(index, 1); continue }
      // Cached resources have no network body transfer. ResourceTiming honors compression.
      if (entry.transferSize > 0) networkUsage.add(networkCategory(url), 'received', entry.encodedBodySize)
    }
  })
  observer.observe({ type: 'resource', buffered: true })
  if (PerformanceObserver.supportedEntryTypes.includes('navigation')) observer.observe({ type: 'navigation', buffered: true })
  const trackedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    const from = performance.now(), response = await nativeFetch.call(window, input, init)
    if (!active || !local(url)) return response
    const category = networkCategory(url)
    networkUsage.add(category, 'sent', requestBodyBytes(init?.body))
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      streams.push({ url: url.href, from, to: performance.now() })
      return trackStream(response, category, () => active)
    }
    return response
  }
  class TrackedSocket extends NativeSocket {
    private readonly tracked: boolean
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      const address = new URL(String(url), location.href)
      // connectDesktop reports its authenticated socket with the media session.
      this.tracked = local(address) && address.pathname !== '/api/remote-desktop/ws'
      if (this.tracked) this.addEventListener('message', event => {
        if (active) networkUsage.add('other', 'received', byteLength(event.data))
      })
    }
    override send(data: Parameters<WebSocket['send']>[0]) {
      const open = this.readyState === NativeSocket.OPEN
      super.send(data)
      if (active && this.tracked && open) networkUsage.add('other', 'sent', byteLength(data))
    }
  }
  window.fetch = trackedFetch; window.WebSocket = TrackedSocket
  return () => {
    active = false; observer.disconnect()
    if (window.fetch === trackedFetch) window.fetch = nativeFetch
    if (window.WebSocket === TrackedSocket) window.WebSocket = NativeSocket
  }
}
