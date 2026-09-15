import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

/** Keep CJK CMaps, fallback fonts and image decoders paired with the installed PDF.js version. */
export function pdfAssetsPlugin(): Plugin {
  const require = createRequire(import.meta.url)
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version as string
  const prefix = `/pdf-assets/${version}/`
  const files = new Map<string, string>([['pdf.worker.mjs', path.join(root, 'build/pdf.worker.mjs')], ['LICENSE', path.join(root, 'LICENSE')]])
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    for (const name of fs.readdirSync(path.join(root, directory))) {
      if (/\.(bcmap|pfb|ttf|wasm|icc|js)$/.test(name) || name.startsWith('LICENSE')) files.set(`${directory}/${name}`, path.join(root, directory, name))
    }
  }
  return {
    name: 'mew-pdf-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!pathname.startsWith(prefix)) return next()
        const file = files.get(pathname.slice(prefix.length))
        if (!file) { res.statusCode = 404; res.end(); return }
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : (/\.m?js$/).test(file) ? 'text/javascript' : 'application/octet-stream')
        fs.createReadStream(file).on('error', () => { res.statusCode = 500; res.end() }).pipe(res)
      })
    },
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: 'asset', fileName: `${prefix.slice(1)}${name}`, source: fs.readFileSync(file) })
    },
  }
}
