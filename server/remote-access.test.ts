import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { WebSocketServer } from 'ws'
import { REMOTE_LIMITS, parseRemoteFrame, remotePath, type RemoteFrame } from '../shared/remote-access.ts'
import { remoteKeyPair, signRemoteToken, verifyRemoteToken } from '../shared/remote-access-crypto.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import { resolveAuth, attachAuthContext } from './reqAuth.ts'
import type { AuthenticatedSession } from './auth.ts'
const account: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
function harness() {
  const app = express(), server = http.createServer(app), frames: RemoteFrame[] = []
  let auth: AuthenticatedSession | null = account, closed = false
  app.use(attachAuthContext); app.use(express.json())
  app.get('/api/auth/me', (req, res) => { res.json(resolveAuth(req)) })
  app.post('/api/file', (req, res) => { res.json({ ...req.body, account: resolveAuth(req).email }) })
  app.get('/api/raw', (_req, res) => { res.setHeader('Content-Type', 'application/octet-stream'); res.end(Buffer.alloc(48_000, 13)) })
  let dispatcher: ReturnType<typeof remoteDispatcher>
  dispatcher = remoteDispatcher(server, { send: async raw => { const frame = JSON.parse(raw); frames.push(frame); if (frame.type === 'response' || frame.type === 'chunk') setImmediate(() => { void dispatcher.receive(JSON.stringify({ type: 'credit', id: frame.id })) }) }, close: () => { closed = true } }, () => auth, 'https://mew.saens.kr')
  return { server, dispatcher, frames, setAuth: (value: AuthenticatedSession | null) => { auth = value }, closed: () => closed }
}
async function until(fn: () => boolean) { const deadline = Date.now() + 4000; while (!fn()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 10)) } }
test('remote request paths cannot reach arbitrary origins, local ports or auth mutation', () => {
  for (const path of ['//evil.test/api/file', 'https://evil.test/api/file', '/api/../auth/login', '/api/auth/login', '/api/remote-access/register', '/api/%2fsecret', '/__mew_browser/x', '/api/file\nX: true']) assert.equal(remotePath(path), false, path)
  assert.equal(remotePath('/api/file?project=docs'), true)
  assert.equal(remotePath('/api/remote-ui/file?path=%2Fassets%2Fapp.js'), true)
  assert.equal(remotePath('/api/%2fassets?path=app.js'), false)
  assert.throws(() => parseRemoteFrame(JSON.stringify({ type: 'request', id: 'x', method: 'PUT', path: '/api/file', headers: { cookie: [] } })))
  assert.throws(() => parseRemoteFrame(' '.repeat(REMOTE_LIMITS.frame + 1)))
  assert.throws(() => parseRemoteFrame(JSON.stringify({ type: 'chunk', id: 'x', data: Buffer.alloc(REMOTE_LIMITS.chunk + 1).toString('base64') })))
})
test('signed tickets bind issuer, instance and expiry with fixed EdDSA keys', async () => {
  const key = await remoteKeyPair(), other = await remoteKeyPair()
  const token = await signRemoteToken(key.privateKey, 'https://mew.saens.kr', 'instance-a', 'account-a', { challenge: 'a', generation: 'boot' })
  const proof = await verifyRemoteToken(token, key.publicKey, 'https://mew.saens.kr', 'instance-a')
  assert.equal(proof.sub, 'account-a'); assert.equal(proof.challenge, 'a')
  await assert.rejects(verifyRemoteToken(token, other.publicKey, 'https://mew.saens.kr', 'instance-a'))
  await assert.rejects(verifyRemoteToken(token, key.publicKey, 'https://mew.saens.kr', 'instance-b'))
  await assert.rejects(verifyRemoteToken(token, key.publicKey, 'https://evil.test', 'instance-a'))
  const expired = await signRemoteToken(key.privateKey, 'https://mew.saens.kr', 'instance-a', 'account-a', {}, -10_000)
  await assert.rejects(verifyRemoteToken(expired, key.publicKey, 'https://mew.saens.kr', 'instance-a'))
})
test('P2P dispatch uses verified auth despite forged cookie and role headers', async t => {
  const h = harness(); t.after(() => h.dispatcher.close())
  await h.dispatcher.receive(JSON.stringify({ type: 'request', id: 'read', method: 'GET', path: '/api/auth/me', headers: { cookie: 'mew_session=forged', 'x-role': 'guest', host: 'evil.test' } }))
  await until(() => h.frames.some(frame => frame.type === 'end' && frame.id === 'read'))
  const body = Buffer.concat(h.frames.filter(frame => frame.type === 'chunk').map(frame => Buffer.from((frame as { data: string }).data, 'base64'))).toString()
  assert.equal(JSON.parse(body).email, account.email); assert.equal(JSON.parse(body).role, 'owner')
  assert.equal(h.closed(), false)
})
test('P2P POST and binary responses use existing parser and bounded chunks', async t => {
  const h = harness(); t.after(() => h.dispatcher.close())
  await h.dispatcher.receive(JSON.stringify({ type: 'request', id: 'write', method: 'POST', path: '/api/file', headers: { 'content-type': 'application/json' } }))
  await h.dispatcher.receive(JSON.stringify({ type: 'chunk', id: 'write', data: Buffer.from(JSON.stringify({ value: 42 })).toString('base64') }))
  await h.dispatcher.receive(JSON.stringify({ type: 'end', id: 'write' }))
  await until(() => h.frames.some(frame => frame.type === 'end' && frame.id === 'write'))
  const body = Buffer.concat(h.frames.filter(frame => frame.type === 'chunk' && frame.id === 'write').map(frame => Buffer.from((frame as { data: string }).data, 'base64')))
  assert.deepEqual(JSON.parse(body.toString()), { value: 42, account: account.email })
  await h.dispatcher.receive(JSON.stringify({ type: 'request', id: 'binary', method: 'GET', path: '/api/raw', headers: {} }))
  await until(() => h.frames.some(frame => frame.type === 'end' && frame.id === 'binary'))
  const chunks = h.frames.filter(frame => frame.type === 'chunk' && frame.id === 'binary').map(frame => Buffer.from((frame as { data: string }).data, 'base64'))
  assert.ok(chunks.every(chunk => chunk.length <= REMOTE_LIMITS.chunk)); assert.deepEqual(Buffer.concat(chunks), Buffer.alloc(48_000, 13))
})
test('existing WebSocket handlers receive the same verified request identity', async t => {
  const h = harness(), wss = new WebSocketServer({ noServer: true })
  h.server.on('upgrade', (req, socket, head) => { assert.equal(resolveAuth(req).email, account.email); wss.handleUpgrade(req, socket, head, ws => { ws.on('message', data => ws.send(data.toString())); ws.send('hello') }) })
  t.after(() => { h.dispatcher.close(); wss.close() })
  await h.dispatcher.receive(JSON.stringify({ type: 'socket', id: 'ws', path: '/api/presence' }))
  await until(() => h.frames.some(frame => frame.type === 'open'))
  await h.dispatcher.receive(JSON.stringify({ type: 'message', id: 'ws', data: Buffer.from('ping').toString('base64'), binary: false }))
  await until(() => h.frames.some(frame => frame.type === 'message' && Buffer.from(frame.data, 'base64').toString() === 'ping'))
  h.setAuth(null)
  await h.dispatcher.receive(JSON.stringify({ type: 'message', id: 'ws', data: Buffer.from('denied').toString('base64'), binary: false }))
  assert.equal(h.closed(), true)
})
