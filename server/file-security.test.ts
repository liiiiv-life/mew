import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import express from 'express'
import { disableTestPty } from './test-disabled-pty.ts'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-file-security-'))
process.env.MEW_DATA_DIR = path.join(temp, 'state')
process.env.MEW_WORKSPACE = path.join(temp, 'workspace')
const docs = path.join(process.env.MEW_WORKSPACE, 'docs')
fs.mkdirSync(path.join(docs, 'shared'), { recursive: true })
const moduleHooks = disableTestPty()
const { createApiApp } = await import('./api.ts')
const { setFileRule } = await import('./access-policy.ts')
const { resetTreeWatchers } = await import('./watcher.ts')
after(() => { moduleHooks.deregister(); resetTreeWatchers(); fs.rmSync(temp, { recursive: true, force: true }) })

test('raw project files, assets and server files cannot execute document scripts', async t => {
  const name = '.mew/temp/assets/123e4567-e89b-42d3-a456-426614174000.html'
  fs.mkdirSync(path.join(docs, '.mew/temp/assets'), { recursive: true })
  const html = '<body><h1>Untrusted file</h1><script>document.body.dataset.executed="inline"</script><script src="/api/raw?path=payload.js"></script></body>'
  fs.writeFileSync(path.join(docs, 'example.html'), html)
  fs.writeFileSync(path.join(docs, name), html)
  fs.writeFileSync(path.join(docs, 'payload.js'), 'document.body.dataset.executed="external"')
  const app = express()
  app.use((req, _res, next) => { req.auth = { role: 'owner', email: 'owner@example.test', mustChangePassword: false }; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  for (const url of ['/api/raw?path=example.html', `/api/asset?path=${encodeURIComponent(name)}`, `/api/fs/raw?path=${encodeURIComponent(path.join(docs, 'example.html'))}`]) {
    const response = await fetch(origin + url)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-security-policy')!, /^sandbox;/)
    assert.doesNotMatch(response.headers.get('content-security-policy')!, /allow-scripts|allow-same-origin/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(await response.text(), html)
  }
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(origin + '/api/raw?path=example.html')
  assert.equal(await page.locator('h1').textContent(), 'Untrusted file')
  assert.equal(await page.locator('body').getAttribute('data-executed'), null)
})

test('guest folder editing preserves existing files and cannot create files or directories', async t => {
  setFileRule('guest', 'docs', 'shared', 'edit')
  const existing = path.join(docs, 'shared/existing.md')
  fs.writeFileSync(existing, 'longer original text')
  const app = express()
  app.use((req, _res, next) => { req.auth = { role: 'guest', email: null, mustChangePassword: false }; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const save = (file: string) => fetch(origin + '/api/file', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: file, content: 'short', commit: false }) })
  assert.equal((await save('shared/existing.md')).status, 200)
  assert.equal(fs.readFileSync(existing, 'utf8'), 'short')
  assert.equal((await save('shared/new.md')).status, 403)
  assert.equal((await save('shared/new-directory/new.md')).status, 403)
  assert.equal(fs.existsSync(path.join(docs, 'shared/new.md')), false)
  assert.equal(fs.existsSync(path.join(docs, 'shared/new-directory')), false)
})
