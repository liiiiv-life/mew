import type { DesktopInput } from './desktop-input.ts'

/** WebRTC sends input directly; optional feedback bounds the native encoder. */
export function desktopDirect({ iceServers, input, signal, stream, connected, failed, feedback = false, negotiation = 0 }: {
  iceServers: RTCIceServer[]; input: DesktopInput; signal: (message: unknown) => void
  stream: (stream: MediaStream) => void; connected: () => void; failed: () => void
  feedback?: boolean; negotiation?: number
}) {
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
  let closed = false, channels = 0, candidates: RTCIceCandidateInit[] = []
  let control: RTCDataChannel | undefined, previousReceived = 0, previousLost = 0, previousDelay = 0, previousCount = 0
  peer.onicecandidate = event => { if (!closed && event.candidate) signal({ type: 'candidate', negotiation, candidate: event.candidate.toJSON() }) }
  peer.ontrack = event => {
    if (closed) return
    const receiver = event.receiver as RTCRtpReceiver & { jitterBufferTarget?: number }
    if ('jitterBufferTarget' in receiver) { try { receiver.jitterBufferTarget = 0 } catch { /* Browser chooses its supported minimum. */ } }
    stream(event.streams[0] ?? new MediaStream([event.track]))
  }
  peer.ondatachannel = event => {
    const channel = event.channel
    if (closed || !['motion', 'control'].includes(channel.label)) { channel.close(); return }
    input.connect(channel.label, channel)
    if (channel.label === 'control') control = channel
    channel.onopen = () => { if (++channels === 2 && !closed) connected() }
    channel.onclose = channel.onerror = () => { if (!closed) failed() }
  }
  peer.onconnectionstatechange = () => { if (!closed && ['failed', 'disconnected'].includes(peer.connectionState)) failed() }
  return {
    ready() {
      if (!closed && control?.readyState === 'open') {
        try { control.send(JSON.stringify({ type: 'viewer-ready' })) } catch { /* Notification delivery is best effort. */ }
      }
    },
    async message(value: Record<string, unknown>) {
      if (closed) return
      if (value.type === 'offer') {
        await peer.setRemoteDescription({ type: 'offer', sdp: String(value.sdp) })
        if (closed) return
        for (const candidate of candidates) await peer.addIceCandidate(candidate)
        candidates = []
        await peer.setLocalDescription(await peer.createAnswer())
        if (!closed) signal({ type: 'answer', negotiation, sdp: peer.localDescription!.sdp })
      } else if (value.type === 'candidate') {
        if (peer.remoteDescription) await peer.addIceCandidate(value.candidate as RTCIceCandidateInit)
        else if (candidates.length < 128) candidates.push(value.candidate as RTCIceCandidateInit)
      }
    },
    async stats() {
      const report = await peer.getStats()
      if (feedback && !closed && control?.readyState === 'open' && control.bufferedAmount < 16 * 1024) report.forEach(value => {
        if (value.type !== 'inbound-rtp' || value.kind !== 'video') return
        if (!Number.isFinite(value.packetsReceived) || !Number.isFinite(value.packetsLost)) return
        const received = Math.max(0, value.packetsReceived - previousReceived), lost = Math.max(0, value.packetsLost - previousLost)
        const count = Math.max(0, value.jitterBufferEmittedCount - previousCount)
        const delay = count ? Math.max(0, (value.jitterBufferDelay - previousDelay) * 1000 / count) : 0
        if (Number.isFinite(delay)) control!.send(JSON.stringify({ type: 'feedback', loss: lost / Math.max(1, received + lost), delay: Math.min(10_000, delay), decoded: value.framesDecoded > 0 }))
        previousReceived = value.packetsReceived; previousLost = value.packetsLost; previousDelay = value.jitterBufferDelay; previousCount = value.jitterBufferEmittedCount
      })
      return report
    },
    close() { if (closed) return; closed = true; peer.getReceivers().forEach(receiver => receiver.track.stop()); peer.close(); candidates = [] },
  }
}
