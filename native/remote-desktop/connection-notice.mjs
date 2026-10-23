/** A session announces itself only after both input channels and visible video. */
export function connectionNotice(show) {
  const channels = new Set()
  let ready = false, shown = false, closed = false, dismiss
  const check = () => {
    if (closed || shown || !ready || !channels.has('motion') || !channels.has('control')) return
    shown = true
    try { dismiss = show() } catch { /* OS notifications must not interrupt the desktop. */ }
  }
  return {
    opened(label) { if (!closed) { channels.add(label); check() } },
    ready() { if (!closed) { ready = true; check() } },
    close() {
      if (closed) return
      closed = true
      try { dismiss?.() } catch { /* Continue media/input cleanup. */ }
    },
  }
}
