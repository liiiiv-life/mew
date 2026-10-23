import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from 'jose'
import { connectRemote } from './remote-connection.ts'
import { activeRemoteTransport, DataChannelTransport, setRemoteTransport } from './remote-transport.ts'
import { initializeRemoteApp } from './remote-app.ts'
import { REMOTE_LIMITS, type RemoteFrame } from '../../shared/remote-access.ts'

class Wire extends EventTarget {
  readyState = 'open'
  bufferedAmount = 0
  frames: RemoteFrame[] = []
  send(data: string) { this.frames.push(JSON.parse(data)) }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')) }
  message(frame: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })) }
}
class SocketConstants {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
}
class TestCloseEvent extends Event {
  code: number
  constructor(type: string, init: CloseEventInit) { super(type); this.code = init.code ?? 0 }
}
function globals(values: Record<string, unknown>) {
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  return () => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } }
}
async function until(done: () => boolean) {
  const deadline = performance.now() + 2000
  while (performance.now() < deadline) { if (done()) return; await new Promise(resolve => setImmediate(resolve)) }
  assert.fail('Remote fixture did not finish')
}
function transportFixture(t: TestContext) {
  const restore = globals({ location: new URL('https://app.example.test'), WebSocket: SocketConstants, CloseEvent: TestCloseEvent })
  const wire = new Wire(), transport = new DataChannelTransport(wire as never)
  t.after(() => { transport.close(); restore() })
  return { wire, transport }
}

test('reconnect cancels active responses, pending fetches and virtual sockets while keeping the wire open', async t => {
  const { wire, transport } = transportFixture(t)
  const responsePromise = transport.fetch('/api/files')
  await until(() => wire.frames.length > 0)
  const id = wire.frames[0]!.id
  wire.message({ type: 'response', id, status: 200, headers: {}, responseWindow: 1 })
  const response = await responsePromise, reading = assert.rejects(response.text(), /결과를 확인/)
  const pending = assert.rejects(transport.fetch('/api/files'), /결과를 확인/)
  const socket = transport.socket('/api/presence')
  let closed = 0
  socket.onclose = event => { assert.equal(event.code, 1006); closed++ }
  transport.suspendForReconnect()
  await Promise.all([reading, pending])
  assert.equal(closed, 1)
  assert.equal(transport.closed, false)
  assert.equal(wire.readyState, 'open')
  assert.equal(transport.requests.size, 0)
  assert.equal(transport.sockets.size, 0)
  await assert.rejects(transport.fetch('/api/files'), /다시 연결/)
  const retry = transport.socket('/api/presence')
  const failedRetry = new Promise<void>(resolve => { retry.onclose = () => resolve() })
  await failedRetry
  assert.equal(retry.readyState, SocketConstants.CLOSED)
  transport.resumeAfterReconnect()
  const fresh = transport.fetch('/api/files')
  await until(() => wire.frames.some(frame => frame.type === 'request' && frame.id !== id))
  const freshFrame = wire.frames.filter(frame => frame.type === 'request').at(-1)!
  wire.message({ type: 'response', id: freshFrame.id, status: 204, headers: {} })
  wire.message({ type: 'end', id: freshFrame.id })
  assert.equal((await fresh).status, 204)
})

test('a reconnect never replays writes waiting for backpressure or admission into the replacement bridge', async t => {
  const { wire, transport } = transportFixture(t)
  const request = (id: string): RemoteFrame => ({ type: 'request', id, method: 'POST', path: '/api/files', headers: {} })
  for (let i = 0; i < REMOTE_LIMITS.streams; i++) await transport.forward(request(`active-${i}`))
  const queued = transport.forward(request('queued-write'))
  const queuedBody = transport.forward({ type: 'chunk', id: 'queued-write', data: btoa('command') })
  wire.bufferedAmount = REMOTE_LIMITS.queue + 1
  const buffered = transport.forward({ type: 'chunk', id: 'active-0', data: btoa('command') })
  const settled = Promise.allSettled([queued, queuedBody, buffered])
  transport.suspendForReconnect()
  wire.frames = []
  transport.resumeAfterReconnect()
  wire.bufferedAmount = 0
  await settled
  assert.deepEqual(wire.frames, [])
  await transport.forward(request('fresh-write'))
  assert.deepEqual(wire.frames.map(frame => frame.id), ['fresh-write'])
})

