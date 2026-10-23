/** Receiver deltas and our bounded RTP queue control the encoder and pacer together. */
export function videoAdaptation({ maximum = 6_000_000, priority = 'speed', change, keyframe, now = Date.now }) {
  let rate = maximum, last = -Infinity, recoveryAt = -Infinity, minimumRtt = Infinity, minimumDelay = Infinity, lastCongestion = -Infinity, localCongestion = -Infinity, rttStep
  const set = value => { const next = Math.round(Math.max(350_000, Math.min(maximum, value))); if (next !== rate) { rate = next; change(rate) } }
  return {
    configure(value) { maximum = value; rate = value; last = recoveryAt = -Infinity; minimumRtt = minimumDelay = Infinity; lastCongestion = localCongestion = -Infinity; rttStep = undefined; change(rate) },
    congested(local = true) {
      const time = now()
      if (local) localCongestion = time
      if (time - lastCongestion < 200) return
      lastCongestion = recoveryAt = time; set(rate * .8)
    },
    feedback(value) {
      for (const [key, limit] of [['loss', 1], ['delay', 10000], ['rtt', 10000], ['decode', 10000], ['received', 100000], ['decodedFrames', 100000]]) {
        if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > limit)) throw new Error('Invalid video feedback')
      }
      if (!Number.isFinite(value.loss) || !Number.isFinite(value.delay) || typeof value.decoded !== 'boolean') throw new Error('Invalid video feedback')
      const time = now(); if (time - last < 150) return false; last = time
      // A static desktop has no incoming frames. Do not mistake it for a decoder stall.
      if (!value.decoded || value.received > 0 && value.decodedFrames === 0) keyframe()
      if (value.rtt !== undefined) minimumRtt = Math.min(minimumRtt, value.rtt)
      // Without frame counters, positive interval delay means the buffer emitted video.
      const progressing = value.decoded && (value.received > 0 && value.decodedFrames > 0 ||
        value.received === undefined && value.decodedFrames === undefined && value.delay > 0)
      const bufferGrowth = progressing && value.delay > minimumDelay + (priority === 'quality' ? 80 : 40)
      const elevatedRtt = value.rtt > minimumRtt + 25
      let growingRtt = false
      if (elevatedRtt) {
        if (!rttStep) { rttStep = { value: value.rtt, since: time }; growingRtt = true }
        else if (value.rtt > rttStep.value + 5) {
          growingRtt = true
          rttStep = { value: value.rtt, since: time }
        }
        // A stable path change should not cut quality every feedback interval.
        // Loss, receiver-buffer growth and local overflow still take precedence.
        if (progressing && value.loss <= .02 && !bufferGrowth && time - rttStep.since >= 2000 && time - localCongestion >= 2000) {
          minimumRtt = value.rtt; rttStep = undefined
        }
      } else rttStep = undefined
      const networkCongested = value.loss > .02 || growingRtt
      // The receiver can keep a fixed playout buffer on a healthy connection.
      // Learn its floor only from progressing video, never an idle zero delta.
      if (progressing && !networkCongested && !elevatedRtt) minimumDelay = Math.min(minimumDelay, value.delay)
      if (networkCongested || bufferGrowth) this.congested(false)
      else if (progressing && !rttStep && time - lastCongestion >= 1500) {
        // Integrate 25%/s plus 5% of the requested ceiling per second. Limit a
        // single observation to 500ms so idle gaps cannot cause a probing burst.
        const elapsed = Math.max(0, Math.min(500, time - Math.max(recoveryAt, lastCongestion + 1000))) / 1000
        set((rate + maximum * .2) * Math.exp(.25 * elapsed) - maximum * .2)
        recoveryAt = time
      } else recoveryAt = time
      return true
    },
    rate() { return rate },
  }
}
