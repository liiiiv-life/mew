import { REMOTE_LIMITS } from '../../shared/remote-access.ts'

export class RemoteReceiveWindow {
  private outstanding = REMOTE_LIMITS.responseWindow
  private active = false
  private closed = false
  private cost = 0
  private timer?: ReturnType<typeof setTimeout>
  private maximum: number
  private roundTripMs: number
  private queued: () => number
  private grant: (count: number) => void
  constructor(maximum: number, roundTripMs: number, queued: () => number, grant: (count: number) => void) { this.maximum = maximum; this.roundTripMs = roundTripMs; this.queued = queued; this.grant = grant }
  take() { if (this.closed || !this.outstanding) throw new Error('response-limit'); this.outstanding-- }
  consumed(milliseconds: number, active = true) {
    this.cost = this.cost ? this.cost * 0.875 + milliseconds * 0.125 : milliseconds
    if (active) this.active = true
    this.refresh()
  }
  activate() { this.active = true; this.refresh() }
  private target() {
    const latency = Math.ceil(Math.max(1, this.roundTripMs) / 5) * REMOTE_LIMITS.responseWindow
    const work = this.cost > 0 ? Math.floor(8 / this.cost) : this.maximum
    return Math.max(REMOTE_LIMITS.responseWindow, Math.min(this.maximum, latency, work))
  }
  refresh() {
    if (this.closed || !this.active || this.timer !== undefined) return
    const target = this.target(), count = Math.max(0, target - this.outstanding - this.queued())
    if (!count || this.outstanding > Math.floor(target / 2)) return
    // One yield per consumed batch lets UI and sibling streams run before replenishing.
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.closed) return
      const count = Math.max(0, this.target() - this.outstanding - this.queued())
      if (count) { this.outstanding += count; this.grant(count) }
    }, 0)
  }
  close() { this.closed = true; clearTimeout(this.timer); this.timer = undefined }
}
