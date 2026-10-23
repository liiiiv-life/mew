import { isIP } from 'node:net'
import { release } from 'node:os'

export function createWslLoopbackCandidate(kernelRelease = release()) {
  const enabled = /microsoft/i.test(kernelRelease)
  const emitted = new Set<string>()
  return (candidate: string, mid: string): { candidate: string; sdpMid: string } | null => {
    if (!enabled) return null
    const fields = candidate.trim().split(/\s+/)
    if (fields.length < 8 || !/^(?:a=)?candidate:/.test(fields[0]) || fields[1] !== '1' || fields[2].toLowerCase() !== 'udp'
      || fields[6] !== 'typ' || fields[7] !== 'host' || isIP(fields[4]) !== 4 || fields[4].startsWith('127.')) return null
    const port = Number(fields[5]), priority = Number(fields[3])
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(priority) || priority < 0 || priority > 0xffffffff) return null
    const key = `${mid}:${port}`
    if (emitted.has(key)) return null
    emitted.add(key)
    fields[0] = fields[0].startsWith('a=') ? 'a=candidate:mewloopback' : 'candidate:mewloopback'
    fields[3] = String(Math.max(0, priority - 1))
    fields[4] = '127.0.0.1'
    return { candidate: fields.join(' '), sdpMid: mid }
  }
}
