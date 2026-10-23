import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { createHash } from 'node:crypto'
import express from 'express'
import { remoteTransport } from './remote-access-context.ts'

/** A verified peer can read the installed login/app bundle, never workspace files. */
export function createRemoteUiRouter(dist = path.resolve(import.meta.dirname, '../dist')) {
  const router = express.Router()
  const revisions = new Map<string, { version: string; etag: Promise<string> }>()
  const revision = (file: string, stat: Awaited<ReturnType<typeof fs.stat>>) => {
    const version = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
    const previous = revisions.get(file)
    if (previous?.version === version) return previous.etag
    const etag = (async () => {
      const hash = createHash('sha256')
      for await (const bytes of createReadStream(file)) hash.update(bytes)
      return `"sha256-${hash.digest('base64url')}"`
    })()
    if (revisions.size >= 256) revisions.delete(revisions.keys().next().value!)
    revisions.set(file, { version, etag })
    void etag.catch(() => { if (revisions.get(file)?.etag === etag) revisions.delete(file) })
    return etag
  }
  const index = async () => {
    const root = await fs.realpath(dist), file = await fs.realpath(path.join(root, 'index.html'))
    if (!file.startsWith(root + path.sep)) throw new Error('invalid-index')
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('invalid-index')
    const html = await fs.readFile(file, 'utf8')
    if (!/<head(?:\s[^>]*)?>/i.test(html) || !/name=["']mew-p2p-bootstrap["']\s+content=["']1["']/i.test(html)) throw new Error('outdated-ui')
    return html
  }
  router.use((req, res, next) => {
    if (!remoteTransport(req) || !['GET', 'HEAD'].includes(req.method)) { res.status(403).end(); return }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  })
  router.get('/', async (_req, res) => {
    try { await index(); res.json({ protocol: 1, index: '/index.html' }) }
    catch { res.status(409).json({ error: '로컬 mew를 업데이트하고 빌드한 뒤 다시 연결해 주세요.' }) }
  })
  router.get('/file', async (req, res) => {
    const requested = req.query.path
    if (typeof requested !== 'string' || requested.length > 1024 || !requested.startsWith('/') || /[\\?#%]/.test(requested) || [...requested].some(char => char.charCodeAt(0) < 32) || requested.split('/').some(part => part.startsWith('.')) || !/\.(?:html|js|mjs|css|json|svg|png|ico|jpe?g|webp|avif|gif|woff2?|ttf|otf|wasm|txt|bcmap|pfb|icc|bin)$/i.test(requested)) { res.status(400).end(); return }
    try {
      const root = await fs.realpath(dist), file = await fs.realpath(path.join(root, requested))
      if (!file.startsWith(root + path.sep)) { res.status(403).end(); return }
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) { res.status(413).end(); return }
      // Only a resource worker that can decode gzip opts in; old peers keep raw bytes.
      const compressed = req.method === 'GET' && req.query.encoding === 'gzip' && !req.headers.range && /\.(?:html|js|mjs|css|json|svg|txt)$/i.test(requested)
      if (requested.startsWith('/assets/') && /\.(?:js|mjs|css|woff2?|ttf|otf|wasm)$/i.test(requested) && !req.headers.range) {
        const raw = await revision(file, stat)
        const etag = compressed ? raw.replace(/"$/, '-gzip"') : raw
        res.setHeader('ETag', etag)
        if (req.headers['if-none-match'] === etag) { res.status(304).end(); return }
      }
      if (requested === '/index.html') {
        if (stat.size > 512 * 1024) { res.status(413).end(); return }
        let html: string
        try { html = await index() } catch { res.status(409).end(); return }
        const body = html.replace(/<head(?:\s[^>]*)?>/i, '$&<meta name="mew-p2p-app" content="1">')
        res.type('html')
        if (compressed) {
          res.setHeader('Content-Encoding', 'gzip')
          await pipeline(Readable.from([body]), createGzip(), res)
        } else res.send(body)
      } else if (compressed) {
        res.type(path.extname(file)).setHeader('Content-Encoding', 'gzip')
        await pipeline(createReadStream(file), createGzip(), res)
      } else res.sendFile(file, { dotfiles: 'deny', lastModified: false, cacheControl: false })
    } catch { if (!res.headersSent) { res.removeHeader('Content-Encoding'); res.status(404).end() } }
  })
  return router
}
