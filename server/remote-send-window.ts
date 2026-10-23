export class RemoteSendWindow {
  private available: number
  private closed = false
  private wake?: () => void
  private maximum: number
  constructor(initial: number, maximum: number) { this.available = initial; this.maximum = maximum }
  async take() {
    while (!this.available) {
      if (this.closed) throw new Error('cancelled')
      await new Promise<void>(resolve => { this.wake = resolve })
    }
    if (this.closed) throw new Error('cancelled')
    this.available--
  }
  grant(count: number) {
    if (this.closed) return
    if (!Number.isSafeInteger(count) || count < 1 || this.available + count > this.maximum) throw new Error('credit-limit')
    this.available += count
    this.wake?.(); this.wake = undefined
  }
  close() { this.closed = true; this.wake?.(); this.wake = undefined }
}
