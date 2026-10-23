import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import type { RemoteFrame } from '../shared/remote-access.ts'
import type { AuthenticatedSession } from './auth.ts'

const owner: AuthenticatedSession = { email: 'owner@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for remote frame')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
function harness() {
  const server = http.createServer((_req, res) => res.end('still-connected'))
  const sockets = new WebSocketServer({ noServer: true }), hosts: Duplex[] = [], peers: WebSocket[] = [], frames: RemoteFrame[] = []
  let closed = false
  server.on('connection', socket => hosts.push(socket))
  server.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, ws => { peers.push(ws); ws.on('message', data => ws.send(data)) }))
  const dispatcher = remoteDispatcher(server, { send: async raw => { frames.push(JSON.parse(raw)) }, close: () => { closed = true } }, () => owner, 'https://mew.test')
  const receive = (frame: RemoteFrame) => dispatcher.receive(JSON.stringify(frame))
  return { dispatcher, frames, hosts, peers, receive, closed: () => closed, cleanup: () => { dispatcher.close(); for (const ws of peers) ws.terminate(); sockets.close() } }
}
async function checkStillConnected(h: ReturnType<typeof harness>) {
  await h.receive({ type: 'request', id: 'health', method: 'GET', path: '/api/health', headers: {}, responseWindow: 8 })
  await until(() => h.frames.some(frame => frame.type === 'end' && frame.id === 'health'))
  const text = h.frames.filter((frame): frame is Extract<RemoteFrame, { type: 'chunk' }> => frame.type === 'chunk' && frame.id === 'health').map(frame => Buffer.from(frame.data, 'base64').toString()).join('')
  assert.equal(text, 'still-connected')
  assert.equal(h.closed(), false)
}

test('a message already in flight during a WebSocket close does not close the P2P session', async t => {
  const h = harness(); t.after(h.cleanup)
  await h.receive({ type: 'socket', id: 'closing', path: '/api/presence' })
  await until(() => h.frames.some(frame => frame.type === 'open' && frame.id === 'closing'))
  h.hosts[0].pause()
  h.peers[0].close()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.frames.some(frame => frame.type === 'close' && frame.id === 'closing'), false, 'close acknowledgement remains in flight')
  await h.receive({ type: 'message', id: 'closing', data: Buffer.from('already-in-flight').toString('base64'), binary: false })
  assert.equal(h.closed(), false, 'a socket closing normally must not tear down other operations')
  h.hosts[0].resume()
  await until(() => h.frames.some(frame => frame.type === 'close' && frame.id === 'closing'))
  await checkStillConnected(h)
})

test('a local WebSocket send callback failure closes that socket and preserves HTTP operations', async t => {
  const h = harness(); t.after(h.cleanup)
  await h.receive({ type: 'socket', id: 'failed', path: '/api/presence' })
  await until(() => h.frames.some(frame => frame.type === 'open' && frame.id === 'failed'))
  const original = WebSocket.prototype.send
  t.mock.method(WebSocket.prototype, 'send', function (this: WebSocket, ...args: Parameters<WebSocket['send']>) {
    if (typeof args[0] === 'string' && args[0] === 'callback-failure') {
      const callback = args.find(arg => typeof arg === 'function') as ((error?: Error) => void) | undefined
      callback?.(new Error('local socket closed during send'))
      return
    }
    return original.apply(this, args)
  })
  await h.receive({ type: 'message', id: 'failed', data: Buffer.from('callback-failure').toString('base64'), binary: false })
  assert.equal(h.closed(), false)
  await until(() => h.frames.some(frame => frame.type === 'error' && frame.id === 'failed'))
  await checkStillConnected(h)
})

test('invalid protocol frames still close the full P2P session', async t => {
  const h = harness(); t.after(h.cleanup)
  await h.dispatcher.receive('{"type":"request","id":"bad","method":"GET","path":"https://evil.test/api/health","headers":{}}')
  assert.equal(h.closed(), true)
})
