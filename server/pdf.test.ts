import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { PDFDocument } from 'pdf-lib'
import { pdfRevision, registerPdfRoutes, replacePdf } from './pdf.ts'

test('PDF save is atomic, rejects stale revisions and serializes concurrent writers', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-pdf-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'original.pdf')
  const document = await PDFDocument.create(); document.addPage()
  const initial = Buffer.from(await document.save()); await fs.writeFile(file, initial, { mode: 0o640 })
  const revision = pdfRevision(file)
  await assert.rejects(replacePdf(file, '', initial), { status: 428 })
  await assert.rejects(replacePdf(file, revision, Buffer.from('not pdf')), { status: 400 })
  assert.deepEqual(await fs.readFile(file), initial)
  document.addPage(); const updated = Buffer.from(await document.save())
  const attempts = await Promise.allSettled([replacePdf(file, revision, updated), replacePdf(file, revision, initial)])
  assert.equal(attempts[0].status, 'fulfilled')
  assert.equal(attempts[1].status, 'rejected')
  assert.deepEqual(await fs.readFile(file), updated)
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640)
  assert.notEqual(pdfRevision(file), revision)
  assert.deepEqual(await fs.readdir(dir), ['original.pdf'])
  await assert.rejects(replacePdf(file, revision, initial), { status: 409 })
})

test('PDF routes enforce access, revision-bound range reads and conditional writes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-pdf-api-'))
  const file = path.join(dir, 'test.pdf')
  const document = await PDFDocument.create(); document.addPage()
  const bytes = Buffer.from(await document.save()); await fs.writeFile(file, bytes)
  const app = express()
  registerPdfRoutes(app, (req, res) => {
    if (req.get('X-Test-Role') === 'denied') { res.status(403).end(); return null }
    return { file, editable: req.get('X-Test-Role') === 'editor' }
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(dir, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/pdf?path=test.pdf`
  assert.equal((await fetch(url, { headers: { 'X-Test-Role': 'denied' } })).status, 403)
  const head = await fetch(url, { method: 'HEAD', headers: { 'X-Test-Role': 'editor' } })
  const revision = head.headers.get('X-Mew-Pdf-Revision')!
  assert.equal(head.headers.get('X-Mew-Pdf-Editable'), 'true')
  const range = await fetch(`${url}&revision=${encodeURIComponent(revision)}`, { headers: { Range: 'bytes=0-4' } })
  assert.equal(range.status, 206); assert.equal(await range.text(), '%PDF-')
  assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'If-Match': revision }, body: bytes })).status, 403)
  const write = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'If-Match': revision, 'X-Test-Role': 'editor' }, body: bytes })
  assert.equal(write.status, 200)
  assert.equal((await fetch(`${url}&revision=${encodeURIComponent(revision)}`)).status, 409)
  assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'If-Match': revision, 'X-Test-Role': 'editor' }, body: bytes })).status, 409)
})
