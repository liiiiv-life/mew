import { uiText } from '@mew/ui/i18n-core'
import { RELAY_CODEC, MAX_IN_FLIGHT, readFrame } from '../../native/remote-desktop/relay-protocol.mjs'

export async function desktopRelayReceiver({ display, acknowledge, ready, fail }: {
  display: (frame: VideoFrame) => void
  acknowledge: (seq: number, keyframe?: boolean) => void
  ready: () => void
  fail: (message: string) => void
}) {
  const config: VideoDecoderConfig = { codec: RELAY_CODEC, optimizeForLatency: true }
  if (!globalThis.VideoDecoder || !(await VideoDecoder.isConfigSupported(config)).supported) throw new Error(uiText("이 브라우저는 서버 영상 연결에 필요한 VP8 재생을 지원하지 않습니다. 최신 브라우저로 접속해 주세요."))
  let decoder: VideoDecoder, closed = false, waitingKey = true, first = true, latest: { frame: VideoFrame; seq: number } | undefined
  let idle = false, idleSeq = 0, lastStatus = 0, displayedSeq = 0
  let animation = 0, lastSeq = 0, bytes = 0, recoveries = 0, lastFrame = Date.now()
  const sequences = new Map<number, number>()
  const reset = () => {
    sequences.clear(); waitingKey = true
    if (decoder?.state !== 'closed') decoder?.close()
    decoder = new VideoDecoder({
      output(frame) {
        const seq = sequences.get(frame.timestamp)
        sequences.delete(frame.timestamp)
        if (closed || seq === undefined) { frame.close(); return }
        latest?.frame.close(); latest = { frame, seq }
        if (animation) return
        animation = requestAnimationFrame(() => {
          animation = 0
          const current = latest; latest = undefined
          if (!current) return
          try {
            display(current.frame); lastFrame = Date.now(); displayedSeq = current.seq
            acknowledge(current.seq)
            if (first) { first = false; ready() }
          } catch { fail(uiText("원격 화면을 표시하지 못했습니다. 다시 연결해 주세요.")) }
          finally { current.frame.close() }
        })
      },
      error() {
        if (closed) return
        if (++recoveries > 2) { fail(uiText("압축 영상을 재생하지 못했습니다. 브라우저를 업데이트한 뒤 다시 연결해 주세요.")); return }
        latest?.frame.close(); latest = undefined; cancelAnimationFrame(animation); animation = 0
        reset(); acknowledge(lastSeq, true)
      },
    })
    decoder.configure(config)
  }
  reset()
  const watchdog = setInterval(() => { if (Date.now() - lastFrame > 15_000 && !(idle && displayedSeq === idleSeq && Date.now() - lastStatus < 3000)) fail(uiText("서버 영상 수신이 멈췄습니다. 네트워크를 확인한 뒤 다시 연결해 주세요.")) }, 1000)
  return {
    status(value: Record<string, unknown>) {
      if (!Number.isSafeInteger(value.seq) || Number(value.seq) < 0 || Number(value.seq) > lastSeq || typeof value.idle !== 'boolean') throw new Error('Invalid video status')
      idle = value.idle; idleSeq = Number(value.seq); lastStatus = Date.now()
    },
    packet(packet: ArrayBuffer) {
      if (closed) return
      const frame = readFrame(new Uint8Array(packet))
      if (frame.seq !== lastSeq + 1) throw new Error(uiText("영상 전송 순서가 잘못됐습니다. 다시 연결해 주세요."))
      idle = false; lastSeq = frame.seq; bytes += packet.byteLength
      if (waitingKey && !frame.key) { acknowledge(frame.seq, true); return }
      if (decoder.decodeQueueSize >= MAX_IN_FLIGHT || sequences.size >= MAX_IN_FLIGHT) throw new Error(uiText("영상 재생이 지연됐습니다. 다시 연결해 주세요."))
      waitingKey = false; sequences.set(frame.timestamp, frame.seq)
      decoder.decode(new EncodedVideoChunk({ type: frame.key ? 'key' : 'delta', timestamp: frame.timestamp, data: frame.data as Uint8Array<ArrayBuffer> }))
    },
    get bytes() { return bytes },
    close() { if (closed) return; closed = true; clearInterval(watchdog); cancelAnimationFrame(animation); latest?.frame.close(); latest = undefined; sequences.clear(); if (decoder.state !== 'closed') decoder.close() },
  }
}
