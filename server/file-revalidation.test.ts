import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { createApiApp } from './api.ts'
import { setFileRule } from './access-policy.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { writeActiveWorkspace } from './userUiState.ts'
import { readStableTextFile, textFileVersion } from './text-file.ts'
import type { FileVersion } from '../shared/file-version.ts'

test('file revalidation skips body reads, notices rewrites and rechecks account permissions', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-file-revalidation-'))
  const originalRoot = WORKSPACE_ROOT
  const email = 'revalidation@example.test'
  const otherEmail = 'other-revalidation@example.test'
  const note = path.join(root, 'docs', 'note.md')
  fs.mkdirSync(path.dirname(note), { recursive: true })
  fs.writeFileSync(note, 'first body')
  // An exactly restorable mtime makes the same-size rewrite test independent of float rounding.
  fs.utimesSync(note, 1_700_000_000, 1_700_000_000)
  setWorkspaceRoot(root)
  const app = express()
  app.use((req, _res, next) => {
    req.auth = { role: 'member', email: req.headers['x-test-other'] ? otherEmail : email, mustChangePassword: false }
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/file?project=docs&path=note.md`
  const request = (version?: FileVersion, other = false) => fetch(base + (version?.tag ? `&version=${encodeURIComponent(version.tag)}` : ''), { headers: other ? { 'x-test-other': '1' } : {} })
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    setWorkspaceRoot(originalRoot)
    fs.rmSync(root, { recursive: true, force: true })
  })
  const originalRead = fs.promises.readFile.bind(fs.promises)
  let afterRead: (() => void) | undefined
  const reads = t.mock.method(fs.promises, 'readFile', async (...args: Parameters<typeof fs.promises.readFile>) => {
    const content = await originalRead(...args)
    if (args[0] === note) afterRead?.()
    return content
  })
  const bodyReads = () => reads.mock.calls.filter(call => call.arguments[0] === note).length
  const initialResponse = await request()
  assert.equal(initialResponse.status, 200)
  const initial = await initialResponse.json() as { content: string; editable: boolean; version: FileVersion }
  assert.equal(initial.content, 'first body')
  assert.equal(initial.editable, true)
  assert.ok(initial.version.tag)
  assert.equal(typeof initial.version.ctimeMs, 'number')
  const before = bodyReads()
  const unchangedResponse = await request(initial.version)
  assert.equal(unchangedResponse.status, 200, 'JSON status works through both HTTP and P2P transports')
  const unchanged = await unchangedResponse.json() as { unchanged: boolean; content?: string; version: FileVersion }
  assert.equal(unchanged.unchanged, true)
  assert.equal('content' in unchanged, false)
  assert.equal(bodyReads(), before, 'unchanged body is neither read nor transferred')
  assert.deepEqual(unchanged.version, initial.version)

  fs.writeFileSync(note, 'other body')
  fs.utimesSync(note, 1_700_000_000, 1_700_000_000)
  const changed = await (await request(initial.version)).json() as { content: string; unchanged?: boolean; version: FileVersion }
  assert.equal(changed.content, 'other body')
  assert.equal(changed.unchanged, undefined)
  assert.equal(changed.version.size, initial.version.size)
  assert.equal(changed.version.mtimeMs, initial.version.mtimeMs)
  assert.notEqual(changed.version.tag, initial.version.tag, 'ctime detects same-size rewrites with restored mtime')

  setFileRule(email, 'docs', 'note.md', 'view')
  const readOnly = await (await request(changed.version)).json() as { unchanged: boolean; editable: boolean }
  assert.equal(readOnly.unchanged, true)
  assert.equal(readOnly.editable, false, 'unchanged files still refresh edit permission')
  afterRead = () => setFileRule(email, 'docs', 'note.md', 'deny')
  assert.equal((await request()).status, 403, 'permission revoked during an asynchronous body read is checked again')
  afterRead = undefined
  setFileRule(email, 'docs', 'note.md', 'deny')
  assert.equal((await request(changed.version)).status, 403, 'cached versions never bypass view permission')
  const allowedOther = await (await request(changed.version, true)).json() as { unchanged: boolean; editable: boolean }
  assert.equal(allowedOther.unchanged, true)
  assert.equal(allowedOther.editable, true, 'permission decisions are never shared between accounts')

  const secondRoot = path.join(root, 'other-root')
  const secondNote = path.join(secondRoot, 'docs', 'note.md')
  fs.mkdirSync(path.dirname(secondNote), { recursive: true })
  fs.writeFileSync(secondNote, 'other root')
  fs.utimesSync(secondNote, 1_700_000_000, 1_700_000_000)
  writeActiveWorkspace(otherEmail, secondRoot)
  const otherRoot = await (await request(changed.version, true)).json() as { content: string; version: FileVersion; unchanged?: boolean }
  assert.equal(otherRoot.content, 'other root')
  assert.notEqual(otherRoot.version.tag, changed.version.tag)
  assert.equal(otherRoot.unchanged, undefined, 'the same project/path in another root never reuses a prior revision')

  fs.unlinkSync(secondNote)
  assert.equal((await request(otherRoot.version, true)).status, 404)

  fs.writeFileSync(path.join(root, 'docs', 'large.md'), 'x'.repeat(100 * 1024))
  const largeUrl = new URL(base)
  largeUrl.searchParams.set('path', 'large.md')
  const fullText = await (await fetch(largeUrl)).text()
  const largeVersion = (JSON.parse(fullText) as { version: FileVersion }).version
  largeUrl.searchParams.set('version', largeVersion.tag!)
  const unchangedText = await (await fetch(largeUrl)).text()
  const fullBytes = Buffer.byteLength(fullText)
  const unchangedBytes = Buffer.byteLength(unchangedText)
  assert.ok(fullBytes > 100 * 1024)
  assert.ok(unchangedBytes < 400, 'a 100 KiB document revalidates with a small metadata-only response')
  assert.ok(unchangedBytes < fullBytes / 100)
  assert.equal((JSON.parse(unchangedText) as { unchanged: boolean }).unchanged, true)
  t.diagnostic(`Synthetic 100 KiB file response: full=${fullBytes} bytes, unchanged=${unchangedBytes} bytes (JSON body, before transport compression)`)
})

test('stable text reads retry replacements and never validate continuously changing content', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-stable-text-'))
  const note = path.join(root, 'note.txt')
  fs.writeFileSync(note, 'first body')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const originalRead = fs.promises.readFile.bind(fs.promises)
  let edits = 0
  const reader = t.mock.method(fs.promises, 'readFile', async (...args: Parameters<typeof fs.promises.readFile>) => {
    const content = await originalRead(...args)
    if (args[0] === note && edits++ === 0) {
      const replacement = path.join(root, 'replacement')
      fs.writeFileSync(replacement, 'other body')
      fs.renameSync(replacement, note)
    }
    return content
  })
  const stable = await readStableTextFile(note)
  assert.equal(stable.content, 'other body')
  assert.equal(reader.mock.callCount(), 2)
  assert.deepEqual(stable.version, textFileVersion(note, fs.statSync(note)))
  reader.mock.restore()
  t.mock.method(fs.promises, 'readFile', async (...args: Parameters<typeof fs.promises.readFile>) => {
    const content = await originalRead(...args)
    if (args[0] === note) fs.appendFileSync(note, 'x')
    return content
  })
  assert.equal((await readStableTextFile(note)).version.tag, undefined, 'unstable content cannot become a conditional cache hit')
  const stat = fs.statSync(note)
  assert.notEqual(textFileVersion(note, stat).tag, textFileVersion(path.join(root, 'another.txt'), stat).tag, 'path is part of revision identity')
})
