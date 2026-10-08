import { watchSocketAccess } from './access-socket.ts'
import { canUse } from './access-policy.ts'
import express from 'express'
import type { Server, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import { WebSocket, WebSocketServer } from 'ws'
import { requireFeature, resolveAuth, type RequestAuth } from './reqAuth.ts'
import { desktopHostStatus, desktopIceServers, desktopUdpPort, desktopAutoNat, desktopPlatform, spawnDesktopHost, DesktopHostLaunchError, type DesktopHostProcess } from './remote-desktop-host.ts'
import { residentDesktopHost } from './desktop-resident-host.ts'
import { createDesktopInstaller } from './remote-desktop-install.ts'
import type { TmuxManager } from '../packages/tmux-term/src/server/tmux.ts'
import { hostReader } from '../native/remote-desktop/host-wire.mjs'
import { validCursor } from '../native/remote-desktop/cursor-protocol.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { DEFAULT_VIDEO, videoSettings } from '../native/remote-desktop/video-settings.mjs'

export const DESKTOP_WS = '/api/remote-desktop/ws'
const MAX_BYTES = 128 * 1024
type Host = DesktopHostProcess
const prepareHosts = new Set<() => Promise<void>>()
let preparingHosts: Promise<void> | undefined

export function desktopConnectionAllowed(req: IncomingMessage, auth: RequestAuth): boolean {
  if (!auth.email || auth.mustChangePassword || !canUse(auth, 'desktop')) return false
  try {
    const origin = new URL(req.headers.origin ?? '')
    const secure = (req.socket as { encrypted?: boolean }).encrypted || req.headers['x-forwarded-proto'] === 'https'
    return origin.host === req.headers.host && origin.protocol === (secure ? 'https:' : 'http:')
  } catch { return false }
}

export function validDesktopSignal(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (message.negotiation !== undefined && (!Number.isInteger(message.negotiation) || Number(message.negotiation) < 0 || Number(message.negotiation) > 2)) return false
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
  router.use(requireFeature('desktop'))
  router.get('/status', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await desktopHostStatus()) })
  router.get('/install', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await installer.status()) })
  router.post('/install', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      if ((await installer.status()).state !== 'running') {
        preparingHosts ??= Promise.all([...prepareHosts].map(prepare => prepare())).then(() => {}).finally(() => { preparingHosts = undefined })
        await preparingHosts
      }
      res.json(await installer.start())
    }
    catch { res.status(500).json({ error: '설치 터미널을 열지 못했습니다. 서버의 tmux 설치와 mew 경로의 접근 권한을 확인해 주세요.' }) }
  })
  return router
}

