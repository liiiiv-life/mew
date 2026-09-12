import { desktopInput } from './desktop-input.ts'

export type DesktopScreen = { id: string; label: string; width: number; height: number }
export type DesktopState = 'preparing' | 'connecting' | 'connected' | 'error' | 'paused'
export type DesktopEvents = {
  state: (state: DesktopState, message: string) => void
  screens: (screens: DesktopScreen[], selected: string) => void
  stream: (stream: MediaStream) => void
  relative: (value: boolean) => void
  stats: (value: string) => void
  installable?: (value: boolean) => void
}

export function connectDesktop(events: DesktopEvents, preferredScreen?: string) {
  const input = desktopInput(message => fail(message)), abort = new AbortController()
  let socket: WebSocket | undefined, peer: RTCPeerConnection | undefined, closed = false, connected = false
  let iceServers: RTCIceServer[] = [], candidates: RTCIceCandidateInit[] = [], lastBytes = 0, lastTime = 0
  let motionFrame = 0, lastMotion = 0
  const pumpMotion = (now: number) => {
    if (closed) return
    if (now - lastMotion >= 1000 / 60) { input.flushMotion(); lastMotion = now }
    motionFrame = requestAnimationFrame(pumpMotion)
  }
  motionFrame = requestAnimationFrame(pumpMotion)
  const send = (value: unknown) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
  const close = () => {
    if (closed) return
    closed = true
    cancelAnimationFrame(motionFrame)
    try { input.close() } catch { /* Host timeout releases inputs if the reliable channel is congested. */ }
    abort.abort(); clearInterval(heartbeat); clearInterval(stats); clearTimeout(deadline)
    peer?.getReceivers().forEach(receiver => receiver.track?.stop()); peer?.close(); socket?.close()
  }
  const fail = (message: string) => { if (!closed) { close(); events.state('error', message) } }
  const deadline = setTimeout(() => fail('화면 연결 시간이 초과됐습니다. 서버의 공유 권한과 네트워크 설정을 확인해 주세요.'), 95_000)
  const heartbeat = setInterval(() => { try { input.heartbeat() } catch (error) { fail(String((error as Error).message)) } }, 250)
  const stats = setInterval(() => {
    if (!peer || !connected) return
    void peer.getStats().then(report => {
      let rate = '', rtt = ''
      report.forEach(value => {
        if (value.type === 'inbound-rtp' && value.kind === 'video') {
          if (lastTime) rate = `${Math.max(0, (value.bytesReceived - lastBytes) * 8 / (value.timestamp - lastTime) / 1000).toFixed(1)} Mbps`
          lastBytes = value.bytesReceived; lastTime = value.timestamp
        }
        if (value.type === 'candidate-pair' && value.nominated && value.state === 'succeeded' && typeof value.currentRoundTripTime === 'number') rtt = `왕복 ${Math.round(value.currentRoundTripTime * 1000)} ms`
      })
      if (!closed) events.stats([rtt, rate].filter(Boolean).join(' · '))
    }).catch(() => {})
  }, 1000)
  const message = async (value: Record<string, unknown>) => {
    if (closed) return
    if (value.type === 'error') return fail(String(value.message))
    if (value.type === 'config') iceServers = value.iceServers as RTCIceServer[]
    if (value.type === 'sources') {
      const screens = value.screens as DesktopScreen[]
      const selected = screens.find(screen => screen.id === preferredScreen)?.id ?? screens[0]?.id
      if (!selected) return fail('공유할 화면이 없습니다. 서버에서 데스크톱에 로그인해 주세요.')
      events.screens(screens, selected); send({ type: 'select', id: selected }); events.state('connecting', '서버에서 화면 공유 요청을 승인해 주세요.')
    }
    if (value.type === 'connected') events.relative(value.relativeOnly === true)
    if (value.type === 'offer') {
      if (peer) throw new Error('화면 연결 응답이 중복됐습니다.')
      peer = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
      peer.onicecandidate = event => { if (event.candidate) send({ type: 'candidate', candidate: event.candidate.toJSON() }) }
      peer.ontrack = event => events.stream(event.streams[0] ?? new MediaStream([event.track]))
      let channels = 0
      peer.ondatachannel = event => {
        const channel = event.channel
        if (!['motion', 'control'].includes(channel.label)) { channel.close(); return }
        input.connect(channel.label, channel)
        channel.onopen = () => { if (++channels === 2 && !closed) { connected = true; clearTimeout(deadline); events.state('connected', '연결됨'); input.heartbeat() } }
        channel.onclose = () => fail('입력 연결이 종료됐습니다. 다시 연결해 주세요.')
        channel.onerror = () => fail('입력 연결에 실패했습니다. 다시 연결해 주세요.')
      }
      peer.onconnectionstatechange = () => { if (peer?.connectionState === 'failed') fail('직접 연결에 실패했습니다. 외부 네트워크에서는 서버의 TURN 설정을 확인해 주세요.') }
      await peer.setRemoteDescription({ type: 'offer', sdp: String(value.sdp) })
      for (const candidate of candidates) await peer.addIceCandidate(candidate)
      candidates = []
      await peer.setLocalDescription(await peer.createAnswer())
      send({ type: 'answer', sdp: peer.localDescription!.sdp })
    }
    if (value.type === 'candidate') {
      if (peer?.remoteDescription) await peer.addIceCandidate(value.candidate as RTCIceCandidateInit)
      else candidates.push(value.candidate as RTCIceCandidateInit)
    }
  }
  events.state('preparing', '서버 데스크톱을 준비하고 있습니다…')
  void (async () => {
    const response = await fetch('/api/remote-desktop/status', { signal: abort.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? '소유자 또는 관리자 로그인이 필요합니다.' : '서버 상태를 확인하지 못했습니다.')
    const status = await response.json()
    if (closed) return
    events.installable?.(status.installable === true)
    if (!status.ready) return fail(status.message)
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/remote-desktop/ws`)
    let queue = Promise.resolve()
    socket.onmessage = event => { queue = queue.then(() => message(JSON.parse(event.data))).catch(error => fail(error instanceof Error ? error.message : '화면 연결 응답을 읽지 못했습니다.')) }
    socket.onclose = () => fail('서버 연결이 종료됐습니다. 다시 연결해 주세요.')
    socket.onerror = () => fail('서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.')
  })().catch(error => { if (!closed) fail(error instanceof Error ? error.message : '화면 연결에 실패했습니다.') })
  return { input, close, fail }
}
