import fs from 'node:fs'
import path from 'node:path'
import { createDemoRepositorySource, DEMO_RAW_RESOURCE_EXTENSIONS, demoRepositoryContentType } from './demo-snapshot.mjs'

/** Deliver committed files independently so browsing the tree never downloads their contents. */
export function demoRepositoryPlugin({ root = path.resolve(import.meta.dirname, '..') } = {}) {
  let cachedJson, cachedSource
  function source() {
    const json = fs.readFileSync(path.join(root, 'src/demo/repository-index.json'), 'utf8')
    if (json !== cachedJson) {
      const index = JSON.parse(json)
      cachedSource = createDemoRepositorySource(index, root)
      cachedJson = json
    }
    return cachedSource
  }
  return {
    name: 'mew-demo-repository',
    configResolved(config) { root = config.root },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!/^\/(?:demo\/)?repository\//.test(pathname)) return next()
        const match = /^\/(?:demo\/)?repository\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(pathname)
        if (!match) { res.statusCode = 404; res.end(); return }
        try {
          const repository = source()
          const extension = match[2]
          if (!repository.has(match[1]) || !['json', 'bin'].includes(extension) && (!DEMO_RAW_RESOURCE_EXTENSIONS.includes(extension) || !repository.rawExtensions(match[1]).includes(extension))) { res.statusCode = 404; res.end(); return }
          let body, contentType
          if (extension === 'json') { body = repository.load(match[1]); contentType = 'application/json; charset=utf-8' }
          else {
            body = repository.loadRaw(match[1]).bytes
            contentType = demoRepositoryContentType(extension)
            if (extension === 'bin') res.setHeader('Content-Disposition', 'attachment')
          }
          res.setHeader('Content-Type', contentType)
          res.setHeader('X-Content-Type-Options', 'nosniff')
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.end(body)
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end('데모 파일 사본을 확인하세요.')
          server.config?.logger?.error(error instanceof Error ? error.message : String(error))
        }
      })
    },
    generateBundle() {
      const repository = source()
      for (const [oid, payload] of repository.objects()) {
        this.emitFile({ type: 'asset', fileName: `repository/${oid}.json`, source: payload })
        const bytes = repository.loadRaw(oid).bytes
        this.emitFile({ type: 'asset', fileName: `repository/${oid}.bin`, source: bytes })
        for (const extension of repository.rawExtensions(oid)) this.emitFile({ type: 'asset', fileName: `repository/${oid}.${extension}`, source: bytes })
      }
    },
  }
}
