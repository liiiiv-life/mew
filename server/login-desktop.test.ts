import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { EventEmitter, once } from 'node:events'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { loginDesktopSize, parseLoginDesktopInput } from '../shared/login-desktop.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-login-test-'))
process.env.MEW_DATA_DIR = root
const { LoginDesktopSession, LoginJpegFrames, attachLoginDesktopWebSocket, closeLoginDesktopJob, closeLoginDesktops, createLoginDesktopAuthSession, loginDesktopConnectionAllowed, loginDesktopExecutable, loginDesktopUrlAllowed } = await import('./login-desktop.ts')
test.after(async () => { await closeLoginDesktops(); await fs.rm(root, { recursive: true, force: true }) })

test('login video URLs, dimensions and input preserve the restricted surface', () => {
  assert.equal(loginDesktopUrlAllowed('https://accounts.google.com/o/oauth2/auth?fixture=1'), true)
  for (const url of ['https://accounts.google.com.evil.test', 'http://localhost:3333/', 'https://example.test/', 'https://user:password@accounts.google.com/', 'https://accounts.google.com:444/']) assert.equal(loginDesktopUrlAllowed(url), false)
  assert.deepEqual(loginDesktopSize(99999, -1), { width: 3840, height: 240 })
  assert.deepEqual(loginDesktopSize(901, 701), { width: 900, height: 700 })
  assert.throws(() => parseLoginDesktopInput({ type: 'key', code: 'eval()', key: 'a', down: true }))
  assert.throws(() => parseLoginDesktopInput({ type: 'paste', text: 'a'.repeat(4097) }))
  assert.throws(() => parseLoginDesktopInput({ type: 'pointer', x: Infinity, y: 0 }))
  const req = { headers: { host: 'mew.test', origin: 'https://mew.test', 'x-forwarded-proto': 'https' } } as never
  assert.equal(loginDesktopConnectionAllowed(req, { email: 'a@test', role: 'owner', mustChangePassword: false }, 'a@test'), true)
  assert.equal(loginDesktopConnectionAllowed(req, { email: 'b@test', role: 'owner', mustChangePassword: false }, 'a@test'), false)
  assert.equal(loginDesktopConnectionAllowed(req, { email: 'a@test', role: 'member', mustChangePassword: false }, 'a@test'), false)
  assert.equal(loginDesktopConnectionAllowed(req, { email: 'a@test', role: 'member', mustChangePassword: false }, 'a@test', ['git', 'filesWrite']), true)
  assert.equal(loginDesktopConnectionAllowed(req, { email: 'a@test', role: 'owner', mustChangePassword: true }, 'a@test'), false)
  assert.equal(loginDesktopConnectionAllowed({ headers: { host: 'mew.test', origin: 'https://evil.test' } } as never, { email: 'a@test', role: 'owner', mustChangePassword: false }, 'a@test'), false)
})

test('JPEG parser accepts split boundaries and rejects oversized frames', () => {
  const parser = new LoginJpegFrames(), result: Buffer[] = []
  parser.push(Buffer.from([1, 0xff]), frame => result.push(frame))
  parser.push(Buffer.from([0xd8, 3, 4, 0xff]), frame => result.push(frame))
  parser.push(Buffer.from([0xd9, 0xff, 0xd8, 5, 0xff, 0xd9]), frame => result.push(frame))
  assert.deepEqual(result.map(frame => [...frame]), [[255, 216, 3, 4, 255, 217], [255, 216, 5, 255, 217]])
  assert.throws(() => parser.push(Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(2 * 1024 * 1024)]), () => {}), /한도/)
})

const dependencies = process.platform === 'linux' && ['Xvfb', 'ffmpeg', 'python3'].every(command => spawnSync(command, [command === 'ffmpeg' ? '-version' : command === 'Xvfb' ? '-help' : '--version'], { stdio: 'ignore' }).status === 0)
let chrome: string | undefined
try { chrome = loginDesktopExecutable() } catch { /* No browser fixture available. */ }

async function until(predicate: () => boolean, label: string, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (predicate()) return; await delay(30) }
  assert.fail(label)
}

