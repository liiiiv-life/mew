import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { PDFDocument } from 'pdf-lib'
import { createApiApp } from './api.ts'
import { setWorkspaceRoot, WORKSPACE_ROOT } from './paths.ts'
import { setFileRule } from './access-policy.ts'
import { resetTreeWatchers } from './watcher.ts'
import type { Role } from './reqAuth.ts'

test('actual PDF API preserves guest, external-file, archive and project boundaries', async t => {
  const previousRoot = WORKSPACE_ROOT
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-pdf-access-')))
  const project = `pdf-access-${Date.now()}`
  const dir = path.join(root, project)
  fs.mkdirSync(path.join(dir, 'archives'), { recursive: true })
  const pdf = await PDFDocument.create(); pdf.addPage()
  const bytes = Buffer.from(await pdf.save())
  const file = path.join(dir, 'public.pdf')
  fs.writeFileSync(file, bytes)
  fs.writeFileSync(path.join(dir, 'private.pdf'), bytes)
  fs.writeFileSync(path.join(dir, 'archives', 'old.pdf'), bytes)
  fs.writeFileSync(path.join(root, 'outside.pdf'), bytes)
  fs.symlinkSync(path.join(root, 'outside.pdf'), path.join(dir, 'escape.pdf'))
  setWorkspaceRoot(root)
  setFileRule('guest', project, 'public.pdf', 'view')
  let role: Role = 'guest'
  const app = express()
  app.use((req, _res, next) => { req.auth = { role, email: role === 'guest' ? null : 'pdf-test@example.test', mustChangePassword: false }; next() })
  app.use('/api', createApiApp())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    setFileRule('guest', project, 'public.pdf', 'inherit')
    resetTreeWatchers(); setWorkspaceRoot(previousRoot); fs.rmSync(root, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const url = `${origin}/api/pdf?project=${project}&path=public.pdf`
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('X-Mew-Pdf-Editable'), 'false')
  const headers = { 'Content-Type': 'application/pdf', 'If-Match': head.headers.get('X-Mew-Pdf-Revision')! }
  assert.equal((await fetch(url, { method: 'PUT', headers, body: bytes })).status, 403)
  assert.equal((await fetch(url.replace('public.pdf', 'private.pdf'))).status, 403)
  setFileRule('guest', project, 'public.pdf', 'edit')
  assert.equal((await fetch(url, { method: 'PUT', headers, body: bytes })).status, 200)
  role = 'member'
  assert.equal((await fetch(`${origin}/api/fs/pdf?path=${encodeURIComponent(file)}`)).status, 403)
  assert.equal((await fetch(url.replace('public.pdf', '../outside.pdf'))).status, 403)
  assert.equal((await fetch(url.replace('public.pdf', 'escape.pdf'))).status, 400)
  role = 'owner'
  const archive = await fetch(url.replace('public.pdf', 'archives/old.pdf'), { method: 'HEAD' })
  assert.equal(archive.headers.get('X-Mew-Pdf-Editable'), 'false')
  assert.equal((await fetch(url.replace('public.pdf', 'archives/old.pdf'), { method: 'PUT', headers, body: bytes })).status, 403)
  assert.equal((await fetch(`${origin}/api/fs/pdf?path=${encodeURIComponent(file)}`)).status, 200)
})
