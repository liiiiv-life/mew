import express from 'express'
import type { Server, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import { WebSocket, WebSocketServer } from 'ws'
import { requireRole, resolveAuth, type RequestAuth } from './reqAuth.ts'
import { desktopHostStatus, desktopIceServers, spawnDesktopHost, DesktopHostLaunchError, type DesktopHostProcess } from './remote-desktop-host.ts'
import { createDesktopInstaller } from './remote-desktop-install.ts'
import type { TmuxManager } from '../packages/tmux-term/src/server/tmux.ts'
import { hostReader } from '../native/remote-desktop/host-wire.mjs'
import { MAX_FRAME_BYTES } from '../native/remote-desktop/relay-protocol.mjs'
import { desktopRelay } from './desktop-relay.ts'

export const DESKTOP_WS = '/api/remote-desktop/ws'
const MAX_BYTES = 128 * 1024
type Host = DesktopHostProcess

export function desktopConnectionAllowed(req: IncomingMessage, auth: RequestAuth): boolean {
  if (!auth.email || auth.mustChangePassword || !['owner', 'manager'].includes(auth.role)) return false
  try {
    const origin = new URL(req.headers.origin ?? '')
    const secure = (req.socket as { encrypted?: boolean }).encrypted || req.headers['x-forwarded-proto'] === 'https'
    return origin.host === req.headers.host && origin.protocol === (secure ? 'https:' : 'http:')
  } catch { return false }
}

export function validDesktopSignal(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (message.type === 'select') return typeof message.id === 'string' && message.id.length > 0 && message.id.length < 256
  if (message.type === 'answer') return typeof message.sdp === 'string' && message.sdp.startsWith('v=0') && message.sdp.length <= MAX_BYTES - 1024
  if (message.type === 'candidate') {
    const candidate = message.candidate as Record<string, unknown> | undefined
    return !!candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 4096
      && (candidate.sdpMid == null || typeof candidate.sdpMid === 'string' && candidate.sdpMid.length < 128)
      && (candidate.sdpMLineIndex == null || Number.isInteger(candidate.sdpMLineIndex) && Number(candidate.sdpMLineIndex) >= 0 && Number(candidate.sdpMLineIndex) < 32)
  }
  return false
}

export function createRemoteDesktopRoutes(tmux: Pick<TmuxManager, 'list' | 'startCommand' | 'kill'>, installer = createDesktopInstaller(tmux)) {
  const router = express.Router()
  router.use(requireRole('owner', 'manager'))
  router.get('/status', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await desktopHostStatus()) })
  router.get('/install', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await installer.status()) })
  router.post('/install', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try { res.json(await installer.start()) }
    catch { res.status(500).json({ error: '설치 터미널을 열지 못했습니다. 서버의 tmux 설치와 mew 경로의 접근 권한을 확인해 주세요.' }) }
  })
  return router
}

