import { randomBytes } from 'node:crypto'
import { MAX_VIDEO_BYTES } from './video-settings.mjs'

export function annexBNals(data) {
  const starts = []
  for (let i = 0; i + 3 <= data.length; i++) {
    if (data[i] || data[i + 1]) continue
    const length = data[i + 2] === 1 ? 3 : data[i + 2] === 0 && data[i + 3] === 1 ? 4 : 0
    if (length) { starts.push([i, i + length]); i += length - 1 }
  }
  return starts.map(([, begin], i) => data.subarray(begin, starts[i + 1]?.[0] ?? data.length)).filter(nal => nal.length)
}

/** RFC 6184 single NAL / FU-A. Allocate packets lazily, below the ICE MTU. */
export function* h264Packets(nals, { ssrc, payload, timestamp, sequence }) {
  const header = (size, marker) => {
    const packet = Buffer.allocUnsafe(12 + size)
    packet[0] = 0x80; packet[1] = payload | (marker ? 0x80 : 0)
    packet.writeUInt16BE(sequence.next++ & 0xffff, 2); packet.writeUInt32BE(timestamp >>> 0, 4); packet.writeUInt32BE(ssrc >>> 0, 8)
    return packet
  }
  for (let i = 0; i < nals.length; i++) {
    const nal = nals[i], last = i === nals.length - 1
    if (nal.length <= 1180) { const packet = header(nal.length, last); nal.copy(packet, 12); yield packet; continue }
    for (let offset = 1; offset < nal.length;) {
      const size = Math.min(1178, nal.length - offset), end = offset + size === nal.length
      const packet = header(size + 2, last && end)
      packet[12] = (nal[0] & 0xe0) | 28; packet[13] = (nal[0] & 31) | (offset === 1 ? 0x80 : 0) | (end ? 0x40 : 0)
      nal.copy(packet, 14, offset, offset + size); offset += size; yield packet
    }
  }
}