test('queued fetches and uploads cannot survive a suspend and immediate resume', async t => {
  const { wire, transport } = transportFixture(t)
  wire.bufferedAmount = REMOTE_LIMITS.queue + 1
  const pending = Array.from({ length: REMOTE_LIMITS.streams + 1 }, () => transport.fetch('/api/files', { method: 'POST', body: 'command' }))
  const settled = Promise.allSettled(pending)
  await until(() => transport.requests.size === REMOTE_LIMITS.streams)
  transport.suspendForReconnect()
  transport.resumeAfterReconnect()
  wire.bufferedAmount = 0
  assert.ok((await settled).every(result => result.status === 'rejected'))
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.deepEqual(wire.frames, [])
  assert.equal(transport.closed, false)
})

test('app reconnect controls preserve the MessagePort and resume the existing transport with one online event', async t => {
  const browser = new EventTarget(), frames: RemoteFrame[] = []
  let launcherPort!: MessagePort, handshakes = 0, online = 0
  browser.addEventListener('online', () => online++)
  const restore = globals({ location: new URL('https://app.example.test/__mew_ui/abcdefghijklmnopqrst/index.html'), window: browser, WebSocket: SocketConstants, CloseEvent: TestCloseEvent, parent: { postMessage(_value: unknown, _origin: string, ports: MessagePort[]) {
    handshakes++
    launcherPort = ports[0]!
    launcherPort.onmessage = ({ data }) => {
      if (typeof data !== 'string') return
      const frame = JSON.parse(data) as RemoteFrame
      frames.push(frame)
      if (frame.type === 'request' && frame.path === '/api/auth/me') {
        launcherPort.postMessage(JSON.stringify({ type: 'response', id: frame.id, status: 200, headers: {}, responseWindow: 1 }))
        launcherPort.postMessage(JSON.stringify({ type: 'chunk', id: frame.id, data: btoa(JSON.stringify({ authenticated: true, email: 'user@example.test' })) }))
        launcherPort.postMessage(JSON.stringify({ type: 'end', id: frame.id }))
      }
    }
    launcherPort.postMessage({ type: 'mew-app-context', instance: 'instance' })
  } } })
  t.after(() => { browser.dispatchEvent(new Event('pagehide')); setRemoteTransport(null); launcherPort?.close(); restore() })
  assert.equal((await initializeRemoteApp()).email, 'user@example.test')
  const transport = activeRemoteTransport() as DataChannelTransport
  const pending = assert.rejects(transport.fetch('/api/files', { method: 'POST', body: 'write-once' }), /결과를 확인/)
  await until(() => frames.some(frame => frame.type === 'request' && frame.path === '/api/files'))
  launcherPort.postMessage({ type: 'mew-app-reconnecting' })
  await pending
  assert.equal(transport.suspended, true)
  assert.equal(transport.channel.readyState, 'open')
  await assert.rejects(transport.fetch('/api/files'), /다시 연결/)
  launcherPort.postMessage({ type: 'mew-app-reconnected' })
  launcherPort.postMessage({ type: 'mew-app-reconnected' })
  await until(() => online === 1)
  assert.equal(activeRemoteTransport(), transport)
  assert.equal(transport.suspended, false)
  assert.equal(handshakes, 1)
  const fresh = transport.fetch('/api/auth/me')
  assert.equal((await fresh).status, 200)
  assert.equal(frames.filter(frame => frame.type === 'request' && frame.method === 'POST').length, 1)
})

