import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import type { IncomingMessage, Server } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import { chromium } from 'playwright-core'
import { canUse } from './access-policy.ts'
import { watchSocketAccess } from './access-socket.ts'
import { authOf, requireFeature, resolveAuth, type RequestAuth } from './reqAuth.ts'
import { DATA_DIR } from './dataDir.ts'
import type { Feature } from '../shared/access-policy.ts'
import { LOGIN_DESKTOP_LIMITS, LOGIN_DESKTOP_WS, loginDesktopSize, parseLoginDesktopInput, type LoginDesktopInput, type LoginDesktopPage, type LoginDesktopState } from '../shared/login-desktop.ts'

export { LOGIN_DESKTOP_WS } from '../shared/login-desktop.ts'
const sessions = new Map<string, LoginDesktopSession>()
const owned = new Set<ChildProcess>()
const TTL = 20 * 60_000
const DISCONNECT_GRACE = 60_000
process.once('exit', () => { for (const child of owned) signalChild(child, 'SIGTERM') })

function signalChild(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch { /* Already exited. */ } }
}

function childProcess(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  owned.add(child)
  child.once('error', () => { owned.delete(child) })
  child.once('exit', () => { owned.delete(child) })
  child.stderr!.resume()
  return child
}

async function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return true
  return new Promise(resolve => {
    const finish = (exited: boolean) => { clearTimeout(timer); child.off('exit', exit); resolve(exited) }
    const exit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeout)
    child.once('exit', exit)
  })
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child) return
  signalChild(child, 'SIGTERM')
  if (!await waitForExit(child, 1500)) { signalChild(child, 'SIGKILL'); await waitForExit(child, 1500) }
  child.stdin?.destroy(); child.stdout?.destroy()
}

function executable(file: string): boolean {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile() } catch { return false }
}

/** Use a regular installed Chrome first; Playwright supplies only the fallback executable path. */
export function loginDesktopExecutable(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MEW_BROWSER_EXECUTABLE) {
    if (!path.isAbsolute(env.MEW_BROWSER_EXECUTABLE) || !executable(env.MEW_BROWSER_EXECUTABLE)) throw new Error('MEW_BROWSER_EXECUTABLE에 실행 가능한 Chrome 파일의 절대 경로를 지정해 주세요.')
    return env.MEW_BROWSER_EXECUTABLE
  }
  const found = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', chromium.executablePath()].find(executable)
  if (!found) throw new Error('호스트 Chrome이 없습니다. Chrome 또는 Chromium을 설치해 주세요.')
  return found
}

export function loginDesktopUrlAllowed(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 8192) return false
  try {
    const url = new URL(raw)
    return !url.username && !url.password && !url.port && url.protocol === 'https:' && ['accounts.google.com', 'antigravity.google', 'claude.ai', 'console.anthropic.com', 'platform.claude.com', 'auth.openai.com', 'platform.openai.com', 'chatgpt.com', 'kimi.com', 'www.kimi.com', 'kimi.ai', 'www.kimi.ai', 'cursor.com', 'www.cursor.com', 'authenticator.cursor.sh', 'github.com'].includes(url.hostname)
  } catch { return false }
}