/** Authenticated signaling leases the physical desktop; media cannot outlive that lease. */
export function attachRemoteDesktopWebSocket(server: Server | Http2SecureServer, { getAuth = resolveAuth, spawnHost = spawnDesktopHost, iceServers = desktopIceServers, heartbeatMs = 3000 }: {
  getAuth?: typeof resolveAuth; spawnHost?: () => Promise<Host>; iceServers?: typeof desktopIceServers; heartbeatMs?: number
} = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false })
  let active: WebSocket | null = null
  let retiring: Promise<void> | null = null
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '', 'http://localhost').pathname !== DESKTOP_WS) return
    if (!desktopConnectionAllowed(req, getAuth(req))) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    wss.handleUpgrade(req, socket, head, async (ws) => {
      // A screen switch may arrive while the old helper is releasing the desktop.
      if (active?.readyState === WebSocket.CLOSING) await new Promise<void>(resolve => {
        const previous = active!, timeout = setTimeout(() => { previous.off('close', done); resolve() }, 1500)
        const done = () => { clearTimeout(timeout); resolve() }
        previous.once('close', done)
      })
      if (retiring) await retiring
      if (ws.readyState !== WebSocket.OPEN) return
      if (!desktopConnectionAllowed(req, getAuth(req))) { ws.close(1008); return }
      if (active) { ws.send(JSON.stringify({ type: 'error', message: '다른 원격 데스크톱 연결이 사용 중입니다. 기존 연결을 닫은 뒤 다시 시도해 주세요.' })); ws.close(1013); return }
      active = ws
      const account = getAuth(req).email
      let child: Host | undefined, hostExited = false, disposed = false, alive = true, selected = false, answered = false, hasOffer = false, screens = new Set<string>(), signalCount = 0
      const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_FRAME_BYTES * 2) ws.send(JSON.stringify(value)); else ws.close() }
      const write = (value: unknown) => {
        if (!child || child.stdin.destroyed) return
        if (child.stdin.writableLength > MAX_BYTES * 2) { ws.close(); return }
        child.stdin.write(`${JSON.stringify(value)}\n`)
      }
      const relay = desktopRelay(ws, write)
      const dispose = () => {
        if (disposed) return
        disposed = true; clearInterval(heartbeat); clearTimeout(startDeadline)
        if (child && !hostExited) {
          let retired!: () => void
          retiring = new Promise<void>(resolve => { retired = resolve })
          write({ type: 'stop' }); child.stdin.end()
          const kill = setTimeout(() => child?.kill('SIGTERM'), 1500); kill.unref()
          const force = setTimeout(() => { child?.kill('SIGKILL'); retired(); retiring = null }, 2500); force.unref()
          child.once('exit', () => { clearTimeout(kill); clearTimeout(force); if (active === ws) active = null; retired(); retiring = null })
        } else if (active === ws) active = null
      }
      const fail = (message: string) => { send({ type: 'error', message }); ws.close(1011); dispose() }
      const startDeadline = setTimeout(() => fail('화면 공유를 시작하지 못했습니다. 서버에서 화면 공유 권한을 확인한 뒤 다시 연결해 주세요.'), 90_000)
      startDeadline.unref()
      ws.on('pong', () => { alive = true })
      const heartbeat = setInterval(() => {
        const auth = getAuth(req)
        if (!alive || auth.email !== account || !desktopConnectionAllowed(req, auth)) { ws.terminate(); dispose(); return }
        alive = false; signalCount = 0; ws.ping(); write({ type: 'lease' })
      }, heartbeatMs)
      heartbeat.unref()
      ws.once('close', dispose)
      ws.on('error', dispose)
      ws.on('message', (raw, binary) => {
        if (disposed || binary) { ws.close(1008); return }
        try {
          const message = JSON.parse(raw.toString())
          if (['relay-input', 'frame-ack'].includes(message?.type)) { relay.accept(message); return }
          if (++signalCount > 128) { ws.close(1008); return }
          if (message?.type === 'relay' && selected) { relay.start(); return }
          if (!validDesktopSignal(message)) { ws.close(1008); return }
          // Candidates/answers already in flight when switching cannot revive the old peer.
          if (relay.active && ['candidate', 'answer'].includes(message.type)) return
          if (message.type === 'select') {
            if (selected || !screens.has(message.id)) { ws.close(1008); return }
            selected = true
          } else if (!selected || message.type === 'answer' && (answered || !hasOffer)) { ws.close(1008); return }
          if (message.type === 'answer') answered = true
          write(message)
        } catch { ws.close(1008) }
      })
      void (async () => {
        const config = iceServers()
        send({ type: 'config', iceServers: config })
        child = await spawnHost()
        if (child.desktopNetworkHint) send({ type: 'network-hint', message: child.desktopNetworkHint })
        child.stdin.on('error', () => { if (!disposed) fail('원격 데스크톱 보조 앱이 종료됐습니다.') })
        child.once('error', () => { hostExited = true; if (active === ws) active = null; if (!disposed) fail('원격 데스크톱 보조 앱을 실행하지 못했습니다. 설치와 서버 데스크톱 세션을 확인해 주세요.') })
        child.once('exit', () => { hostExited = true; if (!disposed) fail('원격 데스크톱 연결이 종료됐습니다.'); if (active === ws) active = null })
        if (disposed) { child.stdin.end('{"type":"stop"}\n'); child.kill('SIGTERM'); return }
        const read = hostReader(message => {
          if (disposed) return
          if (message.type === 'sources' && Array.isArray(message.screens)) screens = new Set(message.screens.map((screen: { id: string }) => screen.id))
          if (message.type === 'offer') hasOffer = true
          if (['connected', 'relay-ready'].includes(message.type)) clearTimeout(startDeadline)
          if (message.type === 'error') { fail(typeof message.message === 'string' ? message.message : '화면 공유에 실패했습니다.'); return }
          if (relay.active && ['offer', 'candidate', 'connected', 'direct-failed'].includes(message.type)) return
          if (['sources', 'offer', 'candidate', 'connected', 'direct-failed', 'relay-ready'].includes(message.type)) send(message)
        }, packet => { if (!disposed) relay.frame(packet) })
        child.stdout.on('data', (chunk: Buffer) => { try { read(chunk) } catch { fail('서버 영상 전송에 실패했습니다. 네트워크를 확인한 뒤 다시 연결해 주세요.') } })
        write({ type: 'init', iceServers: config })
      })().catch(error => fail(error instanceof DesktopHostLaunchError ? error.message : '원격 데스크톱 보조 앱과 ICE 설정을 확인해 주세요.'))
    })
  })
  server.once('close', () => { active?.terminate(); wss.close() })
}
