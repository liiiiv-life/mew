import { createNativeStream } from './native-stream.mjs'
import { createDirectSender } from './direct-sender.mjs'

const bridge = globalThis.desktopHost
let nativeSource, transport, stream, generation = 0, terminated = false
const fail = error => bridge.signal({ type: 'error', message: error instanceof Error ? error.message : '화면 전송에 실패했습니다.' })
function stop() { generation++; nativeSource?.close(); nativeSource = null; transport?.close(); stream?.getTracks().forEach(track => track.stop()); transport = null; stream = null }

async function start(message) {
  stop()
  const current = generation
  if (message.nativeCapture) {
    const source = await createNativeStream(bridge, fail)
    if (current !== generation) { source.close(); return }
    nativeSource = source
  }
  const captured = nativeSource?.stream ?? await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: message.source, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60 } } })
  if (current !== generation) { captured.getTracks().forEach(track => track.stop()); return }
  stream = captured
  const video = stream.getVideoTracks()[0]
  video.contentHint = 'detail'
  video.addEventListener('ended', () => { if (current === generation) { stop(); bridge.signal({ type: 'closed' }) } })
  // OS capture errors and direct transport failures end this connection.
  try {
    const next = await createDirectSender(stream, { ...message, localCursor: !!nativeSource }, {
      signal: value => { if (current === generation) { bridge.signal(value); if (value.type === 'connected') nativeSource?.refresh() } },
      input: (value, reliable) => { if (current === generation) bridge.input(value, reliable) },
      failed: () => { if (current === generation) bridge.signal({ type: 'direct-failed' }) },
      fail,
    })
    if (current !== generation) { next.close(); return }
    transport = next
    nativeSource?.refresh()
  } catch { if (current === generation) bridge.signal({ type: 'direct-failed' }) }
}

let signalQueue = Promise.resolve()
bridge.onSignal(message => {
  // Stop cancels pending capture/negotiation immediately, without waiting behind it.
  if (message.type === 'stop') { terminated = true; stop(); bridge.signal({ type: 'stopped' }); return }
  // A new selection belongs to a new connection (the browser test reuses this renderer).
  if (message.type === 'start') terminated = false
  signalQueue = signalQueue.then(async () => {
    if (terminated) return
    if (message.type === 'start') return start(message)
    await transport?.signal(message)
    if (message.type === 'answer') nativeSource?.refresh()
  }).catch(fail)
})
bridge.ready()