function validAuthUrl(raw: string) {
  if (raw.length > 8192) return false
  try {
    const url = new URL(raw)
    return !url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch { return false }
}

function sessionAllowed(auth: RequestAuth, account: string, features: readonly Feature[]) {
  return !auth.mustChangePassword && auth.email === account && features.some(feature => canUse(auth, feature))
}

export function loginDesktopConnectionAllowed(req: IncomingMessage, auth: RequestAuth, account: string, features: readonly Feature[] = ['agent']) {
  if (!sessionAllowed(auth, account, features)) return false
  try {
    const origin = new URL(req.headers.origin ?? '')
    const secure = (req.socket as { encrypted?: boolean } | undefined)?.encrypted || req.headers['x-forwarded-proto'] === 'https'
    return origin.host === req.headers.host && origin.protocol === (secure ? 'https:' : 'http:')
  } catch { return false }
}

/** Incremental image2pipe parser with a strict memory ceiling. Frames are never persisted. */
export class LoginJpegFrames {
  private pending = Buffer.alloc(0)
  push(chunk: Buffer, emit: (frame: Buffer) => void) {
    if (this.pending.length + chunk.length > LOGIN_DESKTOP_LIMITS.frameBytes * 2) throw new Error('로그인 화면의 영상 크기가 한도를 넘었습니다.')
    this.pending = Buffer.concat([this.pending, chunk])
    for (;;) {
      const start = this.pending.indexOf(Buffer.from([0xff, 0xd8]))
      if (start < 0) { this.pending = this.pending.subarray(-1); return }
      if (start) this.pending = this.pending.subarray(start)
      const end = this.pending.indexOf(Buffer.from([0xff, 0xd9]), 2)
      if (end < 0) { if (this.pending.length > LOGIN_DESKTOP_LIMITS.frameBytes) throw new Error('로그인 화면의 영상 크기가 한도를 넘었습니다.'); return }
      if (end + 2 > LOGIN_DESKTOP_LIMITS.frameBytes) throw new Error('로그인 화면의 영상 크기가 한도를 넘었습니다.')
      emit(this.pending.subarray(0, end + 2))
      this.pending = this.pending.subarray(end + 2)
    }
  }
}

export class LoginDesktopSession {
  readonly id = crypto.randomBytes(24).toString('base64url')
  readonly expiresAt = Date.now() + TTL
  readonly account: string
  readonly job: string
  readonly url: string
  readonly features: readonly Feature[]
  private socket?: WebSocket
  private authorized?: () => boolean
  private width = 0
  private height = 0
  private timer: ReturnType<typeof setTimeout>
  private disconnected?: ReturnType<typeof setTimeout>
  private starting?: Promise<void>
  private resizing?: Promise<void>
  private requestedSize?: { width: number; height: number }
  private environment?: NodeJS.ProcessEnv
  private closing?: Promise<void>
  private closed = false
  private directory?: string
  private display?: ChildProcess
  private browser?: ChildProcess
  private input?: ChildProcess
  private capture?: ChildProcess
  private frame?: Buffer
  private sentFrame?: Buffer
  private awaitingFrame = false
  private frameDeadline?: ReturnType<typeof setTimeout>
  private announcedWidth = 0
  private announcedHeight = 0
  private ready = false
  private inputCount = 0
  private inputAt = 0

  constructor(account: string, job: string, url: string, features: readonly Feature[] = ['agent']) {
    this.account = account; this.job = job; this.url = url; this.features = features
    this.timer = setTimeout(() => { void this.close() }, TTL); this.timer.unref()
  }

  get isClosed() { return this.closed }
  info(): LoginDesktopPage { return { id: this.id, job: this.job, url: this.url, streamUrl: `${LOGIN_DESKTOP_WS}?session=${this.id}` } }
  private send(state: LoginDesktopState) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(state)) }
  private fail(message: string) { if (this.closed) return; this.send({ type: 'error', message }); void this.close() }
  private command(value: LoginDesktopInput | { type: 'shutdown' }) {
    const stream = this.input?.stdin
    if (!stream || stream.destroyed || stream.writableLength > 64 * 1024) return
    stream.write(JSON.stringify(value) + '\n')
  }

  private sendFrame() {
    const socket = this.socket
    if (!this.ready || !this.frame || this.frame === this.sentFrame || this.awaitingFrame || socket?.readyState !== WebSocket.OPEN) return
    if (!this.authorized?.()) { void this.close(); return }
    if (socket.bufferedAmount >= LOGIN_DESKTOP_LIMITS.frameBytes) return
    if (this.announcedWidth !== this.width || this.announcedHeight !== this.height) {
      this.send({ type: 'ready', width: this.width, height: this.height })
      this.announcedWidth = this.width; this.announcedHeight = this.height
    }
    this.awaitingFrame = true; this.sentFrame = this.frame
    socket.send(this.frame, { binary: true })
    this.frameDeadline = setTimeout(() => { if (this.socket === socket && this.awaitingFrame) socket.close(1013, 'Login frame acknowledgement timed out') }, 5000)
    this.frameDeadline.unref()
  }

  attach(socket: WebSocket, authorized: () => boolean) {
    if (this.closed) { socket.close(1008); return }
    clearTimeout(this.disconnected)
    const previous = this.socket
    this.socket = socket
    this.authorized = authorized
    clearTimeout(this.frameDeadline); this.awaitingFrame = false; this.sentFrame = undefined; this.announcedWidth = 0; this.announcedHeight = 0
    this.command({ type: 'release' })
    if (previous && previous !== socket) previous.close(1012, 'Login viewer replaced')
    this.sendFrame()
    socket.on('message', (raw, binary) => {
      if (this.socket !== socket || this.closed) return
      if (!authorized()) { socket.terminate(); void this.close(); return }
      try {
        if (binary) throw new Error('invalid-input')
        const input = parseLoginDesktopInput(JSON.parse(raw.toString()))
        const now = Date.now()
        if (now - this.inputAt >= 1000) { this.inputAt = now; this.inputCount = 0 }
        if (++this.inputCount > 500) throw new Error('input-limit')
        if (input.type === 'frame-ack') { clearTimeout(this.frameDeadline); this.awaitingFrame = false; this.sendFrame(); return }
        if (input.type === 'close') { void this.close(); return }
        if (input.type === 'resize') {
          if (!this.starting) {
            const size = loginDesktopSize(input.width, input.height)
            this.width = size.width; this.height = size.height
            this.starting = this.launch().then(() => { if (this.requestedSize) this.resize() }).catch(() => { this.fail('로그인 화면을 시작하지 못했습니다. Linux/WSL의 Chrome·Xvfb·ffmpeg·Python3·libXtst 설치를 확인해 주세요.') })
          } else { this.requestedSize = loginDesktopSize(input.width, input.height); this.resize() }
        } else if (this.ready) this.command(input)
      } catch { socket.close(1008, 'Invalid login input'); void this.close() }
    })
    socket.once('close', () => {
      if (this.socket !== socket || this.closed) return
      this.socket = undefined; clearTimeout(this.frameDeadline); this.awaitingFrame = false; this.command({ type: 'release' })
      if (!authorized()) { void this.close(); return }
      this.disconnected = setTimeout(() => { void this.close() }, DISCONNECT_GRACE); this.disconnected.unref()
    })
    socket.on('error', () => {})
  }

  private resize() {
    if (this.resizing || this.closed) return
    this.resizing = (async () => {
      await this.starting
      while (this.requestedSize && !this.closed) {
        const size = this.requestedSize; this.requestedSize = undefined
        if (size.width === this.width && size.height === this.height) continue
        this.ready = false; this.frame = undefined; this.command({ type: 'release' })
        const previous = this.capture; this.capture = undefined
        await stopChild(previous)
        if (this.closed) return
        this.width = size.width; this.height = size.height
        const input = this.input!
        await new Promise<void>((resolve, reject) => {
          let output = ''
          const timer = setTimeout(() => finish(new Error('resize-timeout')), 3000)
          const receive = (data: Buffer) => { output += data.toString(); if (output.includes('"resized"')) finish(); else if (output.length > 1024) finish(new Error('resize-output')) }
          const failed = () => finish(new Error('input-ended'))
          function finish(error?: Error) { clearTimeout(timer); input.stdout!.off('data', receive); input.off('exit', failed); if (error) reject(error); else resolve() }
          input.stdout!.on('data', receive); input.once('exit', failed)
          this.command({ type: 'resize', ...size })
        })
        if (!this.closed) await this.startCapture()
      }
    })().catch(() => { this.fail('로그인 화면 크기를 변경하지 못했습니다. 화면을 닫고 다시 열어 주세요.') }).finally(() => { this.resizing = undefined; if (this.requestedSize && !this.closed) this.resize() })
  }

  private async launch() {
    if (process.platform !== 'linux') throw new Error('로그인 가상 화면은 현재 Linux/WSL에서 지원합니다.')
    const chrome = loginDesktopExecutable()
    this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-login-desktop-'))
    const authority = path.join(this.directory, 'authority')
    const field = (value: Buffer) => { const length = Buffer.alloc(2); length.writeUInt16BE(value.length); return Buffer.concat([length, value]) }
    fs.writeFileSync(authority, Buffer.concat([Buffer.from([0xff, 0xff]), field(Buffer.alloc(0)), field(Buffer.alloc(0)), field(Buffer.from('MIT-MAGIC-COOKIE-1')), field(crypto.randomBytes(16))]), { mode: 0o600 })
    const runtime = path.join(this.directory, 'runtime'); fs.mkdirSync(runtime, { mode: 0o700 })
    const baseEnv = { ...process.env, XAUTHORITY: authority, XDG_RUNTIME_DIR: runtime, XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: undefined, DBUS_SESSION_BUS_ADDRESS: 'disabled:', GTK_USE_PORTAL: '0', NODE_OPTIONS: undefined }
    // displayfd is the only browser-independent output retained; stderr is drained.
    // Xvfb cannot change its framebuffer mode. Resize native windows and the capture crop instead.
    this.display = spawn('Xvfb', [`:${crypto.randomInt(10000, 60000)}`, '-displayfd', '3', '-screen', '0', `${LOGIN_DESKTOP_LIMITS.maxWidth}x${LOGIN_DESKTOP_LIMITS.maxHeight}x24`, '-nolisten', 'tcp', '-nolisten', 'unix', '-auth', authority], { detached: true, env: baseEnv, stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
    const display = this.display
    owned.add(display); display.once('exit', () => owned.delete(display)); display.once('error', () => owned.delete(display))
    const name = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => finish(new Error('display-timeout')), 10_000)
      const receive = (value: Buffer) => { output += value.toString(); if (/^\d+\n$/.test(output)) finish(undefined, ':' + output.trim()); else if (output.length > 32) finish(new Error('display-output')) }
      const failed = () => finish(new Error('display-start'))
      function finish(error?: Error, value?: string) { clearTimeout(timer); display.off('error', failed); display.off('exit', failed); display.stdio[3]?.off('data', receive); if (error) reject(error); else resolve(value!) }
      display.once('error', failed); display.once('exit', failed); display.stdio[3]?.on('data', receive)
    })
    if (this.closed) return
    const env = { ...baseEnv, DISPLAY: name }
    this.environment = env
    this.input = childProcess('python3', ['-u', fileURLToPath(new URL('./login-desktop-x11.py', import.meta.url)), String(this.width), String(this.height)], env)
    const input = this.input
    input.stdin!.on('error', () => { if (!this.closed) this.fail('로그인 화면의 입력 연결이 종료됐습니다.') })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('input-timeout')), 10_000)
      const receive = (value: Buffer) => { if (value.toString().includes('"ready"')) finish() }
      const failed = () => finish(new Error('input-start'))
      function finish(error?: Error) { clearTimeout(timer); input.off('error', failed); input.off('exit', failed); input.stdout!.off('data', receive); if (error) reject(error); else resolve() }
      input.once('error', failed); input.once('exit', failed); input.stdout!.on('data', receive)
    })
    input.stdout!.resume()
    if (this.closed) return
    const profile = path.join(DATA_DIR, 'browser', 'profiles', crypto.createHash('sha256').update(this.account).digest('hex'))
    fs.mkdirSync(profile, { recursive: true, mode: 0o700 })
    this.browser = childProcess(chrome, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--ozone-platform=x11', '--new-window', '--start-fullscreen', `--window-size=${this.width},${this.height}`, '--window-position=0,0', this.url], env)
    this.browser.stdout!.resume()
    this.browser.once('error', () => { this.fail('호스트 Chrome을 실행하지 못했습니다.') })
    this.browser.once('exit', () => { if (!this.closed) void this.close() })
    input.once('exit', () => { if (!this.closed) this.fail('로그인 화면의 입력 처리가 종료됐습니다.') })
    display.once('exit', () => { if (!this.closed) this.fail('로그인 가상 화면이 종료됐습니다.') })
    await this.startCapture()
  }

  private async startCapture() {
    const env = this.environment!
    this.capture = childProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'x11grab', '-framerate', String(LOGIN_DESKTOP_LIMITS.fps), '-video_size', `${this.width}x${this.height}`, '-i', `${env.DISPLAY}+0,0`, '-an', '-c:v', 'mjpeg', '-threads:v', '1', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'], env)
    const capture = this.capture, frames = new LoginJpegFrames()
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('capture-timeout')) } }, 15_000)
      const failure = () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('capture-start')) } else if (!this.closed && this.capture === capture) this.fail('로그인 영상 전송이 종료됐습니다.') }
      capture.once('error', failure); capture.once('exit', failure)
      capture.stdout!.on('data', (chunk: Buffer) => {
        if (this.closed || this.capture !== capture) return
        try {
          frames.push(chunk, frame => {
            if (this.socket && !this.authorized?.()) { void this.close(); return }
            this.frame = frame
            this.ready = true
            this.sendFrame()
            if (!settled) { settled = true; clearTimeout(timer); resolve() }
          })
        } catch { failure(); this.fail('로그인 화면의 영상 크기가 한도를 넘었습니다.') }
      })
    })
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true; clearTimeout(this.timer); clearTimeout(this.disconnected); clearTimeout(this.frameDeadline)
    this.send({ type: 'closed' }); this.socket?.close(1000); this.socket = undefined
    this.closing = (async () => {
      // An unfinished display/input/capture wait must be interrupted before awaiting launch.
      if (!this.ready) await Promise.all([stopChild(this.capture), stopChild(this.input), stopChild(this.display)])
      await this.starting?.catch(() => {})
      await this.resizing?.catch(() => {})
      await stopChild(this.capture)
      this.command({ type: 'shutdown' })
      if (this.browser && !await waitForExit(this.browser, 1500)) await stopChild(this.browser)
      await stopChild(this.input); await stopChild(this.display)
      if (this.directory) fs.rmSync(this.directory, { recursive: true, force: true })
      this.frame = undefined
      if (sessions.get(this.id) === this) sessions.delete(this.id)
    })()
    return this.closing
  }
}