/** Authenticated signaling leases the physical desktop; media cannot outlive that lease. */
export function attachRemoteDesktopWebSocket(server: Server | Http2SecureServer, { getAuth = resolveAuth, spawnHost, iceServers = desktopIceServers, heartbeatMs = 3000 }: {
  getAuth?: typeof resolveAuth; spawnHost?: () => Promise<Host>; iceServers?: typeof desktopIceServers; heartbeatMs?: number
} = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false })
  let resident = !spawnHost && desktopPlatform() ? residentDesktopHost(spawnDesktopHost) : undefined
  let serverClosed = false
  const launch = spawnHost ?? (resident ? () => resident!.acquire() : spawnDesktopHost)
  // Preparation never installs or captures: only a current, installed login host warms.
  const prewarming = resident
  if (prewarming) void desktopHostStatus().then(status => { if (status.ready) return prewarming.warm() }).catch(() => {})
  let active: WebSocket | null = null
  let retiring: Promise<void> | null = null
  const prepareHost = async () => {
    if (!resident) return
    active?.terminate()
    const previous = resident
    await previous.close()
    // The login supervisor has a two-second deadline after bridge EOF.
    await delay(2500)
    if (!serverClosed) resident = residentDesktopHost(spawnDesktopHost)
  }
  if (resident) prepareHosts.add(prepareHost)
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
      watchSocketAccess(ws, req, request => desktopConnectionAllowed(request, getAuth(request)))
      active = ws
      const account = getAuth(req).email
      let video
      try {
        const query = new URL(req.url ?? '', 'http://localhost').searchParams
        video = videoSettings({ resolution: query.get('resolution') ?? DEFAULT_VIDEO.resolution, fps: query.has('fps') ? Number(query.get('fps')) : DEFAULT_VIDEO.fps, quality: query.get('quality') ?? DEFAULT_VIDEO.quality, priority: query.get('priority') ?? undefined })
      } catch { ws.close(1008); if (active === ws) active = null; return }
      let child: Host | undefined, hostExited = false, disposed = false, alive = true, selected = false, answered = false, hasOffer = false, negotiation = 0, screens = new Set<string>(), signalCount = 0
      const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BYTES * 2) ws.send(JSON.stringify(value)); else ws.close() }
      const write = (value: unknown) => {
        if (!child || child.stdin.destroyed) return
        if (child.stdin.writableLength > MAX_BYTES * 2) { ws.close(); return }
        child.stdin.write(`${JSON.stringify(value)}\n`)
      }
      const dispose = () => {
        if (disposed) return
        disposed = true; clearInterval(heartbeat); clearTimeout(startDeadline)
        if (child && !hostExited) {
          let retired!: () => void
          retiring = new Promise<void>(resolve => { retired = resolve })
          write({ type: 'stop' }); child.stdin.end()
          const kill = setTimeout(() => child?.kill('SIGTERM'), 4000); kill.unref()
          const force = setTimeout(() => { child?.kill('SIGKILL'); retired(); retiring = null }, 5000); force.unref()
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
          if (++signalCount > 128) { ws.close(1008); return }
          if (!validDesktopSignal(message)) { ws.close(1008); return }
          if (['answer', 'candidate'].includes(message.type) && (message.negotiation ?? 0) !== negotiation) return
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
        child = await launch()
        if (child.desktopNetworkHint) void Promise.resolve(child.desktopNetworkHint).then(message => { if (message && !disposed) send({ type: 'network-hint', message }) }).catch(() => {})
        child.stdin.on('error', () => { if (!disposed) fail('원격 데스크톱 보조 앱이 종료됐습니다.') })
        child.once('error', () => { hostExited = true; if (active === ws) active = null; if (!disposed) fail('원격 데스크톱 보조 앱을 실행하지 못했습니다. 설치와 서버 데스크톱 세션을 확인해 주세요.') })
        child.once('exit', () => { hostExited = true; if (!disposed) fail('원격 데스크톱 연결이 종료됐습니다.'); if (active === ws) active = null })
        if (disposed) { child.stdin.end('{"type":"stop"}\n'); child.kill('SIGTERM'); return }
        const read = hostReader(message => {
          if (disposed) return
          if (message.type === 'cursor') { if (!selected || !validCursor(message) || ws.bufferedAmount > MAX_BYTES * 2) throw new Error('Invalid or congested cursor'); send(message); return }
          if (message.type === 'sources' && Array.isArray(message.screens)) {
            screens = new Set(message.screens.map((screen: { id: string }) => screen.id))
            if (message.native === true && !selected && screens.size) {
              const requested = new URL(req.url ?? '', 'http://localhost').searchParams.get('screen')
              const id = requested && requested.length < 256 && screens.has(requested) ? requested : [...screens][0]
              selected = true; send({ ...message, selected: id }); write({ type: 'select', id }); return
            }
          }
          if (message.type === 'offer') {
            const next = message.negotiation ?? 0
            if (!Number.isInteger(next) || next < 0 || next > 2 || hasOffer && next !== negotiation + 1) throw new Error('Invalid negotiation generation')
            negotiation = next; answered = false; hasOffer = true
          }
          if (message.type === 'connected') clearTimeout(startDeadline)
          if (message.type === 'error') { fail(typeof message.message === 'string' ? message.message : '화면 공유에 실패했습니다.'); return }
          if (['sources', 'offer', 'candidate', 'connected', 'direct-failed', 'network-status'].includes(message.type)) send(message)
        }, () => { throw new Error('Media cannot enter signaling') })
        child.stdout.on('data', (chunk: Buffer) => { try { read(chunk) } catch { fail('서버 영상 전송에 실패했습니다. 네트워크를 확인한 뒤 다시 연결해 주세요.') } })
        write({ type: 'init', iceServers: config, udpPort: desktopUdpPort(), autoNat: desktopAutoNat(), video })
      })().catch(error => fail(error instanceof DesktopHostLaunchError ? error.message : '원격 데스크톱 보조 앱과 ICE 설정을 확인해 주세요.'))
    })
  })
  server.once('close', () => { serverClosed = true; prepareHosts.delete(prepareHost); active?.terminate(); void resident?.close(); wss.close() })
}
