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

/** One in-flight access unit; late reference frames recover at an IDR boundary. */
export function videoPacer({ send, keyframe, congested = () => {}, unsupported = () => {}, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout, ssrc, payload = 102, bitrate = 6_000_000, fps = 60, priority = 'speed' }) {
  let closed = false, current, timer, waitingKey = true, sps, pps, lastKey = -Infinity
  let rate = bitrate, lastTick = now(), credit = Math.max(2400, bitrate * 1.15 / 4000), maxAge = Math.max(24, 2000 / fps), drops = 0, queuePeak = 0
  const sequence = { next: randomBytes(2).readUInt16BE() }, timestampBase = randomBytes(4).readUInt32BE()
  let mode
  const requestKey = () => { if (now() - lastKey >= 200) { lastKey = now(); keyframe() } }
  const finish = () => { const done = current?.done; current = undefined; cancel(timer); timer = undefined; done?.() }
  const drop = () => { drops++; waitingKey = true; congested(); requestKey(); finish() }
  const tick = () => {
    timer = undefined
    if (closed || !current) return
    const time = now(), age = Math.max(0, time - current.at)
    queuePeak = Math.max(queuePeak, age)
    // Quality mode keeps encoder compression fixed. Waiting for this AU's ack
    // backpressures capture instead of abandoning frames at a two-frame deadline.
    const deadline = priority === 'quality' ? Math.min(2000, Math.max(500, current.bytes * 8000 / rate * 1.5 + 100)) : current.key ? 500 : maxAge
    if (age > deadline) { drop(); return }
    const bytesPerMs = rate * 1.15 / 8000, burst = Math.max(2400, bytesPerMs * 2)
    credit = Math.min(burst, credit + Math.max(0, time - lastTick) * bytesPerMs); lastTick = time
    try {
      while (current) {
        current.packet ??= current.packets.next().value
        if (!current.packet) { waitingKey = false; finish(); break }
        const cost = current.packet.length + 48 // UDP/IP/SRTP allowance; input/RTCP retain bandwidth.
        if (credit < cost) break
        credit -= cost
        if (!send(current.packet)) { drop(); break }
        current.packet = undefined
      }
    } catch { drop() }
    if (current) timer = schedule(tick, 1)
  }
  return {
    configure(value) { mode = value; priority = value.priority ?? priority; payload = value.payload; fps = value.fps; maxAge = Math.max(24, 2000 / fps); this.bitrate(value.bitrate); waitingKey = true; sps = pps = undefined },
    bitrate(value) { rate = Math.max(350_000, Math.min(50_000_000, value)) },
    frame(value, done = () => {}) {
      if (closed) { done(); return }
      if (current) { drop(); done(); return }
      const data = Buffer.isBuffer(value.data) ? value.data : Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength)
      if (!data.length || data.length > MAX_VIDEO_BYTES || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0) { waitingKey = true; requestKey(); done(); return }
      let nals = annexBNals(data)
      for (const nal of nals) {
        if ([7, 8].includes(nal[0] & 31) && nal.length > 65536) { waitingKey = true; done(); return }
        if ((nal[0] & 31) === 7) {
          if (mode && (nal.length < 4 || nal[1] !== (mode.profile === 'high' ? 100 : 66) || nal[3] > mode.level)) { waitingKey = true; done(); unsupported(); return }
          sps = Buffer.from(nal)
        }
        if ((nal[0] & 31) === 8) pps = Buffer.from(nal)
      }
      const key = nals.some(nal => (nal[0] & 31) === 5)
      if (!nals.length || waitingKey && !key) { requestKey(); done(); return }
      if (key) {
        if (!sps || !pps) { waitingKey = true; requestKey(); done(); return }
        nals = [sps, pps, ...nals.filter(nal => ![7, 8].includes(nal[0] & 31))]
      }
      const time = now()
      current = { at: time, bytes: nals.reduce((size, nal) => size + nal.length + Math.ceil(nal.length / 1178) * 62, 0), key, done, packets: h264Packets(nals, { ssrc, payload, timestamp: (timestampBase + Math.floor(value.timestamp * .09)) >>> 0, sequence }) }
      tick()
    },
    stats() { const queueMs = Math.max(queuePeak, current ? now() - current.at : 0); queuePeak = 0; return { queueMs: Math.round(queueMs), drops } },
    reset() { waitingKey = true; finish(); requestKey() },
    close() { closed = true; finish(); sps = pps = undefined },
  }
}