function bootstrapFixture(t: TestContext, reconnecting = false) {
  const browser = new EventTarget(), frames: RemoteFrame[] = []
  let launcherPort!: MessagePort, handshakes = 0
  const restore = globals({ location: new URL('https://app.example.test/__mew_ui/abcdefghijklmnopqrst/index.html'), window: browser, WebSocket: SocketConstants, CloseEvent: TestCloseEvent, parent: { postMessage(_value: unknown, _origin: string, ports: MessagePort[]) {
    handshakes++; launcherPort = ports[0]!
    launcherPort.onmessage = ({ data }) => { if (typeof data === 'string') frames.push(JSON.parse(data)) }
    launcherPort.postMessage({ type: 'mew-app-context', instance: 'instance', reconnecting, initialAuth: reconnecting ? { authenticated: true, email: 'stale@example.test', role: 'owner', mustChangePassword: false } : undefined })
  } } })
  const initializing = initializeRemoteApp()
  void initializing.catch(() => {})
  t.after(() => { browser.dispatchEvent(new Event('pagehide')); setRemoteTransport(null); launcherPort?.close(); restore() })
  const send = (value: unknown) => launcherPort.postMessage(typeof value === 'string' ? value : JSON.stringify(value))
  return { initializing, frames, handshakes: () => handshakes, control: (type: string) => launcherPort.postMessage({ type }), send, reply(id: string, email = 'user@example.test') {
    send({ type: 'response', id, status: 200, headers: {}, responseWindow: 1 })
    send({ type: 'chunk', id, data: btoa(JSON.stringify({ authenticated: true, email })) })
    send({ type: 'end', id })
  } }
}

test('app bootstrap waits for recovery when its initial context is already reconnecting', async t => {
  const fixture = bootstrapFixture(t, true)
  await until(() => (activeRemoteTransport() as DataChannelTransport | null)?.suspended === true)
  assert.deepEqual(fixture.frames, [])
  fixture.control('mew-app-reconnected')
  await until(() => fixture.frames.some(frame => frame.type === 'request'))
  const request = fixture.frames.find(frame => frame.type === 'request')!
  fixture.reply(request.id)
  assert.equal((await fixture.initializing).email, 'user@example.test')
  assert.equal(fixture.handshakes(), 1)
  assert.equal(fixture.frames.filter(frame => frame.type === 'request').length, 1)
})

for (const stage of ['headers', 'body']) {
  test(`app bootstrap retries only its initial authentication GET after ${stage} are interrupted by a fast reconnect`, async t => {
    const fixture = bootstrapFixture(t)
    await until(() => fixture.frames.some(frame => frame.type === 'request'))
    const first = fixture.frames.find(frame => frame.type === 'request')!
    if (stage === 'body') fixture.send({ type: 'response', id: first.id, status: 200, headers: {}, responseWindow: 1 })
    const transport = activeRemoteTransport() as DataChannelTransport
    const interruptedWrite = assert.rejects(transport.fetch('/api/files', { method: 'POST', body: 'once' }), /결과를 확인/)
    await until(() => fixture.frames.some(frame => frame.type === 'request' && frame.method === 'POST'))
    fixture.control('mew-app-reconnecting'); fixture.control('mew-app-reconnected')
    await until(() => fixture.frames.filter(frame => frame.type === 'request' && frame.path === '/api/auth/me').length === 2)
    await interruptedWrite
    const latest = fixture.frames.filter(frame => frame.type === 'request' && frame.path === '/api/auth/me').at(-1)!
    if (stage === 'headers') fixture.reply(first.id, 'stale@example.test')
    else fixture.send({ type: 'end', id: first.id })
    fixture.reply(latest.id)
    assert.equal((await fixture.initializing).email, 'user@example.test')
    assert.equal(fixture.handshakes(), 1)
    assert.equal(activeRemoteTransport(), transport)
    assert.equal(fixture.frames.filter(frame => frame.type === 'request' && frame.method === 'POST').length, 1)
  })
}

