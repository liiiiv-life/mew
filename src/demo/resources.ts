import type { DemoWorkspaceStore } from './workspace-store.ts'
import { DemoError } from './workspace-store.ts'
import { demoMewpetAsset } from './http-mewpet.ts'
import { DEMO_ANDROID_HTML } from './host-fixtures.ts'

const mimeTypes: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', ts: 'text/plain', tsx: 'text/plain', js: 'text/javascript', jsx: 'text/plain', json: 'application/json', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', csv: 'text/csv', yaml: 'text/yaml', yml: 'text/yaml' }
const textEncoder = new TextEncoder()
const supported = new Set(['/api/raw', '/api/download', '/api/fs/raw', '/api/fs/download', '/api/asset'])

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** A small ZIP store writer keeps folder downloads local without a server or compressor. */
function zip(files: { path: string; bytes: Uint8Array<ArrayBuffer> }[]): Blob {
  const chunks: Uint8Array<ArrayBuffer>[] = [], central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const file of files) {
    const name = textEncoder.encode(file.path), bytes = file.bytes, checksum = crc32(bytes)
    const local = new Uint8Array(30 + name.length), header = new DataView(local.buffer)
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x800, true)
    header.setUint16(12, 33, true); header.setUint32(14, checksum, true); header.setUint32(18, bytes.length, true); header.setUint32(22, bytes.length, true); header.setUint16(26, name.length, true)
    local.set(name, 30); chunks.push(local, bytes)
    const directory = new Uint8Array(46 + name.length), entry = new DataView(directory.buffer)
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x800, true)
    entry.setUint16(14, 33, true); entry.setUint32(16, checksum, true); entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true); entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true)
    directory.set(name, 46); central.push(directory); offset += local.length + bytes.length
  }
  const centralSize = central.reduce((size, bytes) => size + bytes.length, 0), footer = new Uint8Array(22), end = new DataView(footer.buffer)
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, footer], { type: 'application/zip' })
}

