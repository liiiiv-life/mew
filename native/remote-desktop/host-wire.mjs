import { MAX_FRAME_BYTES } from './relay-protocol.mjs'
import { MAX_SIGNAL_BYTES } from './protocol.mjs'

export function hostFrame(packet) {
  if (packet.byteLength > MAX_FRAME_BYTES) throw new Error('Desktop frame too large')
  return Buffer.concat([Buffer.from(`MEW_DESKTOP_FRAME ${packet.byteLength}\n`), packet])
}

/** Mixed text diagnostics and length-delimited binary frames, across arbitrary pipe splits. */
export function hostReader(onMessage, onFrame) {
  let pending = Buffer.alloc(0), length = 0
  return (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk)
    while (pending.length) {
      if (length) {
        if (pending.length < length) return
        const frame = pending.subarray(0, length); pending = pending.subarray(length); length = 0
        onFrame(frame); continue
      }
      const end = pending.indexOf(10)
      if (end < 0) { if (pending.length > MAX_SIGNAL_BYTES) throw new Error('Desktop response too large'); return }
      if (end > MAX_SIGNAL_BYTES) throw new Error('Desktop response too large')
      const line = pending.subarray(0, end).toString('utf8'); pending = pending.subarray(end + 1)
      if (line.startsWith('MEW_DESKTOP_FRAME ')) {
        if (!/^MEW_DESKTOP_FRAME [1-9][0-9]{0,6}$/.test(line)) throw new Error('Invalid desktop frame header')
        length = Number(line.slice(18))
        if (length > MAX_FRAME_BYTES) throw new Error('Desktop frame too large')
      } else if (line.startsWith('MEW_DESKTOP ')) onMessage(JSON.parse(line.slice(12)))
    }
  }
}
