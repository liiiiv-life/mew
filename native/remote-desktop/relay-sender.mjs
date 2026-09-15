import { RELAY_CODEC, packFrame, relayWindow } from './relay-protocol.mjs'
import { relayAdaptation } from './relay-adaptation.mjs'

/** One pending raw frame; encoded delta dependencies are never discarded. */
export async function createRelaySender(track, { frame, fail, status = () => {}, idle = () => false, refresh = () => {} }) {
  if (!globalThis.VideoEncoder || !globalThis.MediaStreamTrackProcessor) throw new Error('서버에서 압축 영상 전송을 지원하지 않습니다. Electron을 업데이트해 주세요.')
  const settings = track.getSettings(), scale = Math.min(1, 1920 / settings.width, 1080 / settings.height)
  const width = Math.max(2, Math.floor(settings.width * scale / 2) * 2), height = Math.max(2, Math.floor(settings.height * scale / 2) * 2)
  const adaptation = relayAdaptation(), window = relayWindow(() => performance.now())
  let stopped = false, seq = 0, encoding = 0, key = true, lastFrame = -Infinity, lastKey = -Infinity, pending, timer
  const config = () => ({ codec: RELAY_CODEC, width, height, bitrate: adaptation.bitrate, framerate: 30, latencyMode: 'realtime' })
  if (!(await VideoEncoder.isConfigSupported(config())).supported) throw new Error('서버에서 VP8 영상 압축을 지원하지 않습니다.')
  const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }), reader = processor.readable.getReader()
  const pump = () => {
    clearTimeout(timer)
    if (stopped || !pending || encoding || encoder.encodeQueueSize || !window.available()) return
    const wait = 1000 / 30 - (performance.now() - lastFrame)
    if (wait > 0) { timer = setTimeout(pump, wait); return }
    const value = pending; pending = undefined
    try {
      const now = performance.now(), keyFrame = key || now - lastKey >= 10_000
      encoding++; encoder.encode(value, { keyFrame }); lastFrame = now
      if (keyFrame) { key = false; lastKey = now }
    } catch (error) { fail(error) }
    finally { value.close() }
  }
  const encoder = new VideoEncoder({
    output(chunk) {
      if (stopped) return
      encoding--
      try {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data)
        const packet = packFrame({ seq: ++seq, timestamp: chunk.timestamp, width, height, key: chunk.type === 'key' }, data)
        window.sent(seq, packet.byteLength); frame(packet); pump()
      } catch (error) { fail(error) }
    },
    error: fail,
  })
  encoder.configure(config())
  const watchdog = setInterval(() => {
    if (window.expired()) { fail(new Error('영상 수신이 멈췄습니다. 네트워크를 확인한 뒤 다시 연결해 주세요.')); return }
    status({ type: 'relay-status', seq, idle: seq > 0 && idle() && !pending && !encoding && window.count === 0, ackMs: adaptation.ackMs, bitrate: adaptation.bitrate })
  }, 1000)
  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done) break
        if (stopped) { value.close(); break }
        pending?.close(); pending = value; pump()
      }
    } catch (error) { if (!stopped) fail(error) }
  })()
  refresh()
  return {
    ack(value) {
      const bytes = window.bytes, elapsed = window.ack(value.seq)
      if (value.keyframe) { key = true; refresh() }
      if (elapsed !== null && adaptation.sample(elapsed, bytes) !== null) { encoder.configure(config()); key = true }
      pump()
    },
    close() { if (stopped) return; stopped = true; clearTimeout(timer); clearInterval(watchdog); pending?.close(); pending = undefined; void reader.cancel().catch(() => {}); if (encoder.state !== 'closed') encoder.close() },
  }
}
