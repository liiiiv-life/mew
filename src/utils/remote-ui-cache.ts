import type { AppTransport } from './remote-transport.ts'

const CACHE = 'mew-remote-ui-v1'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const MAX_BYTES = 32 * 1024 * 1024
const MAX_ASSET = 8 * 1024 * 1024
const MAX_ENTRIES = 64
const STORED_AT = 'x-mew-ui-cache-time'
const STORED_BYTES = 'x-mew-ui-cache-bytes'
let writes = Promise.resolve()
const contentDigest = (etag: string) => /^"sha256-[A-Za-z0-9_-]{43}(?:-gzip)?"$/.test(etag) ? etag.replace(/-gzip"$/, '"') : null

async function digest(bytes: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
  return `"sha256-${btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}"`
}

async function readAsset(response: Response) {
  let body = response.body
  if (response.headers.get('content-encoding') === 'gzip') {
    if (typeof DecompressionStream !== 'function') return null
    body = body?.pipeThrough(new DecompressionStream('gzip')) ?? null
  } else if (response.headers.has('content-encoding')) return null
  const reader = body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > MAX_ASSET) { void reader.cancel().catch(() => {}); return null }
      chunks.push(result.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

async function store(cache: Cache, key: string, response: Response, bytes: Uint8Array) {
  const headers = new Headers(response.headers)
  headers.delete('content-encoding'); headers.delete('content-length')
  headers.set(STORED_AT, String(Date.now())); headers.set(STORED_BYTES, String(bytes.byteLength))
  await cache.put(key, new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers }))
  const keys = await cache.keys()
  const entries = await Promise.all(keys.map(async request => {
    const value = await cache.match(request)
    return { request, time: Number(value?.headers.get(STORED_AT)), size: Number(value?.headers.get(STORED_BYTES)) }
  }))
  entries.sort((a, b) => b.time - a.time)
  let total = 0, count = 0
  for (const entry of entries) {
    if (entry.time > Date.now() - MAX_AGE && entry.time <= Date.now() && Number.isFinite(entry.size) && entry.size >= 0 && ++count <= MAX_ENTRIES && (total += entry.size) <= MAX_BYTES) continue
    await cache.delete(entry.request)
  }
}

/** Cached code is usable only after this host confirms its digest over the live P2P link. */
export async function fetchRemoteUiResource(transport: AppTransport, path: string, init: RequestInit, instance?: string): Promise<Response> {
  const url = new URL(path, location.origin), asset = url.searchParams.get('path') ?? ''
  if (!instance || init.method !== 'GET' || url.pathname !== '/api/remote-ui/file' || !/^\/assets\/[A-Za-z0-9_./-]+\.(?:js|mjs|css|woff2?|ttf|otf|wasm)$/i.test(asset) || asset.split('/').some(part => part.startsWith('.')) || new Headers(init.headers).has('range') || !globalThis.caches || !crypto.subtle) return transport.fetch(path, init)
  const key = `${location.origin}/__mew_ui_cache/${encodeURIComponent(instance)}/${encodeURIComponent(asset)}`
  let cache: Cache, cached: Response | undefined, bytes: Uint8Array | null = null
  try {
    cache = await caches.open(CACHE)
    cached = await cache.match(key)
    const stored = Number(cached?.headers.get(STORED_AT)), etag = cached?.headers.get('etag')
    if (cached && stored > Date.now() - MAX_AGE && stored <= Date.now() && etag && contentDigest(etag)) {
      bytes = await readAsset(cached.clone())
      if (!bytes || await digest(bytes) !== contentDigest(etag)) bytes = null
    }
  } catch { return transport.fetch(path, init) }
  const headers = new Headers(init.headers)
  if (bytes && cached) headers.set('if-none-match', cached.headers.get('etag')!)
  let response = await transport.fetch(path, { ...init, headers })
  if (response.status === 304) {
    if (bytes && cached && response.headers.get('etag') === cached.headers.get('etag')) {
      const clean = new Headers(cached.headers)
      clean.delete(STORED_AT); clean.delete(STORED_BYTES)
      clean.delete('content-encoding'); clean.delete('content-length')
      const result = new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: clean })
      writes = writes.then(() => store(cache, key, result, bytes!)).catch(() => {})
      return result
    }
    headers.delete('if-none-match')
    response = await transport.fetch(path, { ...init, headers })
  }
  const etag = response.headers.get('etag')
  if (response.status === 200 && etag && contentDigest(etag)) {
    const snapshot = response.clone()
    // Read alongside the consumer; cache writes never hold up the first streamed response.
    void (async () => {
      const fresh = await readAsset(snapshot)
      if (!fresh || await digest(fresh) !== contentDigest(etag)) return
      writes = writes.then(() => store(cache, key, snapshot, fresh)).catch(() => {})
    })().catch(() => {})
  }
  return response
}
