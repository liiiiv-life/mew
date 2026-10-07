import type { DesktopInput } from './desktop-input.ts'
import { desktopVideoFeedback, desktopVideoAnswer } from './desktop-video.ts'
import { DEFAULT_VIDEO, videoSettings, type DesktopVideoMode, type DesktopVideoSettings } from '../../native/remote-desktop/video-settings.mjs'

/** WebRTC sends input directly; optional feedback bounds the native encoder. */
export function desktopDirect({ iceServers, input, signal, stream, connected, failed, feedback = false, negotiation = 0, video = DEFAULT_VIDEO }: {
  iceServers: RTCIceServer[]; input: DesktopInput; signal: (message: unknown) => void
  stream: (stream: MediaStream) => void; connected: () => void; failed: () => void
  feedback?: boolean; negotiation?: number; video?: DesktopVideoSettings
}) {
  const peer = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
  let closed = false, channels = 0, candidates: RTCIceCandidateInit[] = []
  let control: RTCDataChannel | undefined, videoStatus: (DesktopVideoMode & { queueMs: number; drops: number }) | undefined
  const sampleFeedback = desktopVideoFeedback()
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
    if (channel.label === 'control') { control = channel; channel.onmessage = event => {
      if (closed) return
      input.message(event.data)
      if (typeof event.data !== 'string' || event.data.length > 16 * 1024) return
      try {
        const value = JSON.parse(event.data)
        if (value.type !== 'video-status') return
        videoSettings(value)
        if (!['high', 'baseline'].includes(value.profile) || ![value.width, value.height, value.bitrate, value.queueMs, value.drops].every(Number.isFinite)
          || value.width < 2 || value.width > 3840 || value.height < 2 || value.height > 2160 || value.bitrate < 350000 || value.bitrate > 50000000 || value.queueMs < 0 || value.queueMs > 10000 || value.drops < 0) return
        videoStatus = value; input.frameRate(value.fps)
      } catch { /* Ignore unrelated or invalid diagnostics. */ }
    } }
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
        const answer = await peer.createAnswer()
        if (feedback && answer.sdp) answer.sdp = await desktopVideoAnswer(answer.sdp, video)
        if (closed) return
        await peer.setLocalDescription(answer)
        if (!closed) signal({ type: 'answer', negotiation, sdp: peer.localDescription!.sdp })
      } else if (value.type === 'candidate') {
        if (peer.remoteDescription) await peer.addIceCandidate(value.candidate as RTCIceCandidateInit)
        else if (candidates.length < 128) candidates.push(value.candidate as RTCIceCandidateInit)
      }
    },
    async stats() {
      const report = await peer.getStats()
      let rtt: number | undefined
      report.forEach(value => { if (value.type === 'candidate-pair' && value.nominated && value.state === 'succeeded' && typeof value.currentRoundTripTime === 'number') rtt = value.currentRoundTripTime * 1000 })
      if (feedback && !closed && control?.readyState === 'open' && control.bufferedAmount < 16 * 1024) report.forEach(value => {
        if (value.type !== 'inbound-rtp' || value.kind !== 'video') return
        if (!Number.isFinite(value.packetsReceived) || !Number.isFinite(value.packetsLost)) return
        control!.send(JSON.stringify({ type: 'feedback', ...sampleFeedback(value, rtt) }))
      })
      return report
    },
    videoStatus: () => videoStatus,
    close() { if (closed) return; closed = true; peer.getReceivers().forEach(receiver => receiver.track.stop()); peer.close(); candidates = [] },
  }
}
