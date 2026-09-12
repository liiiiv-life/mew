const bridge = globalThis.desktopHost
let peer, stream, candidates = [], generation = 0
const fail = (error) => bridge.signal({ type: 'error', message: error instanceof Error ? error.message : '화면 전송에 실패했습니다.' })
function stop() { generation++; peer?.close(); stream?.getTracks().forEach((track) => track.stop()); peer = null; stream = null; candidates = [] }
async function start(message) {
  stop()
  const current = generation
  // desktopCapturer owns source selection and OS consent; a remote click has no renderer user activation.
  const captured = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: message.source, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60 } } })
  if (current !== generation) { captured.getTracks().forEach((track) => track.stop()); return }
  stream = captured
  const video = stream.getVideoTracks()[0]
  video.contentHint = 'detail'
  video.addEventListener('ended', () => { if (current === generation) { stop(); bridge.signal({ type: 'closed' }) } })
  const connection = new RTCPeerConnection({ iceServers: message.iceServers, bundlePolicy: 'max-bundle' })
  peer = connection
  connection.onicecandidate = ({ candidate }) => { if (candidate) bridge.signal({ type: 'candidate', candidate: candidate.toJSON() }) }
  connection.onconnectionstatechange = () => {
    if (current !== generation) return
    if (connection.connectionState === 'connected') bridge.signal({ type: 'connected', relativeOnly: message.relativeOnly })
    if (['failed', 'closed'].includes(connection.connectionState)) { stop(); bridge.signal({ type: 'closed' }) }
  }
  const sender = connection.addTrack(video, stream)
  const transceiver = connection.getTransceivers().find((item) => item.sender === sender)
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs
  if (codecs && transceiver?.setCodecPreferences) transceiver.setCodecPreferences([...codecs.filter((codec) => codec.mimeType === 'video/H264'), ...codecs.filter((codec) => codec.mimeType !== 'video/H264')])
  function channel(label, options) {
    const data = connection.createDataChannel(label, options)
    data.onmessage = ({ data: raw }) => {
      if (typeof raw !== 'string' || raw.length > 16 * 1024) return fail(new Error('잘못된 원격 입력입니다.'))
      try { bridge.input(JSON.parse(raw), label === 'control') } catch (error) { fail(error) }
    }
    data.onclose = () => { if (current === generation) { stop(); bridge.signal({ type: 'closed' }) } }
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
}
let signalQueue = Promise.resolve()
bridge.onSignal((message) => {
  signalQueue = signalQueue.then(async () => {
    if (message.type === 'stop') return stop()
    if (message.type === 'start') return start(message)
    if (!peer) return
    if (message.type === 'answer') {
      await peer.setRemoteDescription({ type: 'answer', sdp: message.sdp })
      for (const candidate of candidates) await peer.addIceCandidate(candidate)
      candidates = []
    } else if (message.type === 'candidate') {
      if (peer.remoteDescription) await peer.addIceCandidate(message.candidate)
      else candidates.push(message.candidate)
    }
  }).catch(fail)
})
bridge.ready()
