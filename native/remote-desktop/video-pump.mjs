/** Overlap native encoding with sending, with at most two transferred access units. */
export function videoPump({ read, write, failed, interval = () => 2, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout }) {
  let active = false, pumping = false, timer, serial = 0, blockedAt, pollMs = 0, backpressureMs = 0
  const outstanding = new Map()
  const blocked = () => outstanding.size >= 2 || [...outstanding.values()].some(Boolean)
  const wake = () => {
    if (pumping) return
    cancel(timer); timer = undefined
    if (!active || blocked()) return
    pumping = true
    try {
      const began = now(), frame = read()
      pollMs = Math.max(pollMs, now() - began)
      if (frame) {
        const frameId = ++serial
        outstanding.set(frameId, frame.key === true)
        write({ ...frame, frameId, producedAt: performance.timeOrigin + now(), pollMs, backpressureMs })
        pollMs = backpressureMs = 0
      }
    } catch (error) { active = false; failed(error) }
    finally {
      pumping = false
      if (active && !blocked()) timer = schedule(wake, interval())
      else if (active) blockedAt = now()
    }
  }
  return {
    start() { this.stop(); active = true; wake() },
    ack(id) {
      if (!active || !outstanding.delete(id)) return
      if (blockedAt !== undefined) { backpressureMs = Math.max(backpressureMs, now() - blockedAt); blockedAt = undefined }
      wake()
    },
    stop() { active = false; cancel(timer); timer = undefined; outstanding.clear(); blockedAt = undefined; pollMs = backpressureMs = 0 },
  }
}
