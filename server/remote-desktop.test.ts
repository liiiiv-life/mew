import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import { once, EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { desktopPlatform, desktopHostSpec, desktopIceServers, desktopUdpPort, type spawnDesktopHost } from './remote-desktop-host.ts'
import { attachRemoteDesktopWebSocket, desktopConnectionAllowed, validDesktopSignal } from './remote-desktop.ts'
import type { RequestAuth } from './reqAuth.ts'

const owner: RequestAuth = { role: 'owner', email: 'owner@example.test', mustChangePassword: false }

test('fixed direct UDP port is opt-in and bounded before native launch', () => {
  assert.equal(desktopUdpPort({}), undefined)
  assert.equal(desktopUdpPort({ MEW_DESKTOP_UDP_PORT: '50020' }), 50020)
  for (const value of ['0', '1023', '65536', '50020;command', '50020.5', '-1', ' 50020']) assert.throws(() => desktopUdpPort({ MEW_DESKTOP_UDP_PORT: value }))
})

test('desktop authorization requires an unchanged privileged account and exact Origin', () => {
  const request = { headers: { host: 'mew.example.test', origin: 'https://mew.example.test', 'x-forwarded-proto': 'https' }, socket: {} } as unknown as IncomingMessage
  assert.equal(desktopConnectionAllowed(request, owner), true)
  for (const auth of [{ ...owner, email: null }, { ...owner, role: 'member' }, { ...owner, mustChangePassword: true }] as RequestAuth[]) assert.equal(desktopConnectionAllowed(request, auth), false)
  for (const origin of ['', 'null', 'https://other.test', 'http://mew.example.test', 'https://mew.example.test:444']) assert.equal(desktopConnectionAllowed({ ...request, headers: { ...request.headers, origin } } as IncomingMessage, owner), false)
  assert.equal(validDesktopSignal({ type: 'exec', command: 'arbitrary' }), false)
  assert.equal(validDesktopSignal({ type: 'answer', sdp: 'bad' }), false)
  assert.equal(validDesktopSignal({ type: 'candidate', candidate: { candidate: 'x', sdpMLineIndex: -1 } }), false)
  assert.equal(validDesktopSignal({ type: 'select', id: 'screen:0:0' }), true)
})

test('OS launch plans use resident native Node hosts on Windows, Mac and Linux', async () => {
  assert.equal(desktopPlatform('darwin', 'Darwin'), 'mac')
  assert.equal(desktopPlatform('linux', '6.6.87.2-microsoft-standard-WSL2'), 'wsl')
  assert.equal(desktopPlatform('linux', '6.14.0'), 'linux')
  const mac = await desktopHostSpec({ platform: 'mac', env: { MEW_DESKTOP_HELPER_DIR: '/opt/Mew helper' } })
  assert.equal(mac.executable, '/opt/Mew helper/MewDesktop.app/Contents/MacOS/MewDesktop')
  assert.equal(mac.entry, '/opt/Mew helper/native-host.mjs')
  const calls: unknown[] = []
  const wsl = await desktopHostSpec({ platform: 'wsl', env: { MEW_DESKTOP_HELPER_DIR: 'C:\\Users\\Test User\\Mew' }, run: (async (file: string, args: string[]) => { calls.push([file, args]); return { stdout: '/mnt/c/Users/Test User/Mew/runtime/node.exe\n', stderr: '' } }) as never })
  assert.equal(wsl.entry, 'C:\\Users\\Test User\\Mew\\native-host.mjs')
  assert.equal(wsl.executable, '/mnt/c/Users/Test User/Mew/runtime/node.exe')
  assert.deepEqual(calls, [['wslpath', ['-u', 'C:\\Users\\Test User\\Mew\\runtime\\node.exe']]])
  await assert.rejects(desktopHostSpec({ platform: 'wsl', env: { MEW_DESKTOP_HELPER_DIR: '/home/test/helper' } }), /Windows/)
  assert.deepEqual(desktopIceServers({}), [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }])
  assert.deepEqual(desktopIceServers({ MEW_DESKTOP_ICE_SERVERS: '[]' }), [])
  assert.throws(() => desktopIceServers({ MEW_DESKTOP_ICE_SERVERS: '[{"urls":"turn:relay.example.test:3478"}]' }), /TURN/)
  assert.throws(() => desktopIceServers({ MEW_DESKTOP_ICE_SERVERS: '[{"urls":"https://wrong.test"}]' }))
})

