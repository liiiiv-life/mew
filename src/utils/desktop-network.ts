export type DesktopNetworkUsage = { received: number; sent: number }
type NetworkStat = { id: string; type: string; bytesReceived?: number; bytesSent?: number }

/** Candidate-pair counters include both media and input without counting RTP twice. */
export function desktopNetworkUsage() {
  const previous = new Map<string, DesktopNetworkUsage>()
  const total: DesktopNetworkUsage = { received: 0, sent: 0 }
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  return {
    sent(bytes: number) { if (valid(bytes)) total.sent += bytes },
    received(bytes: number) { if (valid(bytes)) total.received += bytes },
    resetPeer() { previous.clear() },
    sample(report: { forEach: (callback: (value: NetworkStat) => void) => void }) {
      report.forEach(value => {
        if (value.type !== 'candidate-pair') return
        const before = previous.get(value.id) ?? { received: 0, sent: 0 }
        const next = { ...before }
        for (const [counter, field] of [['received', 'bytesReceived'], ['sent', 'bytesSent']] as const) {
          const bytes = value[field]
          if (!valid(bytes)) continue
          total[counter] += bytes >= before[counter] ? bytes - before[counter] : bytes
          next[counter] = bytes
        }
        previous.set(value.id, next)
      })
      return { ...total }
    },
    value() { return { ...total } },
  }
}

export function formatDesktopBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0), unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
  return `${unit ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
