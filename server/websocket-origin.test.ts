import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import http, { type IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { sameWebSocketOrigin } from '../packages/tmux-term/src/server/websocket-origin.ts'
import { webSocketOriginAllowed } from './websocket-origin.ts'
import { bindRemoteSocket } from './remote-access-context.ts'
import { disableTestPty } from './test-disabled-pty.ts'
import { LIVE_WS_PATH } from '../shared/live-updates.ts'

test('WebSocket origins match scheme, host and port and only verified live P2P may bypass them', () => {
  const request = (origin?: string, forwarded?: string, encrypted = false) => ({ headers: { host: 'mew.example.test:5000', ...(origin === undefined ? {} : { origin }), ...(forwarded ? { 'x-forwarded-proto': forwarded } : {}) }, socket: { encrypted } }) as unknown as IncomingMessage
  assert.equal(sameWebSocketOrigin(request()), true, 'native callers without Origin remain compatible')
  assert.equal(sameWebSocketOrigin(request('http://mew.example.test:5000')), true)
  assert.equal(sameWebSocketOrigin(request('https://mew.example.test:5000', 'https')), true)
  assert.equal(sameWebSocketOrigin(request('https://mew.example.test:5000', undefined, true)), true)
  for (const origin of ['null', '', 'http://mew.example.test:3000', 'http://other.example.test:5000', 'https://mew.example.test:5000', 'http://mew.example.test:5000/', 'http://user@mew.example.test:5000', 'not-an-origin']) {
    assert.equal(sameWebSocketOrigin(request(origin)), false, origin)
  }
  assert.equal(sameWebSocketOrigin(request('http://mew.example.test:5000', 'https')), false)
  const socket = new PassThrough(), remote = { ...request('https://central.example.test'), socket } as unknown as IncomingMessage
  assert.equal(webSocketOriginAllowed(remote), false, 'a header is never proof of P2P transport')
  let alive = true
  bindRemoteSocket(socket, { current: () => null, alive: () => alive })
  assert.equal(webSocketOriginAllowed(remote), true)
  alive = false
  assert.equal(webSocketOriginAllowed(remote), false, 'stale P2P contexts fail closed')
  socket.destroy()
})

test('terminal, agent, collaboration, database, presence and live upgrades reject other browser origins before work starts', async t => {
  const moduleHooks = disableTestPty()
  t.after(() => moduleHooks.deregister())
  const { attachTmuxWebSocket } = await import('../packages/tmux-term/src/server/tmuxWs.ts')
  const { attachAgentWebSocket } = await import('./agentWs.ts')
  const { attachCollabWebSocket } = await import('./collab.ts')
  const { attachDbWebSocket } = await import('./db/socket.ts')
  const { attachPresenceWebSocket } = await import('./presence.ts')
  const { attachLiveWebSocket } = await import('./live-socket.ts')
  const server = http.createServer()
  const denied = () => false
  attachTmuxWebSocket(server, { cwd: process.cwd(), authorize: denied, originAllowed: webSocketOriginAllowed })
  attachAgentWebSocket(server, { authorize: denied })
  attachCollabWebSocket(server, { authorize: denied })
  attachDbWebSocket(server, { authorize: denied })
  attachPresenceWebSocket(server, { getAuth: () => ({ role: 'guest', email: null, mustChangePassword: false }) })
  attachLiveWebSocket(server, () => { throw new Error('no resource was requested') })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })
  const handshake = (pathname: string, origin?: string) => new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${pathname}`, origin === undefined ? {} : { origin })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('handshake timed out')) }, 3000)
    const finish = (status: number) => { clearTimeout(timer); socket.terminate(); resolve(status) }
    socket.on('error', () => {})
    socket.once('unexpected-response', (_request, response) => { response.resume(); finish(response.statusCode!) })
    socket.once('open', () => finish(101))
  })
  const routes = ['/api/tmux/ws?session=fixture', '/api/agent/ws', '/api/collab?room=docs:fixture.md', '/api/db/ws', '/api/presence', LIVE_WS_PATH]
  for (const route of routes) {
    for (const origin of ['http://127.0.0.1:1', `https://127.0.0.1:${address.port}`, 'null', 'https://other.example.test']) {
      assert.equal(await handshake(route, origin), 403, `${route}: ${origin}`)
    }
    const expected = ['/api/presence', LIVE_WS_PATH].includes(route) ? 101 : 401
    assert.equal(await handshake(route, `http://127.0.0.1:${address.port}`), expected, route)
    assert.equal(await handshake(route), expected, `${route}: native client`)
  }
})
