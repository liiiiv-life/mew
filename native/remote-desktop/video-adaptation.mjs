/** Receiver deltas and our bounded RTP queue control the encoder and pacer together. */
export function videoAdaptation({ maximum = 6_000_000, priority = 'speed', change, keyframe, now = Date.now }) {
  let rate = maximum, last = -Infinity, increased = -Infinity, minimumRtt = Infinity, lastCongestion = -Infinity
  const set = value => { const next = Math.round(Math.max(350_000, Math.min(maximum, value))); if (next !== rate) { rate = next; change(rate) } }
  return {
    configure(value) { maximum = value; rate = value; minimumRtt = Infinity; lastCongestion = -Infinity; change(rate) },
    congested() { if (now() - lastCongestion < 200) return; lastCongestion = now(); set(rate * .8) },
    feedback(value) {
      for (const [key, limit] of [['loss', 1], ['delay', 10000], ['rtt', 10000], ['decode', 10000], ['received', 100000], ['decodedFrames', 100000]]) {
        if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > limit)) throw new Error('Invalid video feedback')
      }
      if (!Number.isFinite(value.loss) || !Number.isFinite(value.delay) || typeof value.decoded !== 'boolean') throw new Error('Invalid video feedback')
      const time = now(); if (time - last < 150) return false; last = time
      // A static desktop has no incoming frames. Do not mistake it for a decoder stall.
      if (!value.decoded || value.received > 0 && value.decodedFrames === 0) keyframe()
      if (value.rtt !== undefined) minimumRtt = Math.min(minimumRtt, value.rtt)
      if (value.loss > .02 || priority === 'speed' && value.delay > 40 || value.rtt > minimumRtt + 25) this.congested()
      else if (time - increased >= 500 && time - lastCongestion >= 1500 && value.received > 0 && value.decodedFrames > 0) { increased = time; set(rate * 1.04) }
      return true
    },
    rate() { return rate },
  }
}
