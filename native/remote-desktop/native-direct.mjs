import { randomBytes } from 'node:crypto'
import { connectionNotice } from './connection-notice.mjs'
import { publicV4 } from './nat-port-map.mjs'
import { nativeConnectivity } from './native-connectivity.mjs'

/** Hardware encoded Annex B frames enter RTP without a renderer or pixel copies. */
function nativeAttempt(rtc, { iceServers, udpPort, emit, input, keyframe, bitrate, fail, connected = () => {}, readClipboard = async () => { throw new Error('Clipboard unavailable') }, now = Date.now, localCursor = true, relativeOnly = false, negotiation = 0, autoNat = true, connectivity = nativeConnectivity }) {
  let closed = false, opened = 0, remote = false, pending = [], waitingKey = true, rate = 6_000_000, lastFeedback = 0, lastKey = 0
  const notice = connectionNotice(connected)
  // Native channel wrappers close their SCTP channel when collected. Keep both
  // reachable for this attempt, even though input only receives messages.
  const channels = []
  const counts = { host: 0, srflx: 0, ipv6: 0, public4: 0 }
  let gathering = 'new'
  const report = () => { if (!closed) emit({ type: 'network-status', negotiation, gathering, ...counts }) }
  const nat = connectivity({ enabled: autoNat, emit: (candidate, mid) => { if (!closed) { counts.srflx++; report(); emit({ type: 'candidate', negotiation, candidate: { candidate, sdpMid: mid } }) } }, status: mapping => { if (!closed) emit({ type: 'network-status', negotiation, gathering, ...counts, mapping }) } })
  const peer = new rtc.PeerConnection('mew-desktop', {
    iceServers: iceServers.flatMap(server => typeof server.urls === 'string' ? [server.urls] : server.urls),
    disableAutoNegotiation: true, enableIceTcp: true, iceTransportPolicy: 'all', maxMessageSize: 16 * 1024, mtu: 1280,
    ...(udpPort ? { portRangeBegin: udpPort, portRangeEnd: udpPort } : {}),
  })
  const closePeer = () => {
    for (const channel of channels) { try { channel.close() } catch { /* Continue releasing the remaining native objects. */ } }
    channels.length = 0
    peer.close()
  }
  try {
    const ssrc = randomBytes(4).readUInt32BE() || 1, payload = 102
    const video = new rtc.Video('video', 'SendOnly')
    video.addH264Codec(payload, 'profile-level-id=42e033;packetization-mode=1;level-asymmetry-allowed=1')
    video.addSSRC(ssrc, 'mew', 'mew-desktop', 'screen')
    video.setBitrate(6000)
    const track = peer.addTrack(video), config = new rtc.RtpPacketizationConfig(ssrc, 'mew', payload, 90_000)
    // Some prebuilt bindings omit this despite declaring it in TypeScript.
    const buffered = () => typeof track.bufferedAmount === 'function' ? track.bufferedAmount() : 0
    const packetizer = new rtc.H264RtpPacketizer('StartSequence', config, 1180)
    packetizer.addToChain(new rtc.RtcpSrReporter(config))
    packetizer.addToChain(new rtc.RtcpNackResponder(512))
    track.setMediaHandler(packetizer)
    const requestKey = () => { if (!closed && now() - lastKey >= 200) { lastKey = now(); keyframe() } }
    const feedback = value => {
      if (!Number.isFinite(value.loss) || value.loss < 0 || value.loss > 1 || !Number.isFinite(value.delay) || value.delay < 0 || value.delay > 10_000 || typeof value.decoded !== 'boolean') throw new Error('Invalid video feedback')
      if (now() - lastFeedback < 750) return
      lastFeedback = now()
      if (!value.decoded) requestKey()
      const congested = value.loss > .03 || value.delay > 80 || buffered() > 192 * 1024
      const next = Math.round(Math.max(350_000, Math.min(6_000_000, congested ? rate * .75 : rate * 1.05)))
      if (next !== rate) { rate = next; bitrate(rate) }
    }
    for (const [label, options] of [['motion', { unordered: true, maxRetransmits: 0 }], ['control', {}]]) {
      const channel = peer.createDataChannel(label, options)
      channels.push(channel)
      channel.onOpen(() => {
        if (closed) return
        nat.connected(); notice.opened(label)
        if (++opened === 2) emit({ type: 'connected', native: true, localCursor, relativeOnly })
      })
      channel.onMessage(raw => {
        if (closed) return
        try {
          if (typeof raw !== 'string' || raw.length > 16 * 1024) throw new Error('Invalid desktop input')
          const value = JSON.parse(raw)
          if (label === 'control' && value.type === 'viewer-ready' && Object.keys(value).length === 1) notice.ready()
          else if (label === 'control' && value.type === 'clipboard-read') {
            if (!Number.isSafeInteger(value.id) || value.id < 1 || Object.keys(value).length !== 2) throw new Error('Invalid clipboard request')
            if (channel.clipboardPending) return
            channel.clipboardPending = true
            void Promise.resolve().then(readClipboard).then(text => {
              if (typeof text !== 'string' || text.length > 4096 || text.includes('\0')) throw new Error('Invalid clipboard text')
              const response = JSON.stringify({ type: 'clipboard', id: value.id, text })
              if (Buffer.byteLength(response) > 16 * 1024) throw new Error('Clipboard text too large')
              if (!closed && channel.isOpen()) channel.sendMessage(response)
            }).catch(() => { if (!closed && channel.isOpen()) { try { channel.sendMessage(JSON.stringify({ type: 'clipboard', id: value.id, error: true })) } catch { /* Channel closed. */ } } }).finally(() => { channel.clipboardPending = false })
          }
          else if (label === 'control' && value.type === 'feedback') feedback(value)
          else input(value, label === 'control')
        } catch { fail(new Error('원격 입력을 처리하지 못했습니다. 다시 연결해 주세요.')) }
      })
      channel.onClosed(() => { if (!closed) fail(new Error('원격 입력 연결이 종료됐습니다.'), opened === 0) })
      channel.onError(() => { if (!closed) fail(new Error('원격 입력 연결에 실패했습니다.'), opened === 0) })
    }
    track.onOpen(requestKey)
    track.onError(() => { if (!closed) fail(new Error('직접 영상 연결에 실패했습니다.'), opened === 0) })
    track.onMessage(packet => {
      // RFC 4585 PLI / RFC 5104 FIR, after NACK processing in the media chain.
      for (let offset = 0; offset + 4 <= packet.length;) {
        const size = (packet.readUInt16BE(offset + 2) + 1) * 4
        if (size < 4 || offset + size > packet.length) break
        if (packet[offset + 1] === 206 && [1, 4].includes(packet[offset] & 31)) requestKey()
        offset += size
      }
    })
    peer.onLocalDescription((sdp, type) => { if (!closed && type === 'offer') emit({ type: 'offer', sdp, native: true, negotiation }) })
    peer.onLocalCandidate((candidate, mid) => {
      if (closed) return
      const fields = candidate.split(/\s+/), type = fields[fields.indexOf('typ') + 1], address = fields[4] ?? ''
      if (type === 'relay') return // No relayed media, including injected configuration.
      if (type === 'host') counts.host++
      if (type === 'srflx') counts.srflx++
      if (publicV4(address)) counts.public4++
      if (address.includes(':') && !/^(?:fe[89ab]|f[cd]|::)/i.test(address)) counts.ipv6++
      emit({ type: 'candidate', negotiation, candidate: { candidate, sdpMid: mid } }); report(); nat.candidate(candidate, mid)
    })
    peer.onGatheringStateChange?.(state => { gathering = state === 'complete' ? 'complete' : 'gathering'; report() })
    peer.onStateChange(state => { if (!closed && ['failed', 'disconnected', 'closed'].includes(state)) fail(new Error(gathering === 'complete' && iceServers.length && !counts.srflx && !counts.ipv6 && !counts.public4 ? '외부 연결 주소를 찾지 못했습니다. STUN 주소 탐색이 차단됐거나 응답하지 않습니다.' : '외부 기기와 직접 연결 경로를 만들지 못했습니다. 자동 NAT 연결과 호스트의 UDP 허용 상태를 확인해 주세요.'), opened === 0) })
    peer.setLocalDescription('offer')
    return {
      signal(value) {
        if (closed || (value.negotiation ?? 0) !== negotiation) return
        if (value.type === 'answer') { peer.setRemoteDescription(value.sdp, 'answer'); remote = true; for (const candidate of pending) peer.addRemoteCandidate(candidate.candidate, candidate.sdpMid ?? 'video'); pending = [] }
        else if (value.type === 'candidate') { if (remote) peer.addRemoteCandidate(value.candidate.candidate, value.candidate.sdpMid ?? 'video'); else if (pending.length < 128) pending.push(value.candidate) }
      },
      frame(value) {
        if (closed || !track.isOpen()) return
        if (buffered() > 256 * 1024) { waitingKey = true; requestKey(); return }
        if (waitingKey && !value.key) { requestKey(); return }
        config.timestamp = Math.floor(value.timestamp * .09) >>> 0
        if (!track.sendMessageBinary(Buffer.from(value.data))) { waitingKey = true; requestKey() }
        else waitingKey = false
      },
      unopened() { return opened === 0 },
      close() { if (closed) return nat.close(); closed = true; notice.close(); pending = []; closePeer(); return nat.close() },
    }
  } catch (error) { closed = true; notice.close(); closePeer(); void nat.close(); throw error }
}

