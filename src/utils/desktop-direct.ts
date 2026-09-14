import type { DesktopInput } from './desktop-input.ts'

/** WebRTC lifecycle is isolated from the session's fallback policy. */
export function desktopDirect({ iceServers, input, signal, stream, connected, failed }: {
  iceServers: RTCIceServer[]; input: DesktopInput; signal: (message: unknown) => void
  stream: (stream: MediaStream) => void; connected: () => void; failed: () => void
}) {
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
  let closed = false, channels = 0, candidates: RTCIceCandidateInit[] = []
  peer.onicecandidate = event => { if (!closed && event.candidate) signal({ type: 'candidate', candidate: event.candidate.toJSON() }) }
  peer.ontrack = event => { if (!closed) stream(event.streams[0] ?? new MediaStream([event.track])) }
  peer.ondatachannel = event => {
    const channel = event.channel
    if (closed || !['motion', 'control'].includes(channel.label)) { channel.close(); return }
    input.connect(channel.label, channel)
    channel.onopen = () => { if (++channels === 2 && !closed) connected() }
    channel.onclose = channel.onerror = () => { if (!closed) failed() }
  }
  peer.onconnectionstatechange = () => { if (!closed && ['failed', 'disconnected'].includes(peer.connectionState)) failed() }
  return {
    async message(value: Record<string, unknown>) {
      if (closed) return
      if (value.type === 'offer') {
        await peer.setRemoteDescription({ type: 'offer', sdp: String(value.sdp) })
        if (closed) return
        for (const candidate of candidates) await peer.addIceCandidate(candidate)
        candidates = []
        await peer.setLocalDescription(await peer.createAnswer())
        if (!closed) signal({ type: 'answer', sdp: peer.localDescription!.sdp })
      } else if (value.type === 'candidate') {
        if (peer.remoteDescription) await peer.addIceCandidate(value.candidate as RTCIceCandidateInit)
        else if (candidates.length < 128) candidates.push(value.candidate as RTCIceCandidateInit)
      }
    },
    stats: () => peer.getStats(),
    close() { if (closed) return; closed = true; peer.getReceivers().forEach(receiver => receiver.track.stop()); peer.close(); candidates = [] },
  }
}
