import { RELAY_CODEC, packFrame, relayWindow } from './relay-protocol.mjs'

/** Owns only the encoder/reader; the session owns and reuses the capture track. */
export async function createRelaySender(track, { frame, fail }) {
  if (!globalThis.VideoEncoder || !globalThis.MediaStreamTrackProcessor) throw new Error('서버에서 압축 영상 전송을 지원하지 않습니다. Electron을 업데이트해 주세요.')
  const settings = track.getSettings(), scale = Math.min(1, 1920 / settings.width, 1080 / settings.height)
  const width = Math.max(2, Math.floor(settings.width * scale / 2) * 2), height = Math.max(2, Math.floor(settings.height * scale / 2) * 2)
  let bitrate = 2_500_000, stopped = false, seq = 0, encoding = 0, key = true, lastFrame = -Infinity, lastKey = -Infinity, lastAdjust = 0
  const config = () => ({ codec: RELAY_CODEC, width, height, bitrate, framerate: 30, latencyMode: 'realtime' })
  if (!(await VideoEncoder.isConfigSupported(config())).supported) throw new Error('서버에서 VP8 영상 압축을 지원하지 않습니다.')
  const window = relayWindow(), processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }), reader = processor.readable.getReader()
  const encoder = new VideoEncoder({
    output(chunk) {
      if (stopped) return
      encoding--
      try {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data)
        const packet = packFrame({ seq: ++seq, timestamp: chunk.timestamp, width, height, key: chunk.type === 'key' }, data)
        window.sent(seq, packet.byteLength); frame(packet)
      } catch (error) { fail(error) }
    },
    error: fail,
  })
  encoder.configure(config())
  const watchdog = setInterval(() => { if (window.expired()) fail(new Error('영상 수신이 멈췄습니다. 네트워크를 확인한 뒤 다시 연결해 주세요.')) }, 1000)
  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read()
        if (done) break
        try {
          // Drop before encoding, so inter-frame dependencies remain intact.
          if (stopped || encoding || encoder.encodeQueueSize || !window.available() || value.timestamp - lastFrame < 33_333) continue
          const keyFrame = key || value.timestamp - lastKey >= 2_000_000
          encoding++; encoder.encode(value, { keyFrame }); lastFrame = value.timestamp
          if (keyFrame) { key = false; lastKey = value.timestamp }
        } finally { value.close() }
      }
    } catch (error) { if (!stopped) fail(error) }
  })()
  return {
    ack(value) {
      const elapsed = window.ack(value.seq)
      if (value.keyframe) key = true
      const now = Date.now()
      if (elapsed !== null && now - lastAdjust > 2000) {
        const next = Math.round(Math.max(350_000, Math.min(4_000_000, bitrate * (elapsed > 220 ? .75 : elapsed < 90 ? 1.1 : 1))))
        if (next !== bitrate) { bitrate = next; encoder.configure(config()); key = true }
        lastAdjust = now
      }
    },
    close() { if (stopped) return; stopped = true; clearInterval(watchdog); void reader.cancel().catch(() => {}); if (encoder.state !== 'closed') encoder.close() },
  }
}
