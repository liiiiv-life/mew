import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import type { BrowserContext, Page } from 'playwright-core'
import { MewpetSkinStore } from './mewpet-skins.ts'
import { createMewpetSkinsRouter } from './mewpet-skin-routes.ts'

export async function mewpetUiFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mewpet-ui-'))
  const store = new MewpetSkinStore(path.join(root, 'skins'))
  const app = express()
  const errors: string[] = []
  app.use((req, res, next) => {
    res.on('finish', () => { if (res.statusCode >= 400) errors.push(`${res.statusCode} ${req.originalUrl}`) })
    next()
  })
  app.use((req, _res, next) => { req.auth = { role: req.headers['x-pet-role'] === 'member' ? 'member' : 'owner', email: 'pet-ui@example.test', mustChangePassword: false }; next() })
  app.use('/api/mewpet/skins', createMewpetSkinsRouter(store))
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    store,
    errors,
    async route(page: Page | BrowserContext, role = 'owner') {
      await page.route('**/api/mewpet/skins**', async route => {
        try {
          const request = route.request(), url = new URL(request.url())
          const response = await page.request.fetch(origin + url.pathname + url.search, { method: request.method(), headers: { ...request.headers(), 'x-pet-role': role }, data: request.postDataBuffer() ?? undefined })
          await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() })
          await response.dispose()
        } catch (error) {
          if (!/closed|disposed|cancelled/i.test(String(error))) throw error
        }
      })
    },
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()))
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}
