import { connectionNotice } from './connection-notice.mjs'

export async function createDirectSender(stream, message, bridge) {
  let closed = false, candidates = []
  const notice = connectionNotice(() => bridge.signal({ type: 'viewer-ready' }))
  const video = stream.getVideoTracks()[0]
  const connection = new RTCPeerConnection({ iceServers: message.iceServers, bundlePolicy: 'max-bundle' })
  try {
    connection.onicecandidate = ({ candidate }) => { if (!closed && candidate) bridge.signal({ type: 'candidate', candidate: candidate.toJSON() }) }
    connection.onconnectionstatechange = () => {
      if (closed) return
      if (connection.connectionState === 'connected') bridge.signal({ type: 'connected', relativeOnly: message.relativeOnly, localCursor: !!message.localCursor })
      if (['failed', 'disconnected'].includes(connection.connectionState)) bridge.failed()
    }
    const sender = connection.addTrack(video, stream)
    const transceiver = connection.getTransceivers().find((item) => item.sender === sender)
    const codecs = RTCRtpSender.getCapabilities('video')?.codecs
    const vp8 = codecs?.filter((codec) => codec.mimeType.toLowerCase() === 'video/vp8')
    if (!vp8?.length || !transceiver?.setCodecPreferences) throw new Error('VP8 직접 연결을 지원하지 않습니다.')
    transceiver.setCodecPreferences(vp8)
    function channel(label, options) {
      const data = connection.createDataChannel(label, options)
      data.onopen = () => { if (!closed) notice.opened(label) }
      data.onmessage = ({ data: raw }) => {
        if (closed) return
        if (typeof raw !== 'string' || raw.length > 16 * 1024) return bridge.fail(new Error('잘못된 원격 입력입니다.'))
        try {
          const value = JSON.parse(raw)
          if (label === 'control' && value.type === 'viewer-ready' && Object.keys(value).length === 1) notice.ready()
          else bridge.input(value, label === 'control')
        } catch (error) { bridge.fail(error) }
      }
      data.onclose = () => { if (!closed) bridge.failed() }
    }
    channel('motion', { ordered: false, maxRetransmits: 0 })
    channel('control', { ordered: true })
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)
    bridge.signal({ type: 'offer', sdp: connection.localDescription.sdp })
    // Bounded bitrate; Chromium handles actual hardware availability and congestion adaptation.
    const parameters = sender.getParameters()
    parameters.encodings ??= [{}]
    parameters.encodings[0].maxBitrate = 6_000_000
    parameters.encodings[0].maxFramerate = 60
    parameters.degradationPreference = 'maintain-framerate'
    await sender.setParameters(parameters)
    return {
      async signal(message) {
        if (closed) return
        if (message.type === 'answer') {
          await connection.setRemoteDescription({ type: 'answer', sdp: message.sdp })
          for (const candidate of candidates) await connection.addIceCandidate(candidate)
          candidates = []
        } else if (message.type === 'candidate') {
          if (connection.remoteDescription) await connection.addIceCandidate(message.candidate)
          else if (candidates.length < 128) candidates.push(message.candidate)
        }
      },
      close() { closed = true; notice.close(); connection.close(); candidates = [] },
    }
  } catch (error) { closed = true; notice.close(); connection.close(); throw error }
}
