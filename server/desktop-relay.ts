import { WebSocket } from 'ws'
import { validSnapshot } from '../native/remote-desktop/protocol.mjs'
import { MAX_FRAME_BYTES, readFrame, relayWindow } from '../native/remote-desktop/relay-protocol.mjs'

/** The server forwards compressed bytes; it never creates a codec or a media file. */
export function desktopRelay(ws: WebSocket, write: (message: unknown) => void) {
  const window = relayWindow()
  let lastSeq = 0, active = false, rateAt = Date.now(), rateCount = 0
  return {
    get active() { return active },
    start() {
      if (active) throw new Error('Duplicate desktop transport switch')
      active = true; write({ type: 'relay' })
    },
    accept(message: Record<string, unknown>) {
      if (!active) throw new Error('Desktop relay is not active')
      if (Date.now() - rateAt > 1000) { rateAt = Date.now(); rateCount = 0 }
      if (++rateCount > 240) throw new Error('Too many desktop messages')
      if (message.type === 'frame-ack') {
        if (message.keyframe !== undefined && typeof message.keyframe !== 'boolean') throw new Error('Invalid key frame request')
        window.ack(message.seq as number)
        write({ type: 'frame-ack', seq: message.seq, keyframe: message.keyframe === true })
      } else if (message.type === 'relay-input') {
        const value = message.value as Record<string, unknown> | undefined
        const paste = message.reliable === true && value?.type === 'paste' && typeof value.text === 'string' && value.text.length <= 4096
        if (typeof message.reliable !== 'boolean' || !paste && !validSnapshot(value) || JSON.stringify(value).length > 16 * 1024) throw new Error('Invalid desktop input')
        write({ type: 'relay-input', value, reliable: message.reliable })
      } else throw new Error('Invalid desktop relay message')
    },
    status(message: Record<string, unknown>) {
      if (!active || !Number.isSafeInteger(message.seq) || Number(message.seq) !== lastSeq || typeof message.idle !== 'boolean'
        || !Number.isFinite(message.ackMs) || Number(message.ackMs) < 0 || Number(message.ackMs) > 60_000
        || !Number.isFinite(message.bitrate) || Number(message.bitrate) < 350_000 || Number(message.bitrate) > 4_000_000) throw new Error('Invalid relay status')
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    },
    frame(packet: Buffer) {
      if (!active) throw new Error('Unexpected desktop frame')
      const frame = readFrame(packet)
      window.sent(frame.seq, packet.byteLength); lastSeq = frame.seq
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_FRAME_BYTES * 2) throw new Error('Desktop video connection is congested')
      ws.send(packet, { binary: true })
    },
  }
}
