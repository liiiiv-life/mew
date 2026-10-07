import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { remoteSession } from './remote-access-context.ts'

/** Only the authenticated peer can read the installed app bundle, never workspace files. */
export function createRemoteUiRouter(dist = path.resolve(import.meta.dirname, '../dist')) {
  const router = express.Router()
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
    if (!remoteSession(req) || !['GET', 'HEAD'].includes(req.method)) { res.status(403).end(); return }
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
      if (requested === '/index.html') {
        if (stat.size > 512 * 1024) { res.status(413).end(); return }
        let html: string
        try { html = await index() } catch { res.status(409).end(); return }
        res.type('html').send(html.replace(/<head(?:\s[^>]*)?>/i, '$&<meta name="mew-p2p-app" content="1">'))
      } else res.sendFile(file, { dotfiles: 'deny', lastModified: false, cacheControl: false })
    } catch { if (!res.headersSent) res.status(404).end() }
  })
  return router
}