function fakeHost() {
  const host = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { host.emit('exit', 0); return true } })
  const messages: Record<string, unknown>[] = []
  host.stdin.on('data', data => {
    for (const line of data.toString().trim().split('\n')) {
      const message = JSON.parse(line); messages.push(message)
      if (message.type === 'init') host.stdout.write('MEW_DESKTOP {"type":"sources","screens":[{"id":"screen:0:0"}]}\n')
      if (message.type === 'select') host.stdout.write('MEW_DESKTOP {"type":"offer","sdp":"v=0\\r\\n"}\n')
      if (message.type === 'answer') host.stdout.write('MEW_DESKTOP {"type":"connected"}\n')
      if (message.type === 'stop') setTimeout(() => host.emit('exit', 0), 20)
    }
  })
  return { host: host as unknown as Awaited<ReturnType<typeof spawnDesktopHost>>, messages }
}

test('signaling stops native capture after revocation/close, isolates controller and accepts replacement', { timeout: 8000 }, async () => {
  const server = createServer(), hosts: ReturnType<typeof fakeHost>[] = [], clients: WebSocket[] = []
  let auth = { ...owner }
  attachRemoteDesktopWebSocket(server, { getAuth: () => auth, heartbeatMs: 50, iceServers: () => [], spawnHost: async () => { const fake = fakeHost(); fake.host.desktopNetworkHint = '방화벽 설정 확인'; hosts.push(fake); return fake.host } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`
  const connect = () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/remote-desktop/ws`, { origin }), received: Record<string, unknown>[] = []
    clients.push(ws); ws.on('message', raw => received.push(JSON.parse(raw.toString())))
    return { ws, received }
  }
  const until = async (condition: () => boolean) => { for (let i = 0; i < 200 && !condition(); i++) await delay(10); assert.ok(condition()) }
  try {
    const first = connect(); await until(() => first.received.some(message => message.type === 'sources'))
    assert.ok(first.received.some(message => message.type === 'network-hint' && message.message === '방화벽 설정 확인'))
    first.ws.send(JSON.stringify({ type: 'select', id: 'screen:0:0' }))
    await until(() => first.received.some(message => message.type === 'offer'))
    first.ws.send(JSON.stringify({ type: 'answer', sdp: 'v=0\r\n' }))
    await until(() => first.received.some(message => message.type === 'connected'))
    const second = connect(); await once(second.ws, 'close')
    assert.ok(second.received.some(message => message.type === 'error'))
    assert.equal(hosts.length, 1)
    first.ws.close()
    const replacement = connect()
    await until(() => replacement.received.some(message => message.type === 'sources'))
    assert.equal(hosts.length, 2)
    assert.ok(hosts[0].messages.some(message => message.type === 'stop'))
    auth = { ...owner, role: 'member' }
    await once(replacement.ws, 'close')
    await until(() => hosts[1].messages.some(message => message.type === 'stop'))
  } finally {
    clients.forEach(ws => ws.terminate()); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('video preferences reach the native host and invalid requests cannot launch it', { timeout: 5000 }, async () => {
  const server = createServer(), hosts: ReturnType<typeof fakeHost>[] = [], clients: WebSocket[] = []
  attachRemoteDesktopWebSocket(server, { getAuth: () => owner, iceServers: () => [], spawnHost: async () => { const value = fakeHost(); hosts.push(value); return value.host } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const connect = (query: string) => { const ws = new WebSocket(`${origin.replace('http:','ws:')}/api/remote-desktop/ws${query}`, { origin }); clients.push(ws); return ws }
  try {
    for (const query of ['?fps=1000','?resolution=__proto__','?quality=lossless','?fps=0','?priority=unknown']) {
      const ws = connect(query), [code] = await once(ws,'close')
      assert.equal(code,1008); assert.equal(hosts.length,0)
    }
    for (const [query, video] of [
      ['', { resolution: '1080p', fps: 60, quality: 'balanced', priority: 'speed' }],
      ['?resolution=2160p&fps=240&quality=high', { resolution: '2160p', fps: 240, quality: 'high', priority: 'quality' }],
      ['?quality=high&priority=speed', { resolution: '1080p', fps: 60, quality: 'high', priority: 'speed' }],
      ['?priority=quality', { resolution: '1080p', fps: 60, quality: 'balanced', priority: 'quality' }],
    ] as const) {
      const ws = connect(query)
      await once(ws,'message')
      const current = hosts.at(-1)!
      assert.deepEqual(current.messages.find(value => value.type === 'init')?.video,video)
      const exited = once(current.host,'exit'); ws.close(); await exited
    }
  } finally { clients.forEach(ws => ws.terminate()); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('unknown screen selection cannot reach the native helper', { timeout: 5000 }, async () => {
  const server = createServer(), fake = fakeHost()
  attachRemoteDesktopWebSocket(server, { getAuth: () => owner, iceServers: () => [], spawnHost: async () => fake.host })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/remote-desktop/ws`, { origin: `http://127.0.0.1:${port}` })
  try {
    const exited = once(fake.host, 'exit')
    await once(ws, 'open'); ws.send('{"type":"select","id":"not-a-screen"}')
    const [code] = await once(ws, 'close'); assert.equal(code, 1008)
    await exited
    assert.equal(fake.messages.some(message => message.type === 'select'), false)
    assert.ok(fake.messages.some(message => message.type === 'stop'))
  } finally { ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('authenticated signaling accepts the next ICE offer and drops retired answers and candidates', { timeout: 5000 }, async () => {
  const server = createServer(), fake = fakeHost(), received: Record<string, unknown>[] = []
  attachRemoteDesktopWebSocket(server, { getAuth: () => owner, iceServers: () => [], spawnHost: async () => fake.host })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote-desktop/ws`, { origin })
  ws.on('message', raw => received.push(JSON.parse(raw.toString())))
  const until = async (condition: () => boolean) => { for (let i = 0; i < 200 && !condition(); i++) await delay(5); assert.ok(condition()) }
  try {
    await until(() => received.some(value => value.type === 'sources'))
    ws.send(JSON.stringify({ type: 'select', id: 'screen:0:0' }))
    await until(() => received.some(value => value.type === 'offer'))
    ws.send(JSON.stringify({ type: 'answer', negotiation: 0, sdp: 'v=0\r\n' }))
    await until(() => fake.messages.some(value => value.type === 'answer'))
    fake.host.stdout.emit('data', Buffer.from('MEW_DESKTOP {"type":"offer","negotiation":1,"sdp":"v=0\\r\\n"}\n'))
    await until(() => received.some(value => value.type === 'offer' && value.negotiation === 1))
    for (const negotiation of [0, 1]) {
      ws.send(JSON.stringify({ type: 'candidate', negotiation, candidate: { candidate: `generation-${negotiation}` } }))
      ws.send(JSON.stringify({ type: 'answer', negotiation, sdp: 'v=0\r\n' }))
    }
    await until(() => fake.messages.some(value => value.type === 'answer' && value.negotiation === 1))
    assert.equal(ws.readyState, WebSocket.OPEN)
    assert.deepEqual(fake.messages.filter(value => value.type === 'answer').map(value => value.negotiation), [0, 1])
    assert.deepEqual(fake.messages.filter(value => value.type === 'candidate').map(value => value.negotiation), [1])
    assert.equal(validDesktopSignal({ type: 'answer', negotiation: 3, sdp: 'v=0\r\n' }), false)
    const exited = once(fake.host, 'exit'); ws.close(); await exited
  } finally { ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

for (const type of ['relay', 'relay-input', 'frame-ack']) test(`direct-only signaling rejects ${type} without forwarding it`, { timeout: 5000 }, async () => {
  const server = createServer(), fake = fakeHost()
  attachRemoteDesktopWebSocket(server, { getAuth: () => owner, iceServers: () => [], spawnHost: async () => fake.host })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote-desktop/ws`, { origin })
  try {
    const exited = once(fake.host, 'exit')
    await once(ws, 'open'); ws.send(JSON.stringify({ type }))
    const [code] = await once(ws, 'close'); await exited
    assert.equal(code, 1008); assert.equal(fake.messages.some(value => value.type === type), false)
  } finally { ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