/** Materialize file URLs as visitor-owned blobs, so native links cannot reach a host API. */
export function createDemoResources(store: DemoWorkspaceStore, base = '/demo') {
  const cache = new Map<string, { revision: string; url: string }>()
  let closed = false
  let controller = new AbortController()
  const downloads = new Map<string, ReturnType<typeof setTimeout>>()
  const release = (url: string) => { const timer = downloads.get(url); if (timer) clearTimeout(timer); if (downloads.delete(url)) URL.revokeObjectURL(url) }
  const clear = () => { for (const entry of cache.values()) URL.revokeObjectURL(entry.url); cache.clear(); for (const url of downloads.keys()) release(url) }
  const unsubscribe = store.subscribe(event => { if (event.type === 'close') close(); else if (event.type === 'reset' || event.type === 'files') { if (event.type === 'reset') { controller.abort(); controller = new AbortController() }; clear() } })
  const close = () => { if (closed) return; closed = true; controller.abort(); unsubscribe(); clear() }
  const url = (input: string): string => {
    if (closed) return `data:text/plain;charset=utf-8,${encodeURIComponent('데모 세션이 종료됐습니다.')}`
    const origin = globalThis.location?.origin ?? 'https://demo.mew.test'
    let parsed: URL
    try { parsed = new URL(input, origin) } catch { return 'data:text/plain,Invalid%20demo%20resource' }
    if (!parsed.pathname.startsWith('/api/')) return input
    const publicAsset = parsed.origin === origin ? demoMewpetAsset(parsed.pathname) : null
    if (publicAsset) return publicAsset
    const key = parsed.pathname + parsed.search
    if (parsed.origin === origin && parsed.pathname === '/api/demo/android') {
      const cached = cache.get(key)
      if (cached) return cached.url
      const next = URL.createObjectURL(new Blob([DEMO_ANDROID_HTML], { type: 'text/html;charset=utf-8' }))
      cache.set(key, { revision: 'android', url: next }); return next
    }
    let blob: Blob, revision: string
    try {
      if (parsed.origin !== origin || !supported.has(parsed.pathname)) throw new DemoError('이 파일은 데모에서 제공하지 않습니다.')
      const path = parsed.searchParams.get('path') ?? '', project = parsed.pathname.startsWith('/api/fs/') ? '.workspace' : parsed.searchParams.get('project') ?? '.workspace'
      if (store.hasRepository && parsed.pathname.endsWith('download')) return input
      const source = store.sourceAssetPath(path, project)
      if (source) return `${base.replace(/\/$/, '')}/${source}`
      try {
        const file = store.readFile(path, project)
        revision = `${store.canonicalFilePath(path, project)}:${file.version.tag ?? file.version.mtimeMs}`
        const cached = cache.get(key); if (cached?.revision === revision) return cached.url
        const extension = file.path.split('.').at(-1)?.toLowerCase() ?? ''
        blob = new Blob([file.content], { type: `${mimeTypes[extension] ?? 'text/plain'};charset=utf-8` })
      } catch (error) {
        if (!(error instanceof DemoError) || error.status !== 404 || !parsed.pathname.endsWith('download')) throw error
        const directory = store.canonicalFilePath(path, project)
        store.tree(project, path)
        const base = directory.split('/').at(-1) || store.workspacePath.split('/').at(-1) || 'workspace', prefix = directory ? `${directory}/` : ''
        const files = store.repositoryEntries().filter(file => !directory || file.path.startsWith(prefix)).map(file => ({ path: `${base}/${file.path.slice(prefix.length)}`, bytes: textEncoder.encode(file.content) }))
        revision = `directory-${store.revision}`
        const cached = cache.get(key); if (cached?.revision === revision) return cached.url
        blob = zip(files)
      }
    } catch (error) {
      const message = error instanceof DemoError ? error.message : '데모 파일을 열 수 없습니다.'
      revision = `error:${message}`
      const cached = cache.get(key); if (cached?.revision === revision) return cached.url
      blob = new Blob([message], { type: 'text/plain;charset=utf-8' })
    }
    const previous = cache.get(key)
    if (previous) URL.revokeObjectURL(previous.url)
    const next = URL.createObjectURL(blob); cache.set(key, { revision, url: next }); return next
  }
  const prepare = async (input: string, signal?: AbortSignal): Promise<string> => {
    if (closed) throw new DemoError('데모 세션이 종료됐습니다.')
    const origin = globalThis.location?.origin ?? 'https://demo.mew.test'
    const parsed = new URL(input, origin)
    if (parsed.origin !== origin || !['/api/download', '/api/fs/download'].includes(parsed.pathname)) return input
    const path = parsed.searchParams.get('path') ?? '', project = parsed.pathname.startsWith('/api/fs/') ? '.workspace' : parsed.searchParams.get('project') ?? '.workspace'
    const operationSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    operationSignal.throwIfAborted()
    let blob: Blob
    if (store.hasFile(path, project)) {
      const source = store.sourceEntry(path, project)
      if (source) return `${base.replace(/\/$/, '')}/repository/${source.oid}.bin`
      const bytes = await store.fileBytes(path, project, operationSignal)
      blob = new Blob([bytes], { type: 'application/octet-stream' })
    } else {
      store.tree(project, path)
      const canonical = store.canonicalFilePath(path, project), absolute = `${store.workspacePath}/${canonical}`.replace(/\/$/, '')
      const prefix = canonical ? `${canonical}/` : '', name = canonical.split('/').at(-1) || 'mew-playground'
      // Metadata is root-relative even while another project is active.
      const entries = store.repositoryMetadata().filter(file => !canonical || file.path.startsWith(prefix))
      if (entries.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) throw new DemoError('데모 폴더 다운로드는 64MiB 이하여야 합니다.', 413)
      const files: { path: string; bytes: Uint8Array<ArrayBuffer> }[] = []
      let next = 0
      await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
        while (next < entries.length) {
          operationSignal.throwIfAborted()
          const file = entries[next++], target = `${store.workspacePath}/${file.path}`
          const bytes = await store.fileBytes(target, '.workspace', operationSignal)
          files.push({ path: `${name}/${target.slice(absolute.length + 1)}`, bytes })
        }
      }))
      blob = zip(files.sort((left, right) => left.path.localeCompare(right.path)))
    }
    operationSignal.throwIfAborted()
    const result = URL.createObjectURL(blob)
    downloads.set(result, setTimeout(() => release(result), 60_000))
    return result
  }
  return { url, prepare, release, close }
}
