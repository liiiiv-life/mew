import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import { once, EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { desktopPlatform, desktopHostSpec, desktopIceServers, type spawnDesktopHost } from './remote-desktop-host.ts'
import { attachRemoteDesktopWebSocket, desktopConnectionAllowed, validDesktopSignal } from './remote-desktop.ts'
import type { RequestAuth } from './reqAuth.ts'
import { hostFrame } from '../native/remote-desktop/host-wire.mjs'
import { packFrame } from '../native/remote-desktop/relay-protocol.mjs'

const owner: RequestAuth = { role: 'owner', email: 'owner@example.test', mustChangePassword: false }

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

test('OS launch plans use native Electron and WSL uses Windows paths without a shell', async () => {
  assert.equal(desktopPlatform('darwin', 'Darwin'), 'mac')
  assert.equal(desktopPlatform('linux', '6.6.87.2-microsoft-standard-WSL2'), 'wsl')
  assert.equal(desktopPlatform('linux', '6.14.0'), 'linux')
  const mac = await desktopHostSpec({ platform: 'mac', env: { MEW_DESKTOP_HELPER_DIR: '/opt/Mew helper' } })
  assert.equal(mac.executable, '/opt/Mew helper/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const calls: unknown[] = []
  const wsl = await desktopHostSpec({ platform: 'wsl', env: { MEW_DESKTOP_HELPER_DIR: 'C:\\Users\\Test User\\Mew' }, run: (async (file: string, args: string[]) => { calls.push([file, args]); return { stdout: '/mnt/c/Users/Test User/Mew/node_modules/electron/dist/electron.exe\n', stderr: '' } }) as never })
  assert.equal(wsl.entry, 'C:\\Users\\Test User\\Mew\\main.mjs')
  assert.equal(wsl.executable, '/mnt/c/Users/Test User/Mew/node_modules/electron/dist/electron.exe')
  assert.deepEqual(calls, [['wslpath', ['-u', 'C:\\Users\\Test User\\Mew\\node_modules\\electron\\dist\\electron.exe']]])
  await assert.rejects(desktopHostSpec({ platform: 'wsl', env: { MEW_DESKTOP_HELPER_DIR: '/home/test/helper' } }), /Windows/)
  assert.deepEqual(desktopIceServers({}), [])
  assert.deepEqual(desktopIceServers({ MEW_DESKTOP_ICE_SERVERS: '[{"urls":"turn:relay.example.test:3478","username":"test","credential":"test-only"}]' })[0].urls, ['turn:relay.example.test:3478'])
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

test('server video and input keep the same authorization lease and cannot survive revocation', { timeout: 5000 }, async () => {
  const server = createServer(), fake = fakeHost()
  let auth = { ...owner }
  attachRemoteDesktopWebSocket(server, { getAuth: () => auth, heartbeatMs: 50, iceServers: () => [], spawnHost: async () => fake.host })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote-desktop/ws`, { origin })
  const binary: Buffer[] = []
  ws.on('message', (raw, isBinary) => {
    if (isBinary) { binary.push(Buffer.from(raw as Buffer)); ws.send('{"type":"frame-ack","seq":1}'); return }
    const message = JSON.parse(raw.toString())
    if (message.type === 'sources') ws.send('{"type":"select","id":"screen:0:0"}')
    if (message.type === 'offer') ws.send('{"type":"relay"}')
  })
  const until = async (condition: () => boolean) => { for (let i = 0; i < 100 && !condition(); i++) await delay(10); assert.ok(condition()) }
  try {
    await until(() => fake.messages.some(message => message.type === 'relay'))
    const frame = packFrame({ seq: 1, timestamp: 33_333, width: 1280, height: 720, key: true }, new Uint8Array([0, 255, 10, 128]))
    fake.host.stdout.emit('data', hostFrame(frame))
    await until(() => fake.messages.some(message => message.type === 'frame-ack'))
    assert.deepEqual(binary, [Buffer.from(frame)])
    ws.send(JSON.stringify({ type: 'relay-input', reliable: true, value: { type: 'input', v: 1, seq: 1, epoch: 1, x: 0, y: 0, wheelX: 0, wheelY: 0, buttons: 1, keys: [] } }))
    await until(() => fake.messages.some(message => message.type === 'relay-input'))
    const exited = once(fake.host, 'exit')
    auth = { ...owner, role: 'member' }
    await once(ws, 'close'); await exited
    assert.ok(fake.messages.some(message => message.type === 'stop'))
    fake.host.stdout.emit('data', hostFrame(frame))
    assert.equal(binary.length, 1)
  } finally { ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
