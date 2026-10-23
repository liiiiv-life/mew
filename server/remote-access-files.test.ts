import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { AuthenticatedSession } from './auth.ts'
import type { RemoteFrame } from '../shared/remote-access.ts'
test('P2P file routes preserve real file permissions, temporary-password restrictions and per-account roots', { timeout: 15_000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-remote-files-'))
  process.env.MEW_DATA_DIR = path.join(temporary, 'data'); process.env.MEW_WORKSPACE = path.join(temporary, 'first')
  const second = path.join(temporary, 'second')
  for (const root of [process.env.MEW_WORKSPACE, second]) { fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs', 'note.md'), root === second ? 'second root' : 'first root') }
  const { createApiApp } = await import('./api.ts'), { attachAuthContext } = await import('./reqAuth.ts'), { setFileRule } = await import('./access-policy.ts'), { upsertUser, getUser } = await import('./auth.ts'), { writeActiveWorkspace } = await import('./userUiState.ts'), { resetTreeWatchers } = await import('./watcher.ts')
  for (const [email, role] of [['owner@example.test', 'owner'], ['reader@example.test', 'member']] as const) upsertUser(email, { role, hash: '', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 })
  let current: AuthenticatedSession | null = { email: 'reader@example.test', user: getUser('reader@example.test')! }, closed = false
  const app = express(); app.use(attachAuthContext); app.use('/api', createApiApp())
  const server = http.createServer(app), frames: RemoteFrame[] = []
  const dispatcher = remoteDispatcher(server, { send: async raw => { const frame = JSON.parse(raw); frames.push(frame); if (frame.type === 'response' || frame.type === 'chunk') setImmediate(() => { void dispatcher.receive(JSON.stringify({ type: 'credit', id: frame.id })) }) }, close: () => { closed = true } }, () => current, 'https://mew.saens.kr')
  t.after(() => { dispatcher.close(); server.closeAllConnections(); resetTreeWatchers(); fs.rmSync(temporary, { recursive: true, force: true }) })
  const request = async (method = 'GET', body?: object) => {
    const id = crypto.randomUUID()
    await dispatcher.receive(JSON.stringify({ type: 'request', id, method, path: '/api/file?project=docs&path=note.md', headers: { 'content-type': 'application/json', cookie: 'mew_session=forged' } }))
    if (body) { await dispatcher.receive(JSON.stringify({ type: 'chunk', id, data: Buffer.from(JSON.stringify(body)).toString('base64') })); await dispatcher.receive(JSON.stringify({ type: 'end', id })) }
    const deadline = Date.now() + 4000
    while (!frames.some(frame => frame.id === id && frame.type === 'end')) { if (Date.now() > deadline) throw new Error('File request timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
    const response = frames.find(frame => frame.id === id && frame.type === 'response') as Extract<RemoteFrame, { type: 'response' }>
    const bytes = Buffer.concat(frames.filter((frame): frame is Extract<RemoteFrame, { type: 'chunk' }> => frame.id === id && frame.type === 'chunk').map(frame => Buffer.from(frame.data, 'base64')))
    return { status: response.status, body: JSON.parse(bytes.toString()) }
  }
  setFileRule('reader@example.test', 'docs', 'note.md', 'view')
  assert.equal((await request()).body.content, 'first root')
  assert.equal((await request('PUT', { path: 'note.md', content: 'forbidden' })).status, 403)
  assert.equal(fs.readFileSync(path.join(process.env.MEW_WORKSPACE, 'docs/note.md'), 'utf8'), 'first root')
  setFileRule('reader@example.test', 'docs', 'note.md', 'deny')
  assert.equal((await request()).status, 403)
  current = { email: 'owner@example.test', user: getUser('owner@example.test')! }
  assert.equal((await request('PUT', { path: 'note.md', content: 'saved remotely' })).status, 200)
  assert.equal(fs.readFileSync(path.join(process.env.MEW_WORKSPACE, 'docs/note.md'), 'utf8'), 'saved remotely')
  writeActiveWorkspace('reader@example.test', second)
  current = { email: 'reader@example.test', user: getUser('reader@example.test')! }
  assert.equal((await request()).body.content, 'second root')
  current = { ...current, user: { ...current.user, mustChangePassword: true } }
  assert.equal((await request()).status, 403)
  current = null; await dispatcher.receive(JSON.stringify({ type: 'request', id: 'revoked', method: 'GET', path: '/api/file?project=docs&path=note.md', headers: {} }))
  assert.equal(closed, true)
})
