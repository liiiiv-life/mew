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
  attachRemoteDesktopWebSocket(server, { getAuth: () => auth, heartbeatMs: 50, iceServers: () => [], spawnHost: async () => { const fake = fakeHost(); hosts.push(fake); return fake.host } })
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
    await once(ws, 'open'); ws.send('{"type":"select","id":"not-a-screen"}')
    const [code] = await once(ws, 'close'); assert.equal(code, 1008)
    assert.equal(fake.messages.some(message => message.type === 'select'), false)
    assert.ok(fake.messages.some(message => message.type === 'stop'))
  } finally { ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