test('disconnecting during app bootstrap rejects the recovery waiter and closes the transport', async t => {
  const fixture = bootstrapFixture(t, true)
  const rejected = assert.rejects(fixture.initializing, /연결이 종료/)
  await until(() => (activeRemoteTransport() as DataChannelTransport | null)?.suspended === true)
  const transport = activeRemoteTransport() as DataChannelTransport
  fixture.control('mew-app-disconnected')
  await rejected
  assert.equal(transport.closed, true)
  assert.equal(activeRemoteTransport(), null)
  assert.deepEqual(fixture.frames, [])
})

const fingerprint = Array(32).fill('AB').join(':')
const sdp = `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`
class Peer {
  static latest: Peer
  channel = new Wire()
  connectionState = 'new'
  constructor() { Peer.latest = this }
  createDataChannel() { return this.channel }
  async createOffer() { return { type: 'offer', sdp } }
  async setLocalDescription() {}
  close() { this.connectionState = 'closed' }
}
class Signal extends SocketConstants {
  static latest: Signal
  readyState = 1
  frames: Record<string, unknown>[] = []
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  constructor() { super(); Signal.latest = this }
  send(data: string) { this.frames.push(JSON.parse(data)) }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.() }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
function connectionFixture(t: TestContext, key: JWK = {}, options: Parameters<typeof connectRemote>[2] = {}) {
  const restore = globals({ RTCPeerConnection: Peer, WebSocket: Signal, location: new URL('https://app.example.test'), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), window: new EventTarget() })
  t.mock.method(globalThis, 'fetch', async () => Response.json(key))
  const states: string[] = []
  const close = connectRemote('instance', state => states.push(state), options)
  t.after(() => { close(); restore() })
  return { signal: Signal.latest, peer: Peer.latest, states }
}

test('reconnections reuse the supplied non-extractable browser key and export only its public key', async t => {
  const browser = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as CryptoKeyPair
  const central = await generateKeyPair('EdDSA'), host = await generateKeyPair('EdDSA')
  const { signal, peer, states } = connectionFixture(t, await exportJWK(central.publicKey), { keyPair: browser, session: 'stored-session' })
  signal.message({ type: 'challenge', protocol: 1 })
  await until(() => signal.frames.length > 0 || states.includes('error'))
  assert.equal(browser.privateKey.extractable, false)
  assert.deepEqual(signal.frames[0]!.publicKey, await exportJWK(browser.publicKey))
  assert.equal(JSON.stringify(signal.frames).includes('stored-session'), false)
  const ticket = await new SignJWT({ connection: 'connection', challenge: 'challenge', generation: 'generation', fingerprint, authMode: 'local', instanceKey: await exportJWK(host.publicKey) }).setProtectedHeader({ alg: 'EdDSA' }).setIssuer('https://app.example.test').setAudience('instance').setSubject('subject').setIssuedAt().setExpirationTime('60s').sign(central.privateKey)
  signal.message({ type: 'ticket', connection: 'connection', ticket })
  await until(() => peer.channel.frames.length > 0 || states.includes('error'))
  assert.equal(states.includes('error'), false)
  const authentication = peer.channel.frames[0] as unknown as { proof: string; session: string }
  const proof = await jwtVerify(authentication.proof, browser.publicKey, { issuer: 'mew-browser', audience: 'instance' })
  assert.equal(proof.payload.connection, 'connection')
  assert.equal(authentication.session, 'stored-session')
})

for (const [code, expected] of [['access-revoked', 'revoked'], ['permission-denied', 'denied'], ['offline', 'error'], ['connection-denied', 'error']]) {
  test(`signaling ${code} produces ${expected} so recovery can distinguish permission revocation`, async t => {
    const { signal, peer, states } = connectionFixture(t)
    signal.message({ type: 'error', code })
    await until(() => states.length > 0)
    assert.deepEqual(states, [expected])
    assert.equal(peer.channel.readyState, 'closed')
  })
}
