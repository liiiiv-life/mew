// Browser/Node shared wire contract. Network byte order; encoded VP8 stays binary.
export const RELAY_CODEC = 'vp8'
export const FRAME_HEADER = 24
export const MAX_FRAME_BYTES = 1024 * 1024
export const MAX_IN_FLIGHT = 4
const MAGIC = 0x4d445631 // MDV1

export function readFrame(packet) {
  if (!(packet instanceof Uint8Array) || packet.byteLength <= FRAME_HEADER || packet.byteLength > MAX_FRAME_BYTES) throw new Error('Invalid desktop frame length')
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
  if (view.getUint32(0) !== MAGIC || view.getUint8(20) > 1 || view.getUint8(21) || view.getUint16(22)) throw new Error('Invalid desktop frame version')
  const seq = view.getUint32(4), timestamp = view.getFloat64(8), width = view.getUint16(16), height = view.getUint16(18)
  if (!seq || !Number.isSafeInteger(timestamp) || timestamp < 0 || !width || !height || width > 1920 || height > 1080) throw new Error('Invalid desktop frame metadata')
  return { seq, timestamp, width, height, key: view.getUint8(20) === 1, data: packet.subarray(FRAME_HEADER) }
}

export function packFrame({ seq, timestamp, width, height, key }, data) {
  if (!Number.isInteger(seq) || seq < 1 || seq > 0xffff_ffff) throw new Error('Invalid desktop frame sequence')
  const packet = new Uint8Array(FRAME_HEADER + data.byteLength), view = new DataView(packet.buffer)
  view.setUint32(0, MAGIC); view.setUint32(4, seq); view.setFloat64(8, timestamp)
  view.setUint16(16, width); view.setUint16(18, height); view.setUint8(20, key ? 1 : 0)
  packet.set(data, FRAME_HEADER)
  readFrame(packet)
  return packet
}

/** Display acknowledgements bound every downstream queue, including Electron IPC. */
export function relayWindow(now = Date.now) {
  const pending = new Map()
  let bytes = 0, last = 0, acknowledged = 0
  return {
    available() { return pending.size < MAX_IN_FLIGHT && bytes < MAX_FRAME_BYTES },
    sent(seq, size) {
      if (!this.available() || seq !== last + 1 || size <= 0 || size > MAX_FRAME_BYTES) throw new Error('Desktop relay window exceeded')
      pending.set(seq, { at: now(), size }); bytes += size; last = seq
    },
    ack(seq) {
      if (!Number.isSafeInteger(seq) || seq < 0 || seq > last) throw new Error('Invalid desktop acknowledgement')
      if (seq <= acknowledged) return null
      const sample = pending.get(seq), elapsed = sample ? now() - sample.at : null
      for (const [id, item] of pending) if (id <= seq) { bytes -= item.size; pending.delete(id) }
      acknowledged = seq
      return elapsed
    },
    expired() { const first = pending.values().next().value; return !!first && now() - first.at > 10_000 },
    get count() { return pending.size },
    get bytes() { return bytes },
  }
}
