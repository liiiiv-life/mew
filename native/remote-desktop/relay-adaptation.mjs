/** ACK includes transit, decode, draw and return. A long base path is not congestion. */
export function relayAdaptation(now = () => performance.now()) {
  let bitrate = 2_500_000, base = Infinity, adjustedAt = now(), latest = 0
  const buckets = []
  return {
    sample(elapsed, bytes) {
      if (!Number.isFinite(elapsed) || elapsed < 0) return null
      const at = now(); latest = elapsed
      const bucket = Math.floor(at / 10_000)
      while (buckets.length && buckets[0].at < bucket - 5) buckets.shift()
      if (buckets.at(-1)?.at !== bucket) buckets.push({ at: bucket, min: elapsed })
      else buckets.at(-1).min = Math.min(buckets.at(-1).min, elapsed)
      base = Math.min(...buckets.map(value => value.min))
      const congested = elapsed > base + 80 || bytes > 256 * 1024 || elapsed > 1000
      const interval = congested ? 2000 : 10_000
      if (at - adjustedAt < interval) return null
      adjustedAt = at
      const next = Math.round(Math.max(350_000, Math.min(4_000_000, bitrate * (congested ? .75 : elapsed < base + 30 ? 1.08 : 1))))
      if (next === bitrate) return null
      bitrate = next; return bitrate
    },
    get bitrate() { return bitrate },
    get ackMs() { return Math.round(latest) },
    get baseMs() { return Number.isFinite(base) ? Math.round(base) : 0 },
  }
}
