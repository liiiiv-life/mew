import { REMOTE_LIMITS } from '../../shared/remote-access.ts'

type Kind = 'request' | 'socket'
type Waiter = { kind: Kind; start(): void; stop(error: Error): void }
export class RemoteStreamSlots {
  private active = { request: 0, socket: 0 }
  private separate = false
  private closed = false
  private waiting: Waiter[] = []

  acquire(signal?: AbortSignal, kind: Kind = 'request'): Promise<() => void> {
    if (this.closed) return Promise.reject(new Error('원격 연결이 종료됐습니다.'))
    if (signal?.aborted) return Promise.reject(new DOMException('취소됐습니다.', 'AbortError'))
    if (this.waiting.length >= REMOTE_LIMITS.streams * 4 && !this.canStart(kind)) return Promise.reject(new Error('원격 요청 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.'))
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      const waiter: Waiter = {
        kind,
        start: () => {
          cleanup(); this.active[kind]++
          let released = false
          resolve(() => { if (released) return; released = true; this.active[kind]--; this.drain() })
        },
        stop: error => { cleanup(); this.waiting = this.waiting.filter(item => item !== waiter); reject(error) },
      }
      const abort = () => waiter.stop(new DOMException('취소됐습니다.', 'AbortError'))
      if (this.canStart(kind) && !this.waiting.some(item => !this.separate || item.kind === kind)) { waiter.start(); return }
      this.waiting.push(waiter)
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => waiter.stop(new Error('원격 요청 대기 시간이 초과됐습니다. 다시 시도해 주세요.')), 30_000)
      this.drain()
    })
  }
  enableSeparate() { if (!this.closed && !this.separate) { this.separate = true; this.drain() } }
  private canStart(kind: Kind) { return this.separate ? this.active[kind] < REMOTE_LIMITS.streams : this.active.request + this.active.socket < REMOTE_LIMITS.streams }
  private drain() {
    while (!this.closed && this.waiting.length) {
      const index = this.separate ? this.waiting.findIndex(waiter => this.canStart(waiter.kind)) : this.canStart('request') ? 0 : -1
      if (index < 0) return
      this.waiting.splice(index, 1)[0].start()
    }
  }
  close() { this.closed = true; for (const waiter of [...this.waiting]) waiter.stop(new Error('원격 연결이 종료됐습니다.')) }
}
