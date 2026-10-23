import { REMOTE_LIMITS } from '../shared/remote-access.ts'

export function remoteInbox(receive: (data: string) => Promise<void>, failed: () => void) {
  let entries: { data: string; bytes: number }[] = [], bytes = 0, running = false, closed = false
  const close = () => { closed = true; entries = []; bytes = 0 }
  async function drain() {
    running = true
    try {
      while (!closed && entries.length) {
        const entry = entries.shift()!
        await receive(entry.data)
        if (!closed) bytes -= entry.bytes
      }
    } catch { close(); failed() }
    finally { running = false }
  }
  const push = (data: unknown) => {
    if (closed || typeof data !== 'string') return false
    const size = Buffer.byteLength(data)
    if (size > REMOTE_LIMITS.frame || bytes + size > REMOTE_LIMITS.queue || entries.length >= 4096) return false
    entries.push({ data, bytes: size }); bytes += size
    if (!running) void drain()
    return true
  }
  return { push, close }
}