test('private Xvfb sends real JPEG, accepts OS input and popup clipboard, and closes every owned process', { skip: !dependencies || !chrome, timeout: 45_000 }, async () => {
  const events: Array<{ kind: string; text?: string; width?: number; height?: number; webdriver?: boolean; document?: string }> = []
  let allowed = true
  const page = (popup: boolean) => `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:white}button,input{position:absolute;left:40px;width:220px;height:50px}#click{top:40px}#text{top:120px}#popup{top:200px}</style><button id="click" onclick="fetch('/event?kind=${popup ? 'popup-click' : 'click'}')">Click</button><input id="text" oninput="fetch('/event?kind=text&text='+encodeURIComponent(this.value))"><button id="popup" onclick="window.open('/popup','','width=400,height=300')">Popup</button><script>document.cookie='fixture=retained;max-age=300';const fixtureDocument=crypto.randomUUID();function report(){fetch('/event?kind=${popup ? 'popup-loaded' : 'loaded'}&width='+innerWidth+'&height='+innerHeight+'&webdriver='+navigator.webdriver+'&document='+fixtureDocument)}addEventListener('resize',report);report()</script>`
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    if (url.pathname === '/event') { events.push({ kind: url.searchParams.get('kind')!, text: url.searchParams.get('text') ?? undefined, width: Number(url.searchParams.get('width')), height: Number(url.searchParams.get('height')), webdriver: url.searchParams.get('webdriver') === 'true', document: url.searchParams.get('document') ?? undefined }); res.end('ok'); return }
    res.setHeader('Content-Type', 'text/html'); res.end(page(url.pathname === '/popup'))
  })
  attachLoginDesktopWebSocket(server, () => ({ email: allowed ? 'fixture@test' : 'other@test', role: 'owner', mustChangePassword: false }))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`
  let ws: WebSocket | undefined
  try {
    const stream = await createLoginDesktopAuthSession('fixture@test', 'fixture-job', origin + '/fixture')
    assert.equal(await createLoginDesktopAuthSession('fixture@test', 'fixture-job', origin + '/fixture'), stream)
    await assert.rejects(createLoginDesktopAuthSession('fixture@test', 'second-job', origin + '/fixture'), /다른 로그인/)
    ws = new WebSocket(origin.replace('http:', 'ws:') + stream, { origin })
    let frames = 0, ready = false, sourceHeight = 700, sourceWidth = 900, acknowledge = false
    const sizes: Array<{ width: number; height: number }> = []
    const errors: string[] = []
    ws.on('message', (data, binary) => {
      if (binary) {
        const frame = Buffer.from(data as Buffer)
        assert.equal(frame.readUInt16BE(0), 0xffd8); assert.equal(frame.readUInt16BE(frame.length - 2), 0xffd9)
        let size: { width: number; height: number } | undefined
        for (let offset = 2; offset + 8 < frame.length;) {
          const marker = frame[offset + 1], length = frame.readUInt16BE(offset + 2)
          if ([0xc0, 0xc1, 0xc2].includes(marker)) { size = { width: frame.readUInt16BE(offset + 7), height: frame.readUInt16BE(offset + 5) }; break }
          if (length < 2) break
          offset += 2 + length
        }
        assert.equal(size?.height, sourceHeight, 'JPEG encoded dimensions match announced capture dimensions')
        assert.equal(size?.width, sourceWidth)
        frames++
        if (acknowledge) ws!.send(JSON.stringify({ type: 'frame-ack' }))
      }
      else { const state = JSON.parse(data.toString()); if (state.type === 'ready') { ready = true; sourceHeight = state.height; sourceWidth = state.width; sizes.push(state) }; if (state.type === 'error') errors.push(state.message) }
    })
    await once(ws, 'open')
    ws.send(JSON.stringify({ type: 'resize', width: 900, height: 700 }))
    await until(() => ready || errors.length > 0, 'video startup')
    assert.deepEqual(errors, [])
    await delay(350)
    assert.equal(frames, 1, 'slow consumers retain one in-flight frame while capture continues')
    acknowledge = true; ws.send(JSON.stringify({ type: 'frame-ack' }))
    await until(() => events.some(event => event.kind === 'loaded'), 'ordinary browser fixture load')
    assert.equal(events.find(event => event.kind === 'loaded')?.webdriver, false)
    await delay(350)
    const send = (input: unknown) => ws!.send(JSON.stringify(input))
    const click = (x: number, pageY: number, popup = false) => { const y = pageY + sourceHeight - (events.findLast(event => event.kind === (popup ? 'popup-loaded' : 'loaded'))?.height ?? sourceHeight); send({ type: 'button', button: 0, down: true, x, y }); send({ type: 'button', button: 0, down: false, x, y }) }
    click(100, 65)
    await until(() => events.some(event => event.kind === 'click'), 'OS click must reach actual Chrome')
    click(100, 145)
    send({ type: 'paste', text: '한글 fixture' })
    await until(() => events.some(event => event.kind === 'text' && event.text === '한글 fixture'), 'Unicode X11 clipboard paste')
    send({ type: 'key', key: 'a', code: 'KeyA', down: true }); send({ type: 'key', key: 'a', code: 'KeyA', down: false })
    await until(() => events.some(event => event.kind === 'text' && event.text === '한글 fixturea'), 'XTest keyboard')
    const document = events.find(event => event.kind === 'loaded')!.document
    send({ type: 'resize', width: 1200, height: 800 })
    await until(() => sizes.some(size => size.width === 1200 && size.height === 800), 'video capture dimensions must follow panel resize')
    await until(() => events.some(event => event.kind === 'loaded' && event.width! >= 1198), 'native Chrome viewport must follow panel resize')
    assert.equal(events.findLast(event => event.kind === 'loaded')!.document, document, 'resize preserves the same browser document')
    click(100, 145)
    send({ type: 'key', key: 'End', code: 'End', down: true }); send({ type: 'key', key: 'End', code: 'End', down: false })
    send({ type: 'key', key: 'b', code: 'KeyB', down: true }); send({ type: 'key', key: 'b', code: 'KeyB', down: false })
    await until(() => events.some(event => event.kind === 'text' && event.text === '한글 fixtureab'), 'resize preserves input and new coordinate mapping')
    send({ type: 'resize', width: 3840, height: 2160 })
    await until(() => sizes.some(size => size.width === 3840 && size.height === 2160), '4K frame within bounded JPEG output')
    send({ type: 'resize', width: 900, height: 700 })
    await until(() => sizes.length >= 4 && sizes.at(-1)!.width === 900, 'panel shrinks without restarting Chrome')
    await until(() => (events.findLast(event => event.kind === 'loaded')?.width ?? Infinity) <= 900, 'native window shrink')
    click(100, 225)
    await until(() => events.some(event => event.kind === 'popup-loaded'), 'native popup load')
    await delay(250)
    click(100, 65, true)
    await until(() => events.some(event => event.kind === 'popup-click'), 'OS click must focus popup')
    assert.ok(frames >= 2)
    ws.close(); await once(ws, 'close')
    ws = new WebSocket(origin.replace('http:', 'ws:') + stream, { origin })
    const reconnected = new Promise<{ type: string }>(resolve => { ws!.on('message', (data, binary) => { if (!binary) { const state = JSON.parse(data.toString()); if (state.type === 'ready') resolve(state) } }) })
    await once(ws, 'open')
    assert.equal((await reconnected).type, 'ready')
    allowed = false
    ws.send(JSON.stringify({ type: 'pointer', x: 1, y: 1 }))
    await once(ws, 'close')
    await closeLoginDesktopJob('fixture@test', 'fixture-job')
    const retry = new WebSocket(origin.replace('http:', 'ws:') + stream, { origin })
    retry.on('error', () => {})
    const rejected = await once(retry, 'unexpected-response')
    assert.equal(rejected[1].statusCode, 403)
    retry.terminate()
  } finally {
    ws?.terminate(); await closeLoginDesktops(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('closing during first resize cancels startup and returns the profile lease', { skip: !dependencies || !chrome, timeout: 20_000 }, async () => {
  const server = createServer((_req, res) => res.end('fixture'))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  attachLoginDesktopWebSocket(server, () => ({ email: 'cancel@test', role: 'owner', mustChangePassword: false }))
  const stream = await createLoginDesktopAuthSession('cancel@test', 'cancel-job', origin)
  const ws = new WebSocket(origin.replace('http:', 'ws:') + stream, { origin })
  try {
    await once(ws, 'open')
    ws.send(JSON.stringify({ type: 'resize', width: 640, height: 480 }))
    ws.send(JSON.stringify({ type: 'close' }))
    await once(ws, 'close')
    const started = Date.now()
    await closeLoginDesktopJob('cancel@test', 'cancel-job')
    assert.ok(Date.now() - started < 5000)
    await createLoginDesktopAuthSession('cancel@test', 'new-job', origin)
  } finally { ws.terminate(); await closeLoginDesktops(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('a session closed before it ever launches remains idempotent', async () => {
  const session = new LoginDesktopSession('fixture@test', 'idle', 'https://accounts.google.com/')
  await session.close(); await session.close()
})

test('frame ACK timeout permits reconnect and all owned processes exit before cleanup completes', { skip: !dependencies || !chrome, timeout: 20_000 }, async () => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><input value="fixture">') })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const session = new LoginDesktopSession('cleanup@test', 'cleanup', `http://127.0.0.1:${(server.address() as { port: number }).port}`)
  const emitter = new EventEmitter()
  const socket = Object.assign(emitter, { readyState: WebSocket.OPEN as number, bufferedAmount: 0, send() {}, close() { this.readyState = WebSocket.CLOSED; emitter.emit('close') } })
  try {
    session.attach(socket as unknown as WebSocket, () => true)
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'resize', width: 640, height: 480 })), false)
    const runtime = session as unknown as { ready: boolean; directory: string; browser: ChildProcess; capture: ChildProcess; input: ChildProcess; display: ChildProcess }
    await until(() => runtime.ready, 'fixture capture starts')
    const children = [runtime.browser, runtime.capture, runtime.input, runtime.display], directory = runtime.directory
    assert.ok(children.every(child => child.pid))
    await until(() => socket.readyState === WebSocket.CLOSED, 'a missing consumption ACK closes only the slow viewer', 6500)
    assert.equal(session.isClosed, false, 'the owned browser remains available during reconnect grace')
    const delivered: unknown[] = [], nextEmitter = new EventEmitter()
    const next = Object.assign(nextEmitter, { readyState: WebSocket.OPEN as number, bufferedAmount: 0, send(value: unknown) { delivered.push(value) }, close() { this.readyState = WebSocket.CLOSED; nextEmitter.emit('close') } })
    session.attach(next as unknown as WebSocket, () => true)
    assert.equal(JSON.parse(delivered[0] as string).type, 'ready')
    assert.ok(Buffer.isBuffer(delivered[1]), 'reconnect resets the stale ACK and sends the latest frame')
    await session.close()
    assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), 'all owned processes have acknowledged exit')
    await assert.rejects(fs.access(directory), { code: 'ENOENT' })
    assert.equal(session.isClosed, true)
  } finally { await session.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
