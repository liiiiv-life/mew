import test from 'node:test'
import assert from 'node:assert/strict'
import { createWslLoopbackCandidate } from './remote-access-ice.ts'

const host = 'a=candidate:1 1 UDP 2122260223 192.168.1.10 52000 typ host generation 0'
test('WSL adds one loopback path per ICE socket while preserving its port, component and metadata', () => {
  const collect = createWslLoopbackCandidate('6.18-microsoft-standard-WSL2')
  assert.deepEqual(collect(host, '0'), { candidate: 'a=candidate:mewloopback 1 UDP 2122260222 127.0.0.1 52000 typ host generation 0', sdpMid: '0' })
  assert.equal(collect(host.replace('192.168.1.10', '172.20.0.1'), '0'), null)
  assert.ok(collect(host.replace('52000', '52001'), '0'))
  assert.ok(collect(host.replace('a=', '').replace('52000', '52002'), '0'))
})
test('non-WSL kernels and candidates without a valid bound IPv4 UDP host socket do not gain loopback paths', () => {
  for (const kernel of ['6.18.0-generic', 'Darwin', 'Windows_NT']) assert.equal(createWslLoopbackCandidate(kernel)(host, '0'), null)
  for (const candidate of [host.replace('typ host', 'typ srflx'), host.replace('typ host', 'typ relay'), host.replace('UDP', 'TCP'), host.replace('192.168.1.10', 'host.local'), host.replace('192.168.1.10', '::1'), host.replace('192.168.1.10', '127.0.0.1'), host.replace('52000', '0'), host.replace('52000', '65536'), host.replace('2122260223', 'NaN')]) {
    assert.equal(createWslLoopbackCandidate('microsoft')(candidate, '0'), null)
  }
})
