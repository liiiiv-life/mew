import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopNetworkUsage, formatDesktopBytes } from './desktop-network.ts'

const pair = (id: string, bytesReceived: number, bytesSent: number) => ({ id, type: 'candidate-pair', bytesReceived, bytesSent })

test('session totals combine media, input and UTF-8 signaling without duplicate RTP counts', () => {
  const usage = desktopNetworkUsage()
  usage.received(new TextEncoder().encode('한글').byteLength)
  usage.sent(20)
  const report = [pair('a', 1000, 50), { ...pair('rtp', 900, 0), type: 'inbound-rtp' }, { ...pair('input', 0, 30), type: 'data-channel' }]
  assert.deepEqual(usage.sample(report), { received: 1006, sent: 70 })
  assert.deepEqual(usage.sample(report), { received: 1006, sent: 70 })
  assert.deepEqual(usage.sample([pair('a', 1200, 80)]), { received: 1206, sent: 100 })
})

test('changing ICE paths and replacing peers preserve the session total', () => {
  const usage = desktopNetworkUsage()
  usage.sample([pair('old', 1000, 100)])
  assert.deepEqual(usage.sample([pair('new', 200, 20)]), { received: 1200, sent: 120 })
  assert.deepEqual(usage.sample([pair('old', 1000, 100), pair('new', 250, 25)]), { received: 1250, sent: 125 })
  usage.resetPeer()
  assert.deepEqual(usage.sample([pair('old', 30, 3)]), { received: 1280, sent: 128 })
  assert.deepEqual(desktopNetworkUsage().value(), { received: 0, sent: 0 }, 'new sessions start at zero')
})

test('missing reports, invalid counters and counter resets keep totals finite and monotonic', () => {
  const usage = desktopNetworkUsage()
  usage.sample([pair('a', 100, 10)])
  assert.deepEqual(usage.sample([]), { received: 100, sent: 10 })
  assert.deepEqual(usage.sample([pair('a', NaN, Infinity), pair('b', -1, -1)]), { received: 100, sent: 10 })
  assert.deepEqual(usage.sample([{ id: 'a', type: 'candidate-pair', bytesReceived: 110 }]), { received: 110, sent: 10 })
  assert.deepEqual(usage.sample([pair('a', 5, 2)]), { received: 115, sent: 12 })
  usage.sent(NaN); usage.received(-1)
  assert.deepEqual(usage.value(), { received: 115, sent: 12 })
})

test('usage is formatted in decimal byte units', () => {
  for (const [bytes, expected] of [[0, '0 B'], [999, '999 B'], [1000, '1.0 KB'], [1_234_567, '1.2 MB'], [1_500_000_000, '1.5 GB'], [1e12, '1.0 TB']] as const) assert.equal(formatDesktopBytes(bytes), expected)
})
