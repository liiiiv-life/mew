/** Pull-based native capture -> bounded 1080p canvas track, shared by both transports. */
export async function createNativeStream(bridge, fail) {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { alpha: false })
  if (!context || !globalThis.VideoFrame) throw new Error('네이티브 화면 변환을 지원하지 않습니다.')
  let closed = false, timer, lastChange = performance.now(), lastResponse = performance.now(), track
  const draw = packet => {
    lastResponse = performance.now()
    if (!packet.pixels) return
    const { width, height, pixels } = packet
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4096 * 2160 || pixels.byteLength !== width * height * 4) throw new Error('잘못된 네이티브 화면입니다.')
    const ratio = Math.min(1, 1920 / width, 1080 / height)
    const w = Math.max(2, Math.floor(width * ratio / 2) * 2), h = Math.max(2, Math.floor(height * ratio / 2) * 2)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const frame = new VideoFrame(pixels, { format: 'BGRX', codedWidth: width, codedHeight: height, timestamp: Math.round(performance.now() * 1000) })
    try { context.drawImage(frame, 0, 0, w, h); lastChange = performance.now(); track?.requestFrame() }
    finally { frame.close() }
  }
  draw(await bridge.capture())
  const stream = canvas.captureStream(0); track = stream.getVideoTracks()[0]; track.requestFrame()
  const poll = async () => {
    const start = performance.now()
    try {
      const packet = await bridge.capture()
      if (closed) return
      draw(packet)
      timer = setTimeout(poll, Math.max(0, 1000 / 60 - (performance.now() - start)))
    } catch (error) { if (!closed) fail(error) }
  }
  timer = setTimeout(poll, 0)
  return {
    stream,
    refresh() { if (!closed) { track.requestFrame(); context.drawImage(canvas, 0, 0) } },
    get idle() { const now = performance.now(); return !closed && now - lastResponse < 2000 && now - lastChange > 500 },
    close() { closed = true; clearTimeout(timer); stream.getTracks().forEach(t => t.stop()) },
  }
}
