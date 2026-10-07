import { openMewSocket } from './remote-transport.ts'
import { uiText } from '@mew/ui/i18n-core'
import { validCursor, type DesktopCursor } from '../../native/remote-desktop/cursor-protocol.mjs'
import { desktopInput } from './desktop-input.ts'
import { prepareDesktop } from './desktop-preparation.ts'
import { desktopDirect } from './desktop-direct.ts'
import { desktopNetworkUsage, type DesktopNetworkUsage } from './desktop-network.ts'
import { desktopUsageReporter } from './network-usage.ts'

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
  network?: (value: DesktopNetworkUsage) => void
  installable?: (value: boolean) => void
  cursor?: (value: DesktopCursor) => void
  localCursor?: (enabled: boolean) => void
  pointer?: (x: number, y: number, joystick: boolean | undefined) => void
}

/** Owns preparation, authentication lease and direct-only media/input. */
export function connectDesktop(events: DesktopEvents, preferredScreen?: string) {
  const input = desktopInput(message => fail(message), (x, y, joystick) => events.pointer?.(x, y, joystick)), abort = new AbortController()
  const network = desktopNetworkUsage(), encoder = new TextEncoder()
  const reportUsage = desktopUsageReporter()
  const publishNetwork = () => { const value = network.value(); reportUsage(value); events.network?.(value) }
  let socket: WebSocket | undefined, direct: ReturnType<typeof desktopDirect> | undefined
  let closed = false, connected = false, channelsReady = false, decoded = false
  let iceServers: RTCIceServer[] = [], candidates: Record<string, unknown>[] = [], offered = false
  let networkHint = '', negotiation = -1
  let networkStatus: { gathering?: string; srflx?: number; ipv6?: number; public4?: number; mapping?: string } = {}
  let lastBytes = 0, lastTime = 0, motionFrame = 0, statsAt = 0, checkingStats = false
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
    const data = JSON.stringify(value)
    socket.send(data); network.sent(encoder.encode(data).byteLength)
  }
  const close = () => {
    if (closed) return
    closed = true; cancelAnimationFrame(motionFrame)
    try { input.close() } catch { /* Native input watchdog also releases held keys. */ }
    abort.abort(); clearInterval(heartbeat); clearInterval(stats); clearTimeout(deadline); clearTimeout(directDeadline)
    direct?.close(); socket?.close(); publishNetwork()
  }
  const fail = (message: string) => { if (!closed) { close(); events.state('error', message) } }
  const markConnected = () => {
    if (closed || connected || !channelsReady || !decoded) return
    connected = true
    clearTimeout(directDeadline); clearTimeout(deadline)
    events.state('connected', uiText("직접 연결됨"))
    input.heartbeat()
    direct?.ready()
  }
  const directFailed = () => {
    const addressFailed = networkStatus.gathering === 'complete' && iceServers.length > 0 && !networkStatus.srflx && !networkStatus.ipv6 && !networkStatus.public4
    fail(channelsReady && !decoded ? uiText("원격 화면을 받지 못했습니다. 서버의 활성 화면과 캡처 상태를 확인해 주세요.") : [uiText(addressFailed ? "서버의 외부 연결 주소를 찾지 못했습니다. STUN 주소 탐색과 인터넷 연결을 확인해 주세요." : "외부 기기와 직접 연결하지 못했습니다. 자동 NAT 연결과 호스트의 UDP 허용 상태를 확인해 주세요."), networkHint].filter(Boolean).join(' '))
  }
  const heartbeat = setInterval(() => { try { input.heartbeat() } catch (error) { fail(String((error as Error).message)) } }, 250)
  const stats = setInterval(() => {
    if (!direct || closed || checkingStats || performance.now() - statsAt < (connected ? 1000 : 100)) return
    statsAt = performance.now(); checkingStats = true
    const current = direct, generation = negotiation
    void current.stats().then(report => {
      if (closed || direct !== current || negotiation !== generation) return
      network.sample(report); publishNetwork()
      let rate = '', rtt = ''
      report.forEach(value => {
        if (value.type === 'inbound-rtp' && value.kind === 'video') {
          if (value.framesDecoded > 0) { decoded = true; markConnected() }
          if (lastTime) rate = `${Math.max(0, (value.bytesReceived - lastBytes) * 8 / (value.timestamp - lastTime) / 1000).toFixed(1)} Mbps`
          lastBytes = value.bytesReceived; lastTime = value.timestamp
        }
        if (value.type === 'candidate-pair' && value.nominated && value.state === 'succeeded' && typeof value.currentRoundTripTime === 'number') rtt = uiText("왕복 {p0} ms", { p0: Math.round(value.currentRoundTripTime * 1000) })
      })
      if (!closed) events.stats([uiText("직접 연결"), rtt, rate].filter(Boolean).join(' · '))
    }).catch(() => {}).finally(() => { checkingStats = false })
  }, 100)
  const message = async (value: Record<string, unknown>) => {
    if (closed) return
    if (value.type === 'error') return fail(String(value.message))
    if (value.type === 'config') iceServers = value.iceServers as RTCIceServer[]
    if (value.type === 'cursor') {
      if (!validCursor(value)) throw new Error(uiText("잘못된 원격 커서입니다."))
      input.remoteCursor(value); events.cursor?.(value); return
    }
    if (value.type === 'connected') {
      input.localCursor(value.localCursor === true); events.localCursor?.(value.localCursor === true)
      events.relative(value.relativeOnly === true)
    }
    if (value.type === 'network-hint') networkHint = String(value.message)
    if (value.type === 'network-status' && value.negotiation === negotiation && ['srflx', 'ipv6'].every(key => Number.isInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= 128)) networkStatus = { ...networkStatus, gathering: String(value.gathering), srflx: Number(value.srflx), ipv6: Number(value.ipv6), public4: Number(value.public4 ?? 0), ...(value.mapping ? { mapping: String(value.mapping) } : {}) }
    if (value.type === 'sources') {
      const screens = value.screens as DesktopScreen[]
      const selected = screens.find(screen => screen.id === value.selected)?.id ?? screens.find(screen => screen.id === preferredScreen)?.id ?? screens[0]?.id
      if (!selected) return fail(uiText("공유할 화면이 없습니다. 서버에서 데스크톱에 로그인해 주세요."))
      events.screens(screens, selected); if (value.selected !== selected) send({ type: 'select', id: selected })
      events.state('connecting', uiText("원격 화면에 직접 연결하고 있습니다…"))
    }
    if (value.type === 'direct-failed') return directFailed()
    if (value.type === 'offer') {
      const next = Number(value.negotiation ?? 0)
      if (!Number.isInteger(next) || next < 0 || next > 2 || offered && (next !== negotiation + 1 || connected || channelsReady)) throw new Error(uiText("화면 연결 응답이 중복됐습니다."))
      direct?.close(); network.resetPeer(); input.close(); decoded = false; lastBytes = 0; lastTime = 0; networkStatus = {}; negotiation = next; offered = true
      clearTimeout(directDeadline)
      directDeadline = setTimeout(directFailed, 20_000)
      try {
        events.transport?.('direct')
        // The native host may replace a failed ICE agent before any input opens.
        // Keep signaling alive for its next offer; the attempt deadline stays bounded.
        direct = desktopDirect({ iceServers, input, signal: send, stream: events.stream, connected: () => { channelsReady = true; markConnected() }, failed: () => { if (channelsReady || connected) directFailed() }, feedback: value.native === true, negotiation })
        await direct.message(value)
        for (const candidate of candidates) if ((candidate.negotiation ?? 0) === negotiation) await direct?.message(candidate)
        candidates = []
      } catch { directFailed() }
    }
    if (value.type === 'candidate') {
      if (Number(value.negotiation ?? 0) < negotiation) return
      if (direct && (value.negotiation ?? 0) === negotiation) { try { await direct.message(value) } catch { directFailed() } }
      else if (candidates.length < 128) candidates.push(value)
    }
  }
  events.state('preparing', uiText("서버 데스크톱을 준비하고 있습니다…"))
  void (async () => {
    await prepareDesktop({ signal: abort.signal, message: value => events.state('preparing', value), installable: value => events.installable?.(value) })
    if (closed) return
    events.state('connecting', uiText("로그인한 데스크톱에 연결하고 있습니다…"))
    deadline = setTimeout(() => fail(uiText("화면 연결 시간이 초과됐습니다. 서버의 화면 공유 권한을 확인해 주세요.")), 95_000)
    socket = openMewSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/remote-desktop/ws${preferredScreen ? `?screen=${encodeURIComponent(preferredScreen)}` : ''}`)
    socket.binaryType = 'arraybuffer'
    let queue = Promise.resolve()
    socket.onmessage = event => {
      if (closed) return
      if (event.data instanceof ArrayBuffer) { fail(uiText("예상하지 못한 영상 응답입니다.")); return }
      network.received(encoder.encode(event.data).byteLength)
      queue = queue.then(() => message(JSON.parse(event.data))).catch(error => fail(error instanceof Error ? error.message : uiText("화면 연결 응답을 읽지 못했습니다.")))
    }
    socket.onclose = () => fail(uiText("서버 연결이 종료됐습니다. 다시 연결해 주세요."))
    socket.onerror = () => fail(uiText("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요."))
  })().catch(error => { if (!closed) fail(error instanceof Error ? error.message : uiText("화면 연결에 실패했습니다.")) })
  return { input, close, fail }
}
