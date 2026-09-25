import { uiText } from '@mew/ui/i18n-core'
import { validCursor, type DesktopCursor } from '../../native/remote-desktop/cursor-protocol.mjs'
import { desktopInput } from './desktop-input.ts'
import { prepareDesktop } from './desktop-preparation.ts'
import { desktopDirect } from './desktop-direct.ts'
import { desktopRelayReceiver } from './desktop-relay.ts'

export type DesktopScreen = { id: string; label: string; width: number; height: number }
export type DesktopState = 'preparing' | 'connecting' | 'connected' | 'error' | 'paused'
export type DesktopEvents = {
  state: (state: DesktopState, message: string) => void
  screens: (screens: DesktopScreen[], selected: string) => void
  stream: (stream: MediaStream) => void
  frame?: (frame: VideoFrame) => void
  transport?: (mode: 'direct' | 'server') => void
  relative: (value: boolean) => void
  stats: (value: string) => void
  installable?: (value: boolean) => void
  cursor?: (value: DesktopCursor) => void
  localCursor?: (enabled: boolean) => void
  pointer?: (x: number, y: number, joystick: boolean | undefined) => void
}

/** Owns preparation, lease and one-way direct -> server transport selection. */
export function connectDesktop(events: DesktopEvents, preferredScreen?: string) {
  const input = desktopInput(message => fail(message), (x, y, joystick) => events.pointer?.(x, y, joystick)), abort = new AbortController()
  let socket: WebSocket | undefined, direct: ReturnType<typeof desktopDirect> | undefined
  let relay: Awaited<ReturnType<typeof desktopRelayReceiver>> | undefined
  let closed = false, connected = false, mode: 'direct' | 'switching' | 'server' = 'direct'
  let iceServers: RTCIceServer[] = [], candidates: Record<string, unknown>[] = [], offered = false
  let networkHint = ''
  let lastBytes = 0, lastTime = 0, motionFrame = 0, relayAck = ''
  let deadline: ReturnType<typeof setTimeout> | undefined, directDeadline: ReturnType<typeof setTimeout> | undefined
  const pumpMotion = (now: number) => {
    if (closed) return
    input.flushMotion(now)
    motionFrame = requestAnimationFrame(pumpMotion)
  }
  motionFrame = requestAnimationFrame(pumpMotion)
  const send = (value: unknown) => {
    if (socket?.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > 64 * 1024) { fail(uiText("서버로 보내는 입력이 지연됐습니다. 다시 연결해 주세요.")); return }
    socket.send(JSON.stringify(value))
  }
  const close = () => {
    if (closed) return
    closed = true; cancelAnimationFrame(motionFrame)
    try { input.close() } catch { /* Native input watchdog also releases held keys. */ }
    abort.abort(); clearInterval(heartbeat); clearInterval(stats); clearTimeout(deadline); clearTimeout(directDeadline)
    direct?.close(); relay?.close(); socket?.close()
  }
  const fail = (message: string) => { if (!closed) { close(); events.state('error', message) } }
  const markConnected = () => {
    if (closed) return
    connected = true; clearTimeout(deadline)
    events.state('connected', mode === 'server' ? uiText("서버를 통해 연결됨") : uiText("직접 연결됨"))
    input.heartbeat()
  }
  const switchToRelay = async () => {
    if (closed || mode !== 'direct') return
    mode = 'switching'; connected = false
    events.state('connecting', uiText("Mew 서버를 통해 화면을 연결하고 있습니다…"))
    clearTimeout(directDeadline); clearTimeout(deadline)
    input.close(); direct?.close(); direct = undefined; candidates = []
    lastBytes = 0; lastTime = 0
    deadline = setTimeout(() => fail(uiText("서버 영상 연결 시간이 초과됐습니다. 네트워크를 확인한 뒤 다시 연결해 주세요.")), 20_000)
    try {
      if (!events.frame) throw new Error(uiText("서버 영상 연결을 사용하려면 Mew 페이지를 새로고침해 주세요."))
      const next = await desktopRelayReceiver({
        display: events.frame,
        acknowledge: (seq, keyframe) => send({ type: 'frame-ack', seq, keyframe }),
        ready: markConnected, fail,
      })
      if (closed) { next.close(); return }
      relay = next; mode = 'server'; events.transport?.('server')
      send({ type: 'relay' })
    } catch (error) { fail([error instanceof Error ? error.message : uiText("서버 영상 연결을 준비하지 못했습니다."), networkHint].filter(Boolean).join(' ')) }
  }
  const heartbeat = setInterval(() => { try { input.heartbeat() } catch (error) { fail(String((error as Error).message)) } }, 250)
  const stats = setInterval(() => {
    if (!connected || closed) return
    if (mode === 'server' && relay) {
      const now = performance.now(), bytes = relay.bytes
      const rate = lastTime ? `${Math.max(0, (bytes - lastBytes) * 8 / (now - lastTime) / 1000).toFixed(1)} Mbps` : ''
      lastTime = now; lastBytes = bytes
      events.stats([uiText("서버 연결"), rate, relayAck].filter(Boolean).join(' · '))
      return
    }
    if (!direct) return
    void direct.stats().then(report => {
      let rate = '', rtt = ''
      report.forEach(value => {
        if (value.type === 'inbound-rtp' && value.kind === 'video') {
          if (value.framesDecoded > 0) clearTimeout(directDeadline)
          if (lastTime) rate = `${Math.max(0, (value.bytesReceived - lastBytes) * 8 / (value.timestamp - lastTime) / 1000).toFixed(1)} Mbps`
          lastBytes = value.bytesReceived; lastTime = value.timestamp
        }
        if (value.type === 'candidate-pair' && value.nominated && value.state === 'succeeded' && typeof value.currentRoundTripTime === 'number') rtt = uiText("왕복 {p0} ms", { p0: Math.round(value.currentRoundTripTime * 1000) })
      })
      if (!closed && mode === 'direct') events.stats([uiText("직접 연결"), rtt, rate].filter(Boolean).join(' · '))
    }).catch(() => {})
  }, 1000)
  const message = async (value: Record<string, unknown>) => {
    if (closed) return
    if (value.type === 'error') return fail(String(value.message))
    if (value.type === 'config') iceServers = value.iceServers as RTCIceServer[]
    if (value.type === 'cursor') {
      if (!validCursor(value)) throw new Error(uiText("잘못된 원격 커서입니다."))
      input.remoteCursor(value); events.cursor?.(value); return
    }
    if (value.type === 'relay-status' && mode === 'server') {
      relay?.status(value)
      if (typeof value.ackMs === 'number' && Number.isFinite(value.ackMs) && value.ackMs >= 0 && value.ackMs <= 60_000) relayAck = value.idle ? uiText("화면 정지") : uiText("표시 응답 {p0} ms", { p0: Math.round(value.ackMs) })
      return
    }
    if (value.type === 'connected' && mode === 'direct' || value.type === 'relay-ready' && mode === 'server') {
      input.localCursor(value.localCursor === true); events.localCursor?.(value.localCursor === true)
    }
    if (value.type === 'network-hint') networkHint = String(value.message)
    if (value.type === 'sources') {
      const screens = value.screens as DesktopScreen[]
      const selected = screens.find(screen => screen.id === preferredScreen)?.id ?? screens[0]?.id
      if (!selected) return fail(uiText("공유할 화면이 없습니다. 서버에서 데스크톱에 로그인해 주세요."))
      events.screens(screens, selected); send({ type: 'select', id: selected })
      events.state('connecting', uiText("서버에서 화면 공유 요청을 승인해 주세요."))
    }
    if (value.type === 'connected' && mode === 'direct') events.relative(value.relativeOnly === true)
    if (value.type === 'direct-failed') return switchToRelay()
    if (value.type === 'relay-ready' && mode === 'server') {
      events.relative(value.relativeOnly === true)
      for (const label of ['motion', 'control']) input.connect(label, {
        get readyState() { return !closed && mode === 'server' && socket?.readyState === WebSocket.OPEN ? 'open' : 'closed' },
        get bufferedAmount() { return socket?.bufferedAmount ?? 0 },
        send: (raw: string) => send({ type: 'relay-input', reliable: label === 'control', value: JSON.parse(raw) }),
      })
      input.heartbeat()
    }
    if (mode !== 'direct') return
    if (value.type === 'offer') {
      if (offered) throw new Error(uiText("화면 연결 응답이 중복됐습니다."))
      offered = true
      directDeadline = setTimeout(() => {
        // A decoded frame wins even if the regular statistics tick has not run.
        void (async () => {
          let decoded = false
          try { (await direct?.stats())?.forEach(value => { if (value.type === 'inbound-rtp' && value.kind === 'video' && value.framesDecoded > 0) decoded = true }) } catch { /* Fall back when the peer cannot report. */ }
          if (!closed && mode === 'direct' && !decoded) await switchToRelay()
        })()
      }, 1200)
      try {
        events.transport?.('direct')
        direct = desktopDirect({ iceServers, input, signal: send, stream: events.stream, connected: markConnected, failed: () => { void switchToRelay() } })
        await direct.message(value)
        for (const candidate of candidates) await direct?.message(candidate)
        candidates = []
      } catch { if (mode === 'direct') await switchToRelay() }
    }
    if (value.type === 'candidate') {
      if (direct) { try { await direct.message(value) } catch { await switchToRelay() } }
      else if (candidates.length < 128) candidates.push(value)
    }
  }
  events.state('preparing', uiText("서버 데스크톱을 준비하고 있습니다…"))
  void (async () => {
    await prepareDesktop({ signal: abort.signal, message: value => events.state('preparing', value), installable: value => events.installable?.(value) })
    if (closed) return
    events.state('connecting', uiText("로그인한 데스크톱에 연결하고 있습니다…"))
    deadline = setTimeout(() => fail(uiText("화면 연결 시간이 초과됐습니다. 서버의 화면 공유 권한을 확인해 주세요.")), 95_000)
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/remote-desktop/ws`)
    socket.binaryType = 'arraybuffer'
    let queue = Promise.resolve()
    socket.onmessage = event => {
      if (closed) return
      if (event.data instanceof ArrayBuffer) {
        try { if (!relay) throw new Error(uiText("예상하지 못한 영상 응답입니다.")); relay.packet(event.data) }
        catch (error) { fail(error instanceof Error ? error.message : uiText("영상을 읽지 못했습니다.")) }
        return
      }
      queue = queue.then(() => message(JSON.parse(event.data))).catch(error => fail(error instanceof Error ? error.message : uiText("화면 연결 응답을 읽지 못했습니다.")))
    }
    socket.onclose = () => fail(uiText("서버 연결이 종료됐습니다. 다시 연결해 주세요."))
    socket.onerror = () => fail(uiText("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요."))
  })().catch(error => { if (!closed) fail(error instanceof Error ? error.message : uiText("화면 연결에 실패했습니다.")) })
  return { input, close, fail }
}