export async function createLoginDesktopAuthSession(account: string, job: string, url: string, features: readonly Feature[] = ['agent']): Promise<string> {
  if (!account || !job || !validAuthUrl(url) || !features.length) throw new Error('로그인 작업 정보가 올바르지 않습니다.')
  if (process.platform !== 'linux') throw new Error('독립 로그인 화면은 현재 Linux/WSL에서 지원합니다. 이 운영체제의 가상 화면 지원은 아직 준비되지 않았습니다.')
  const existing = [...sessions.values()].find(session => session.account === account && session.job === job)
  if (existing?.url === url && !existing.isClosed && Date.now() < existing.expiresAt) return existing.info().streamUrl
  if (existing) await existing.close()
  if ([...sessions.values()].some(session => session.account === account)) throw new Error('다른 로그인 화면이 열려 있습니다. 해당 화면을 닫은 뒤 다시 시도해 주세요.')
  const session = new LoginDesktopSession(account, job, url, features)
  sessions.set(session.id, session)
  return session.info().streamUrl
}

export async function closeLoginDesktopJob(account: string, job: string) { await Promise.all([...sessions.values()].filter(session => session.account === account && session.job === job).map(session => session.close())) }
export async function closeLoginDesktops() { await Promise.all([...sessions.values()].map(session => session.close())) }

