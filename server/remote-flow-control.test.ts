import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { REMOTE_FLOW_CONTROL, REMOTE_LIMITS, parseRemoteFrame, type RemoteFrame } from '../shared/remote-access.ts'
import { remoteDispatcher } from './remote-access-dispatch.ts'
import { RemoteSendWindow } from './remote-send-window.ts'
import type { AuthenticatedSession } from './auth.ts'

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 5)) }
}
test('flow control and counted credits reject malformed or unbounded limits', () => {
  for (const flowControl of [null, [], { version: 2, maxWindow: 256 }, { version: 1, maxWindow: 8, separateStreams: false }]) assert.throws(() => parseRemoteFrame(JSON.stringify({ type: 'open', id: 'x', flowControl })))
  for (const maxWindow of [0, 7, 257, 1.5, '256']) for (const type of ['request', 'response', 'socket', 'open']) {
    assert.throws(() => parseRemoteFrame(JSON.stringify({ type, id: 'x', method: 'GET', path: '/api/presence', headers: {}, flowControl: { version: 1, maxWindow } })))
  }
  for (const count of [0, -1, 257, 1.5, '2']) assert.throws(() => parseRemoteFrame(JSON.stringify({ type: 'credit', id: 'x', count })))
  for (const data of ['A===', '=AAA', 'AA=A', 'AA', 'AA\n=']) assert.throws(() => parseRemoteFrame(JSON.stringify({ type: 'chunk', id: 'x', data })))
  for (const data of ['', 'AA==', 'AAA=', 'AAAA']) assert.equal(parseRemoteFrame(JSON.stringify({ type: 'chunk', id: 'x', data })).type, 'chunk')
})
test('send windows bound grants and cancel a producer waiting for consumer credit', async () => {
  const window = new RemoteSendWindow(1, 8)
  await window.take()
  let taken = false
  const taking = window.take().then(() => { taken = true })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(taken, false)
  window.grant(8); await taking
  assert.throws(() => window.grant(2), /credit-limit/)
  for (let i = 0; i < 7; i++) await window.take()
  const blocked = window.take(); window.close()
  await assert.rejects(blocked, /cancelled/)
})
test('separate stream pools permit sixteen WS and sixteen HTTP operations but reject a seventeenth of either kind', async t => {
  for (const extra of ['request', 'socket'] as const) {
    const server = http.createServer((_req, res) => { res.writeHead(200); res.flushHeaders() })
    const sockets = new WebSocketServer({ noServer: true }), frames: RemoteFrame[] = []
    server.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, () => {}))
    let closed = false
    const account: AuthenticatedSession = { email: 'test@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
    const dispatcher = remoteDispatcher(server, { send: async raw => { frames.push(JSON.parse(raw)) }, close: () => { closed = true } }, () => account, 'https://mew.test')
    t.after(() => { dispatcher.close(); for (const ws of sockets.clients) ws.terminate(); sockets.close() })
    for (let i = 0; i < 16; i++) {
      await dispatcher.receive(JSON.stringify({ type: 'socket', id: 'socket-' + i, path: '/api/presence', flowControl: REMOTE_FLOW_CONTROL }))
      await dispatcher.receive(JSON.stringify({ type: 'request', id: 'request-' + i, path: '/api/hold', method: 'GET', headers: {}, responseWindow: 8, flowControl: REMOTE_FLOW_CONTROL }))
    }
    await until(() => frames.filter(frame => frame.type === 'open' || frame.type === 'response').length === 32)
    assert.equal(closed, false)
    await dispatcher.receive(JSON.stringify({ type: extra, id: 'overflow', path: '/api/presence', method: 'GET', headers: {}, flowControl: REMOTE_FLOW_CONTROL }))
    assert.equal(closed, true)
  }
})
test('negotiated WS credit reaches the consumer, preserves siblings and stops after cancellation or revocation', async t => {
  const server = http.createServer((_req, res) => res.end('healthy'))
  const sockets = new WebSocketServer({ noServer: true }), frames: RemoteFrame[] = []
  let account: AuthenticatedSession | null = { email: 'test@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  let closed = false
  server.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, ws => { ws.send(Buffer.alloc(REMOTE_LIMITS.chunk * 32, 7)) }))
  const dispatcher = remoteDispatcher(server, { send: async raw => { frames.push(JSON.parse(raw)) }, close: () => { closed = true } }, () => account, 'https://mew.test', { alive: () => true })
  t.after(() => { dispatcher.close(); for (const ws of sockets.clients) ws.terminate(); sockets.close() })
  const send = (frame: RemoteFrame) => dispatcher.receive(JSON.stringify(frame))
  const chunks = (id: string) => frames.filter(frame => frame.id === id && frame.type === 'message')
  await send({ type: 'socket', id: 'bounded', path: '/api/presence', flowControl: REMOTE_FLOW_CONTROL })
  await until(() => chunks('bounded').length === 8)
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(chunks('bounded').length, 8)
  assert.deepEqual((frames.find(frame => frame.type === 'open') as Extract<RemoteFrame, { type: 'open' }>).flowControl, REMOTE_FLOW_CONTROL)
  await send({ type: 'request', id: 'sibling', method: 'GET', path: '/api/health', headers: {}, responseWindow: 8 })
  await until(() => frames.some(frame => frame.id === 'sibling' && frame.type === 'end'))
  await send({ type: 'credit', id: 'bounded', count: 16 })
  await until(() => chunks('bounded').length === 24)
  await send({ type: 'close', id: 'bounded' }); await send({ type: 'credit', id: 'bounded', count: 8 })
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(chunks('bounded').length, 24); assert.equal(closed, false)
  await send({ type: 'socket', id: 'legacy', path: '/api/presence' })
  await until(() => chunks('legacy').length === 32)
  assert.equal((frames.find(frame => frame.type === 'open' && frame.id === 'legacy') as Extract<RemoteFrame, { type: 'open' }>).flowControl, undefined)
  await send({ type: 'socket', id: 'revoked', path: '/api/presence', flowControl: REMOTE_FLOW_CONTROL })
  await until(() => chunks('revoked').length === 8)
  account = null; dispatcher.revalidate()
  await until(() => frames.some(frame => frame.id === 'revoked' && frame.type === 'error'))
  await send({ type: 'credit', id: 'revoked', count: 8 })
  assert.equal(chunks('revoked').length, 8); assert.equal(closed, false)
})
test('normal WS close follows its complete message even while the consumer withholds credit', async t => {
  const server = http.createServer(), sockets = new WebSocketServer({ noServer: true }), frames: RemoteFrame[] = []
  let closed = false
  server.on('upgrade', (req, socket, head) => sockets.handleUpgrade(req, socket, head, ws => ws.send(Buffer.alloc(REMOTE_LIMITS.chunk * 12, 13), () => ws.close(1000))))
  const account: AuthenticatedSession = { email: 'test@example.test', user: { hash: '', role: 'owner', mustChangePassword: false, createdAt: 1, passwordChangedAt: 0 } }
  const dispatcher = remoteDispatcher(server, { send: async raw => { frames.push(JSON.parse(raw)) }, close: () => { closed = true } }, () => account, 'https://mew.test')
  t.after(() => { dispatcher.close(); for (const ws of sockets.clients) ws.terminate(); sockets.close() })
  await dispatcher.receive(JSON.stringify({ type: 'socket', id: 'ordered', path: '/api/presence', flowControl: REMOTE_FLOW_CONTROL }))
  await until(() => frames.filter(frame => frame.type === 'message').length === 8)
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(frames.some(frame => frame.type === 'close'), false)
  await dispatcher.receive(JSON.stringify({ type: 'credit', id: 'ordered', count: 8 }))
  await until(() => frames.some(frame => frame.type === 'close'))
  assert.equal(frames.filter(frame => frame.type === 'message').length, 12)
  assert.equal(frames.at(-1)?.type, 'close')
  assert.equal(closed, false)
})
