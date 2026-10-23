import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { once, EventEmitter } from 'node:events'
import { execFileSync, type ChildProcess } from 'node:child_process'
import { WebSocket, WebSocketServer } from 'ws'
import { REMOTE_LIMITS, REMOTE_PROTOCOL, REMOTE_FLOW_CONTROL } from '../shared/remote-access.ts'
import { remoteKeyPair, signRemoteToken, verifyRemoteToken } from '../shared/remote-access-crypto.ts'

const fingerprint = Array(32).fill('AA').join(':'), sdp = `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 3000
  while (!predicate() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(predicate(), 'isolated host startup settled')
}

class FixturePeer extends EventEmitter {
  connected = true
  exitCode: number | null = null
  messages: Record<string, any>[] = []
  acknowledge = true
  held: string[] = []
  send(value: Record<string, any>, callback?: (error: Error | null) => void) {
    this.messages.push(value)
    callback?.(null)
    if (value.type === 'start') queueMicrotask(() => this.emit('message', { type: 'answer', sdp }))
    if (value.type === 'send') {
      if (this.acknowledge) queueMicrotask(() => this.emit('message', { type: 'sent', id: value.id }))
      else this.held.push(value.id)
    }
    if (value.type === 'close') {
      this.connected = false
      this.exitCode = 0
      queueMicrotask(() => this.emit('exit', 0))
    }
    return true
  }
  kill() { this.connected = false; this.exitCode = 0; this.emit('exit', 0); return true }
  data(value: unknown) { this.emit('message', { type: 'data', data: JSON.stringify(value) }) }
  responses() { return this.messages.filter(value => value.type === 'send').map(value => JSON.parse(value.data)) }
  release() { this.acknowledge = true; for (const id of this.held.splice(0)) this.emit('message', { type: 'sent', id }) }
}

test('host prepares RTC before its ticket while keeping authentication and cleanup behind verification', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-startup-')), previousData = process.env.MEW_DATA_DIR, authorities = tls.getCACertificates('default')
  process.env.MEW_DATA_DIR = directory
  const certificate = path.join(directory, 'certificate.pem'), key = path.join(directory, 'key.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
  tls.setDefaultCACertificates([...authorities, fs.readFileSync(certificate, 'utf8')])
  const central = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(certificate) }, (_req, res) => { res.statusCode = 404; res.end() })
  const wss = new WebSocketServer({ server: central })
  central.listen(0, '127.0.0.1')
  await once(central, 'listening')
  const origin = `https://127.0.0.1:${(central.address() as { port: number }).port}`
  const { createRemoteAgent } = await import('./remote-access-agent.ts')
  const { saveRemoteRegistration } = await import('./remote-access-state.ts')
  const { accessChanges } = await import('./access-policy.ts')
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate()
    wss.close()
    central.closeAllConnections()
    await new Promise<void>(resolve => central.close(() => resolve()))
    tls.setDefaultCACertificates(authorities)
    if (previousData === undefined) delete process.env.MEW_DATA_DIR
    else process.env.MEW_DATA_DIR = previousData
    fs.rmSync(directory, { recursive: true, force: true })
  })

  async function fixture(t: TestContext, signalResume = false) {
    const host = await remoteKeyPair(), authority = await remoteKeyPair(), browser = await remoteKeyPair()
    const instance = 'startup-instance', subject = 'startup-browser', frames: Record<string, any>[] = [], peers: FixturePeer[] = []
    saveRemoteRegistration({ origin, instance, owner: 'owner', name: 'home', ...host, centralKey: authority.publicKey, accounts: {} })
    const connected = once(wss, 'connection')
    const local = http.createServer()
    const localSockets = new WebSocketServer({ noServer: true })
    local.on('upgrade', (req, socket, head) => localSockets.handleUpgrade(req, socket, head, () => {}))
    t.after(() => { for (const socket of localSockets.clients) socket.terminate(); localSockets.close() })
    let requests = 0
    local.on('request', (_req, res) => { requests++; res.end('fixture') })
    const agent = createRemoteAgent(local, { forkPeer: () => { const peer = new FixturePeer(); peers.push(peer); return peer as unknown as ChildProcess } })
    const [socket] = await connected as [WebSocket]
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString()); frames.push(frame)
      if (frame.type === 'host') socket.send(JSON.stringify({ type: 'online' }))
    })
    socket.send(JSON.stringify({ type: 'challenge', nonce: 'fixture-host-challenge', protocol: REMOTE_PROTOCOL, signalResume }))
    await until(() => agent.status().state === 'online')
    t.after(() => { agent.close(); socket.terminate(); saveRemoteRegistration(null) })
    const send = (value: unknown) => socket.send(JSON.stringify(value))
    async function prepare(connection = 'connection-a') {
      const count = peers.length, frameOffset = frames.length
      send({ type: 'prepare', authMode: 'local', instance, subject, clientIp: '127.0.0.1', connection, sdp, fingerprint, browserKey: browser.publicKey, signalResume })
      await until(() => frames.slice(frameOffset).some(value => value.type === 'ready' && value.connection === connection))
      const ready = frames.slice(frameOffset).find(value => value.type === 'ready' && value.connection === connection)!
      assert.equal(peers.length, count + 1, 'prepare starts the peer without receiving a ticket')
      const peer = peers.at(-1)!
      assert.equal(peer.messages[0].type, 'start')
      return { connection, ready, peer }
    }
    async function ticket(prepared: Awaited<ReturnType<typeof prepare>>, override: Record<string, unknown> = {}) {
      return signRemoteToken(authority.privateKey, origin, instance, subject, {
        authMode: 'local', clientIp: '127.0.0.1', connection: prepared.connection,
        challenge: prepared.ready.challenge, generation: prepared.ready.generation, fingerprint, browserKey: browser.publicKey, signalResume, ...override,
      })
    }
    async function authenticate(prepared: Awaited<ReturnType<typeof prepare>>, token: string) {
      return { type: 'authenticate', ticket: token, proof: await signRemoteToken(browser.privateKey, 'mew-browser', instance, subject, {
        connection: prepared.connection, challenge: prepared.ready.challenge, generation: prepared.ready.generation, fingerprint,
      }) }
    }
    return { agent, socket, peers, frames, send, prepare, ticket, authenticate, host, requests: () => requests }
  }

  await t.test('a prepared answer and early DataChannel authentication do not bypass the final ticket', async t => {
    const f = await fixture(t), prepared = await f.prepare(), token = await f.ticket(prepared)
    await until(() => f.frames.some(value => value.type === 'answer'))
    prepared.peer.data(await f.authenticate(prepared, token))
    prepared.peer.data({ type: 'request', id: 'early-work', method: 'GET', path: '/api/work', headers: {} })
    prepared.peer.data({ type: 'end', id: 'early-work' })
    await tick()
    assert.deepEqual(prepared.peer.responses(), [])
    assert.equal(f.requests(), 0)
    f.send({ type: 'ticket', connection: prepared.connection, ticket: token })
    await until(() => prepared.peer.responses().some(value => value.type === 'authenticated'))
    await until(() => prepared.peer.responses().some(value => value.type === 'response' && value.id === 'early-work'))
    assert.equal(prepared.peer.responses().filter(value => value.type === 'authenticated').length, 1)
    assert.equal(prepared.peer.responses().find(value => value.type === 'response' && value.id === 'early-work')!.status, 401)
    assert.equal(f.requests(), 0, 'an authenticated transport does not itself grant workspace access')
    f.send({ type: 'ticket', connection: prepared.connection, ticket: token })
    await tick()
    assert.equal(f.peers.length, 1, 'a repeated ticket never creates another peer')
  })

  await t.test('end before verification discards early authentication and ignores a late ticket and peer callbacks', async t => {
    const f = await fixture(t), prepared = await f.prepare(), token = await f.ticket(prepared)
    prepared.peer.data(await f.authenticate(prepared, token))
    f.send({ type: 'end', connection: prepared.connection })
    await until(() => !prepared.peer.connected)
    const count = f.frames.filter(value => value.connection === prepared.connection).length
    f.send({ type: 'ticket', connection: prepared.connection, ticket: token })
    prepared.peer.emit('message', { type: 'answer', sdp })
    prepared.peer.emit('exit', 1)
    await tick()
    assert.deepEqual(prepared.peer.responses(), [])
    assert.equal(f.frames.filter(value => value.connection === prepared.connection).length, count)
    assert.equal(f.socket.readyState, WebSocket.OPEN)
  })

  await t.test('an invalid final ticket closes speculative peers without acknowledging queued authentication', async t => {
    const f = await fixture(t), prepared = await f.prepare(), token = await f.ticket(prepared, { challenge: 'different-challenge' })
    prepared.peer.data(await f.authenticate(prepared, token))
    f.send({ type: 'ticket', connection: prepared.connection, ticket: token })
    await until(() => !prepared.peer.connected)
    assert.deepEqual(prepared.peer.responses(), [])
    assert.equal(f.requests(), 0)
  })

  await t.test('failed early channel authentication closes only its peer after a valid ticket', async t => {
    const f = await fixture(t), first = await f.prepare(), second = await f.prepare('connection-b'), token = await f.ticket(first)
    first.peer.data({ ...await f.authenticate(first, token), ticket: 'wrong-ticket' })
    f.send({ type: 'ticket', connection: first.connection, ticket: token })
    await until(() => !first.peer.connected)
    assert.deepEqual(first.peer.responses(), [])
    assert.equal(second.peer.connected, true)
    assert.equal(f.socket.readyState, WebSocket.OPEN)
  })

  await t.test('prepared resources retain the eight-connection limit and release slots on end', async t => {
    const f = await fixture(t)
    const prepared: Awaited<ReturnType<typeof f.prepare>>[] = []
    for (let index = 0; index < 8; index++) prepared.push(await f.prepare('connection-' + index))
    f.send({ type: 'prepare', authMode: 'local', instance: 'startup-instance', subject: 'startup-browser', clientIp: '127.0.0.1', connection: 'over-limit', sdp, fingerprint, browserKey: (await remoteKeyPair()).publicKey })
    await until(() => f.frames.some(value => value.connection === 'over-limit'))
    assert.equal(f.frames.find(value => value.connection === 'over-limit')!.code, 'local-permission-denied')
    assert.equal(f.peers.length, 8)
    f.send({ type: 'end', connection: prepared[0].connection })
    await until(() => !prepared[0].peer.connected)
    await f.prepare('replacement')
    assert.equal(f.peers.filter(peer => peer.connected).length, 8)
  })

  await t.test('ticket timeout releases prepared resources and prevents a late authentication', async t => {
    const f = await fixture(t), prepared = await f.prepare(), token = await f.ticket(prepared), now = Date.now()
    prepared.peer.data(await f.authenticate(prepared, token))
    const clock = t.mock.method(Date, 'now', () => now + REMOTE_LIMITS.ticket + 1)
    accessChanges.emit('change')
    clock.mock.restore()
    await until(() => !prepared.peer.connected)
    f.send({ type: 'ticket', connection: prepared.connection, ticket: token })
    await tick()
    assert.deepEqual(prepared.peer.responses(), [])
    assert.equal(f.requests(), 0)
  })

  await t.test('ending a connection during answer signing prevents its late signed answer from being emitted', async t => {
    const f = await fixture(t), prepared = await f.prepare()
    await until(() => f.frames.some(value => value.type === 'answer'))
    let release!: () => void, signing = false
    const barrier = new Promise<void>(resolve => { release = resolve }), original = crypto.subtle.sign.bind(crypto.subtle)
    const sign = t.mock.method(crypto.subtle, 'sign', async (...args: Parameters<typeof crypto.subtle.sign>) => { signing = true; await barrier; return original(...args) })
    prepared.peer.emit('message', { type: 'answer', sdp })
    await until(() => signing)
    f.send({ type: 'end', connection: prepared.connection })
    await until(() => !prepared.peer.connected)
    const count = f.frames.filter(value => value.type === 'answer').length
    release()
    await tick()
    sign.mock.restore()
    assert.equal(f.frames.filter(value => value.type === 'answer').length, count)
  })

  await t.test('negotiated authenticated peers survive an abnormal signal close and appear in the next host nonce proof', async t => {
    const f = await fixture(t, true), prepared = await f.prepare(), token = await f.ticket(prepared)
    f.send({ type: 'ticket', connection: prepared.connection, ticket: token }); prepared.peer.data(await f.authenticate(prepared, token))
    await until(() => prepared.peer.responses().some(value => value.type === 'authenticated'))
    const reconnect = once(wss, 'connection')
    f.socket.terminate()
    await until(() => f.agent.status().state === 'offline')
    assert.equal(prepared.peer.connected, true)
    const [replacement] = await reconnect as [WebSocket]
    const frame = once(replacement, 'message')
    replacement.send(JSON.stringify({ type: 'challenge', nonce: 'replacement-nonce', protocol: REMOTE_PROTOCOL, signalResume: true }))
    const [raw] = await frame
    const message = JSON.parse(raw.toString()), claims = await verifyRemoteToken(message.proof, f.host.publicKey, 'mew-instance', `${origin}/signal`)
    assert.deepEqual(claims.connections, [prepared.connection])
    assert.equal(claims.nonce, 'replacement-nonce')
    replacement.send(JSON.stringify({ type: 'online', signalResume: true }))
    replacement.send(JSON.stringify({ type: 'end', connection: prepared.connection }))
    await until(() => !prepared.peer.connected)
    replacement.terminate()
  })

  await t.test('signal loss never preserves speculative peers or peers without negotiated support', async t => {
    for (const supported of [false, true]) {
      const f = await fixture(t, supported), prepared = await f.prepare()
      if (!supported) {
        const token = await f.ticket(prepared)
        f.send({ type: 'ticket', connection: prepared.connection, ticket: token }); prepared.peer.data(await f.authenticate(prepared, token))
        await until(() => prepared.peer.responses().some(value => value.type === 'authenticated'))
      }
      f.socket.terminate()
      await until(() => !prepared.peer.connected)
      f.agent.close()
    }
  })

  await t.test('normal signal close and an expired authorization still end authenticated resumable peers', async t => {
    for (const cause of ['normal', 'expiry']) {
      const f = await fixture(t, true), prepared = await f.prepare(), token = await f.ticket(prepared)
      f.send({ type: 'ticket', connection: prepared.connection, ticket: token }); prepared.peer.data(await f.authenticate(prepared, token))
      await until(() => prepared.peer.responses().some(value => value.type === 'authenticated'))
      if (cause === 'normal') f.socket.close(1000)
      else {
        f.socket.terminate(); await until(() => f.agent.status().state === 'offline')
        const now = Date.now(), clock = t.mock.method(Date, 'now', () => now + REMOTE_LIMITS.lease + 1)
        accessChanges.emit('change'); clock.mock.restore()
      }
      await until(() => !prepared.peer.connected)
      f.agent.close()
    }
  })

  const { upsertUser, createSession } = await import('./auth.ts')
  upsertUser('ipc-fixture@example.test', { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 })
  async function authenticatedPeer(f: Awaited<ReturnType<typeof fixture>>, connection: string) {
    const prepared = await f.prepare(connection), token = await f.ticket(prepared)
    f.send({ type: 'ticket', connection, ticket: token })
    prepared.peer.data({ ...await f.authenticate(prepared, token), session: createSession('ipc-fixture@example.test') })
    await until(() => prepared.peer.responses().some(value => value.type === 'authenticated'))
    return prepared.peer
  }
  function mixed(peer: FixturePeer, prefix: string) {
    for (let index = 0; index < REMOTE_LIMITS.streams; index++) {
      peer.data({ type: 'socket', id: `${prefix}-ws-${index}`, path: '/api/presence', flowControl: REMOTE_FLOW_CONTROL })
      peer.data({ type: 'request', id: `${prefix}-http-${index}`, method: 'GET', path: '/api/fixture', headers: {}, flowControl: REMOTE_FLOW_CONTROL })
    }
  }
  function cancelMixed(peer: FixturePeer, prefix: string) {
    for (let index = 0; index < REMOTE_LIMITS.streams; index++) {
      peer.data({ type: 'cancel', id: `${prefix}-ws-${index}` })
      peer.data({ type: 'cancel', id: `${prefix}-http-${index}` })
    }
  }

  await t.test('three browsers can each wait on sixteen HTTP and sixteen WS acknowledgments without closing another connection', async t => {
    const f = await fixture(t), peers: FixturePeer[] = []
    for (let index = 0; index < 3; index++) peers.push(await authenticatedPeer(f, 'ipc-peer-' + index))
    for (const [index, peer] of peers.entries()) {
      peer.acknowledge = false; mixed(peer, 'mixed-' + index)
      await until(() => peer.held.length === 32 || !peer.connected)
      assert.equal(peer.connected, true)
      assert.equal(peer.held.length, 32)
    }
    assert.equal(peers.every(peer => peer.connected), true)
    assert.equal(f.requests(), 48)
    for (const peer of peers) peer.release()
    await until(() => peers.every(peer => peer.responses().filter(frame => frame.type === 'end').length === 16))
    assert.equal(peers.every(peer => peer.connected), true)
  })

  await t.test('the exact per-connection IPC limit isolates overload and closing releases pending sends before a replacement peer starts', async t => {
    const f = await fixture(t), busy = await authenticatedPeer(f, 'ipc-busy'), other = await authenticatedPeer(f, 'ipc-other')
    other.acknowledge = false; mixed(other, 'other')
    await until(() => other.held.length === 32)
    busy.acknowledge = false; mixed(busy, 'first')
    await until(() => busy.held.length === 32)
    cancelMixed(busy, 'first'); mixed(busy, 'second')
    await until(() => busy.held.length === 64 || !busy.connected)
    assert.equal(busy.connected, true, 'exactly 64 outstanding sends are allowed for this connection')
    assert.equal(busy.held.length, 64)
    cancelMixed(busy, 'second')
    busy.data({ type: 'request', id: 'over-limit', method: 'GET', path: '/api/fixture', headers: {}, flowControl: REMOTE_FLOW_CONTROL })
    await until(() => !busy.connected)
    assert.equal(busy.held.length, 64, 'the 65th send is rejected before reaching the peer')
    assert.equal(other.connected, true)
    const replacement = await authenticatedPeer(f, 'ipc-busy')
    busy.release()
    other.release()
    await until(() => other.responses().filter(frame => frame.type === 'end').length === 16)
    mixed(replacement, 'replacement')
    await until(() => replacement.responses().filter(frame => frame.type === 'end').length === 16)
    assert.equal(replacement.connected, true, 'closed peer waiters and late acknowledgments cannot affect the replacement')
    assert.equal(other.connected, true)
  })
})