/** One sending and one pending access unit; preserve their reference order. */
export function videoPacer({ send, keyframe, congested = () => {}, unsupported = () => {}, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout, ssrc, payload = 102, bitrate = 6_000_000, fps = 60, priority = 'speed' }) {
  let closed = false, ticking = false, current, queued, timer, waitingKey = true, sps, pps, lastKey = -Infinity
  const burstBytes = value => Math.max(2 * (1192 + 48), value * 1.15 / 8000 * 5)
  let rate = bitrate, lastTick = now(), credit = burstBytes(bitrate), maxAge = Math.max(priority === 'quality' ? 100 : 24, 2000 / fps), drops = 0, queuePeak = 0
  const sequence = { next: randomBytes(2).readUInt16BE() }, timestampBase = randomBytes(4).readUInt32BE()
  let sampleAt = now(), frames = 0, bytes = 0, frameBytes = 0, sendMs = 0, pollMs = 0, backpressureMs = 0, encodeMs, captureMs, encoderOptions, encoderBitrate
  let mode
  const requestKey = () => { if (now() - lastKey >= 200) { lastKey = now(); keyframe() } }
  const clear = () => {
    const old = [current, queued]; current = queued = undefined; cancel(timer); timer = undefined
    for (const frame of old) frame?.done()
  }
  const finish = () => {
    const old = current
    sendMs = Math.max(sendMs, now() - old.started)
    current = queued; queued = undefined
    if (current) current.started = now()
    old.done()
  }
  const drop = () => { drops += (current ? 1 : 0) + (queued ? 1 : 0); waitingKey = true; congested(); requestKey(); clear() }
  const tick = () => {
    if (ticking) return
    timer = undefined
    if (closed || !current) return
    ticking = true
    const time = now()
    // Tolerate short timer delays while retaining a finite burst across frames.
    const bytesPerMs = rate * 1.15 / 8000, burst = burstBytes(rate)
    credit = Math.min(burst, credit + Math.max(0, time - lastTick) * bytesPerMs); lastTick = time
    try {
      while (current) {
        const age = Math.max(0, time - current.at)
        queuePeak = Math.max(queuePeak, age)
        if (age > (current.key ? 500 : maxAge)) { drop(); break }
        current.packet ??= current.packets.next().value
        if (!current.packet) { waitingKey = false; finish(); continue }
        const cost = current.packet.length + 48 // UDP/IP/SRTP allowance; input/RTCP retain bandwidth.
        if (credit < cost) break
        credit -= cost
        if (!send(current.packet)) { drop(); break }
        current.packet = undefined
      }
    } catch { drop() }
    finally { ticking = false }
    if (current) timer = schedule(tick, 1)
  }
  return {
    configure(value) { mode = value; priority = value.priority ?? priority; payload = value.payload; fps = value.fps; maxAge = Math.max(priority === 'quality' ? 100 : 24, 2000 / fps); this.bitrate(value.bitrate); waitingKey = true; sps = pps = undefined },
    bitrate(value) { rate = Math.max(350_000, Math.min(50_000_000, value)) },
    frame(value, done = () => {}) {
      if (closed) { done(); return }
      if (current && queued) { drop(); done(); return }
      const reject = () => { waitingKey = true; clear(); requestKey(); done() }
      const data = Buffer.isBuffer(value.data) ? value.data : Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength)
      if (!data.length || data.length > MAX_VIDEO_BYTES || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0) { reject(); return }
      let nals = annexBNals(data)
      for (const nal of nals) {
        if ([7, 8].includes(nal[0] & 31) && nal.length > 65536) { reject(); return }
        if ((nal[0] & 31) === 7) {
          if (mode && (nal.length < 4 || nal[1] !== (mode.profile === 'high' ? 100 : 66) || nal[3] > mode.level)) { reject(); unsupported(); return }
          sps = Buffer.from(nal)
        }
        if ((nal[0] & 31) === 8) pps = Buffer.from(nal)
      }
      const key = nals.some(nal => (nal[0] & 31) === 5)
      if (!nals.length) { reject(); return }
      if (waitingKey && !key && !current?.key) { requestKey(); done(); return }
      if (key) {
        if (!sps || !pps) { reject(); return }
        nals = [sps, pps, ...nals.filter(nal => ![7, 8].includes(nal[0] & 31))]
      }
      const time = now()
      const ipcMs = Number.isFinite(value.producedAt) ? Math.max(0, Math.min(10000, performance.timeOrigin + time - value.producedAt)) : 0
      const frame = { at: time - ipcMs, started: time, key, done, packets: h264Packets(nals, { ssrc, payload, timestamp: (timestampBase + Math.floor(value.timestamp * .09)) >>> 0, sequence }) }
      frames++; bytes += data.length; frameBytes = Math.max(frameBytes, data.length)
      if (Number.isInteger(value.encoderOptions) && value.encoderOptions >= 0 && value.encoderOptions <= 63) encoderOptions = value.encoderOptions
      if (Object.hasOwn(value, 'encoderBitrate')) encoderBitrate = Number.isInteger(value.encoderBitrate) && value.encoderBitrate >= 350000 && value.encoderBitrate <= 50000000 ? value.encoderBitrate : undefined
      for (const field of ['encodeMs', 'captureMs', 'pollMs', 'backpressureMs']) {
        if (!Number.isFinite(value[field]) || value[field] < 0 || value[field] > 10000) continue
        if (field === 'encodeMs') encodeMs = Math.max(encodeMs ?? 0, value[field])
        else if (field === 'captureMs') captureMs = Math.max(captureMs ?? 0, value[field])
        else if (field === 'pollMs') pollMs = Math.max(pollMs, value[field])
        else backpressureMs = Math.max(backpressureMs, value[field])
      }
      if (current) queued = frame
      else { current = frame; tick() }
    },
    sendingKeyframe() { return current?.key === true || queued?.key === true },
    stats() {
      const time = now(), elapsed = time - sampleAt
      const result = { queueMs: Math.round(Math.max(queuePeak, current ? time - current.at : 0, queued ? time - queued.at : 0)), drops,
        pendingFrames: Number(!!current) + Number(!!queued), frameBytes, sendMs: Math.round(sendMs), pollMs: Math.round(pollMs), backpressureMs: Math.round(backpressureMs),
        ...(elapsed > 0 ? { encodedFps: Math.round(frames * 1000 / elapsed), encodedMbps: Math.round(bytes * 8 / elapsed) / 1000 } : {}),
        ...(encodeMs !== undefined ? { encodeMs: Math.round(encodeMs) } : {}), ...(captureMs !== undefined ? { captureMs: Math.round(captureMs) } : {}),
        ...(encoderOptions !== undefined ? { encoderOptions } : {}), ...(encoderBitrate !== undefined ? { encoderBitrate } : {}) }
      queuePeak = frames = bytes = frameBytes = sendMs = pollMs = backpressureMs = 0; encodeMs = captureMs = undefined; sampleAt = time
      return result
    },
    reset() { waitingKey = true; clear(); requestKey() },
    close() { closed = true; clear(); sps = pps = undefined },
  }
}