/** libjuice selects one STUN server per agent. Retry a fresh agent, not a list that silently picks one. */
export function nativeDirect(rtc, options) {
  const servers = [...new Set(options.iceServers.flatMap(server => typeof server.urls === 'string' ? [server.urls] : server.urls))]
  let attempt = 0, current, closed = false, timer, switching = false, pending = Promise.resolve()
  const start = () => {
    const fail = (error, recoverable = false) => {
      if (closed || switching) return
      if (!recoverable || attempt + 1 >= Math.min(3, servers.length)) { clearTimeout(timer); options.fail(error); return }
      switching = true; clearTimeout(timer)
      const old = current; current = undefined
      pending = Promise.resolve(old?.close()).then(() => { if (closed) return; attempt++; switching = false; start() }).catch(() => { if (!closed) options.fail(error) })
    }
    try {
      current = nativeAttempt(rtc, { ...options, negotiation: attempt, iceServers: servers.length ? [{ urls: servers[attempt] }] : [], fail })
      if (attempt + 1 < Math.min(3, servers.length)) {
        timer = setTimeout(() => { if (current?.unopened()) fail(new Error('외부 연결 경로 탐색 시간이 초과됐습니다.'), true) }, 12_000)
        timer.unref?.()
      }
    } catch (error) { options.fail(error) }
  }
  start()
  return {
    signal(value) { current?.signal(value) }, frame(value) { current?.frame(value) },
    async close() { if (closed) return pending; closed = true; clearTimeout(timer); await current?.close(); await pending },
  }
}