export function createLoginDesktopRoutes() {
  const app = express()
  app.post('/', requireFeature('agent'), async (req, res) => {
    try {
      const account = authOf(req).email ?? '', url = req.body?.url
      if (!loginDesktopUrlAllowed(url)) { res.status(400).json({ error: '등록된 로그인·계정 관리 주소만 열 수 있습니다.' }); return }
      const existing = [...sessions.values()].find(session => session.account === account && session.url === url)
      if (existing && !existing.isClosed && Date.now() < existing.expiresAt) { res.json(existing.info()); return }
      if (existing) await existing.close()
      const stream = await createLoginDesktopAuthSession(account, crypto.randomUUID(), url)
      const session = sessions.get(new URL(stream, 'http://localhost').searchParams.get('session')!)!
      res.json(session.info())
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '로그인 화면을 준비하지 못했습니다.' }) }
  })
  app.delete('/:id', async (req, res) => {
    const session = sessions.get(String(req.params.id))
    if (session && !sessionAllowed(authOf(req), session.account, session.features)) { res.sendStatus(403); return }
    await session?.close(); res.json({ ok: true })
  })
  return app
}

export function attachLoginDesktopWebSocket(server: Server | Http2SecureServer, getAuth = resolveAuth) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== LOGIN_DESKTOP_WS) return
    const session = sessions.get(url.searchParams.get('session') ?? '')
    const allowed = () => !!session && Date.now() < session.expiresAt && loginDesktopConnectionAllowed(req, getAuth(req), session.account, session.features)
    if (!session || !allowed()) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    wss.handleUpgrade(req, socket, head, ws => {
      watchSocketAccess(ws, req, allowed)
      let alive = true
      ws.on('pong', () => { alive = true })
      const heartbeat = setInterval(() => { if (!alive || !allowed()) { ws.terminate(); void session.close(); return }; alive = false; ws.ping() }, 5000)
      heartbeat.unref(); ws.once('close', () => clearInterval(heartbeat))
      session.attach(ws, allowed)
    })
  })
  server.once('close', () => { wss.close(); void closeLoginDesktops() })
}
