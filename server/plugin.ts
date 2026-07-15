import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiApp } from './api'

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env')
if (fs.existsSync(envPath)) process.loadEnvFile(envPath)

export function docsApiPlugin(): Plugin {
  return {
    name: 'docs-api',
    configureServer(server) {
      server.middlewares.use('/api', createApiApp())
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', createApiApp({ readOnly: true }))
    },
  }
}
