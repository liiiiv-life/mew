import test from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
// @ts-expect-error Native helper modules run as JavaScript.
import { pcpMap, pmpMap, gatewayDatagram } from '../native/remote-desktop/nat-port-map.mjs'
// @ts-expect-error Native helper modules run as JavaScript.
import { upnpMap } from '../native/remote-desktop/nat-upnp.mjs'
// @ts-expect-error Native helper modules run as JavaScript.
import { nativeConnectivity, desktopRoutes } from '../native/remote-desktop/native-connectivity.mjs'
// @ts-expect-error Native helper module.
import { windowsDesktopRoutes } from '../native/remote-desktop/windows-network.mjs'
// @ts-expect-error Native helper module.
import { nativeDirect } from '../native/remote-desktop/native-direct.mjs'
import { desktopAutoNat, desktopIceServers } from './remote-desktop-host.ts'
import { linuxNetworkTool, nativeFirewallHint } from '../native/remote-desktop/network-support.mjs'

const route = { gateway: '127.0.0.1', address: '127.0.0.1' }
async function gateway(reply: (request: Buffer) => Buffer[]) {
  const socket = dgram.createSocket('udp4')
  socket.on('message', (packet, remote) => { for (const response of reply(packet)) socket.send(response, remote.port, remote.address) })
  socket.bind(0, '127.0.0.1'); await once(socket, 'listening')
  return { exchange: (r: typeof route, packet: Buffer, options: object) => gatewayDatagram(r, packet, { ...options, port: socket.address().port, timeout: 100 }), close: () => new Promise<void>(resolve => socket.close(resolve)) }
}
test('PCP uses the ICE port, nonce and short lease over real UDP; renew/delete never affect other ports', async () => {
  const lifetimes: number[] = []
  const server = await gateway(packet => {
    assert.equal(packet.length, 60); assert.equal(packet[36], 17); assert.equal(packet.readUInt16BE(40), 40001)
    lifetimes.push(packet.readUInt32BE(4))
    const reply = Buffer.from(packet); reply[1] = 129; reply.writeUInt16BE(41001, 42); reply.fill(0, 44, 60); reply.writeUInt16BE(0xffff, 54); Buffer.from([8, 8, 8, 8]).copy(reply, 56)
    const wrong = Buffer.from(reply); wrong[24] ^= 1
    return [wrong, reply]
  })
  try {
    const mapping = await pcpMap(route, 40001, { exchange: server.exchange })
    assert.equal(mapping.address, '8.8.8.8'); assert.equal(mapping.port, 41001); assert.equal(mapping.lease, 120)
    assert.equal(await mapping.renew(), 120); await mapping.close()
    assert.deepEqual(lifetimes, [120, 120, 0])
  } finally { await server.close() }
})
test('NAT-PMP discovers public address, validates internal port and rejects permanent leases', async () => {
  const lifetimes: number[] = []
  const server = await gateway(packet => {
    if (packet[1] === 0) { const reply = Buffer.alloc(12); reply[1] = 128; Buffer.from([8, 8, 4, 4]).copy(reply, 8); return [reply] }
    const lifetime = packet.readUInt32BE(8); lifetimes.push(lifetime)
    const reply = Buffer.alloc(16); reply[1] = 129; reply.writeUInt16BE(packet.readUInt16BE(4), 8); reply.writeUInt16BE(41002, 10); reply.writeUInt32BE(lifetime ? 86400 : 0, 12)
    const wrong = Buffer.from(reply); wrong.writeUInt16BE(49999, 8); return [wrong, reply]
  })
  try { await assert.rejects(pmpMap(route, 40002, { exchange: server.exchange }), /short/); assert.deepEqual(lifetimes, [120, 0]) }
  finally { await server.close() }
})
test('UPnP never replaces another mapping, follows off-router URLs or accepts permanent leases', async () => {
  let entry: Record<string, string> | undefined, permanent = false, externalUrl = false
  const actions: string[] = []
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') { res.end(`<root><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>${externalUrl ? 'http://127.0.0.2/' : '/control'}</controlURL></service></root>`); return }
    let content = ''; for await (const chunk of req) content += chunk.toString()
    const name = String(req.headers.soapaction).match(/#(\w+)/)![1]; actions.push(name)
    const xml = (value: Record<string, string>) => Object.entries(value).map(([key, text]) => `<${key}>${text}</${key}>`).join('')
    if (name === 'GetExternalIPAddress') res.end('<NewExternalIPAddress>8.8.8.8</NewExternalIPAddress>')
    else if (name === 'GetSpecificPortMappingEntry') { if (entry) res.end(xml(entry)); else { res.statusCode = 500; res.end('<errorCode>714</errorCode>') } }
    else if (name === 'AddPortMapping') { entry = Object.fromEntries([...content.matchAll(/<(New\w+)>([^<]*)<\/\1>/g)].map(match => [match[1], match[2]])); if (permanent) entry.NewLeaseDuration = '0'; res.end('<ok/>') }
    else if (name === 'DeletePortMapping') { entry = undefined; res.end('<ok/>') }
    else { res.statusCode = 500; res.end('<errorCode>401</errorCode>') }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const discover = async () => `http://127.0.0.1:${(server.address() as { port: number }).port}/device`
  try {
    const mapping = await upnpMap(route, 40003, { discover })
    assert.equal(mapping.lease, 120); await mapping.renew(); await mapping.close(); assert.equal(entry, undefined)
    permanent = true; await assert.rejects(upnpMap(route, 40003, { discover }), /short/); assert.equal(entry, undefined)
    permanent = false; entry = { NewInternalClient: 'another', NewInternalPort: '40003', NewPortMappingDescription: 'other', NewLeaseDuration: '120' }
    const before = actions.length; await assert.rejects(upnpMap(route, 40003, { discover }), /already mapped/); assert.ok(!actions.slice(before).includes('AddPortMapping'))
    externalUrl = true; const count = actions.length; await assert.rejects(upnpMap(route, 40003, { discover }), /escaped/); assert.equal(actions.length, count)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
test('automatic NAT is idle before candidates, scoped to the actual default route, and cleans a late mapping after cancellation', async () => {
  const candidates: unknown[] = [], states: string[] = [], calls: number[] = []
  let finish!: (value: unknown) => void, deleted = 0
  const manager = nativeConnectivity({ delayMs: 0, emit: (...value: unknown[]) => candidates.push(value), status: (value: string) => states.push(value), routes: async () => [{ gateway: '192.168.1.1', address: '192.168.1.2' }], map: [async (_route: unknown, port: number) => { calls.push(port); return new Promise(resolve => { finish = resolve }) }] })
  await delay(5); assert.equal(calls.length, 0)
  manager.candidate('candidate:a 1 UDP 1 10.1.1.5 40004 typ host', 'video')
  manager.candidate('candidate:b 1 UDP 1 192.168.1.2 40004 typ host', 'video')
  manager.candidate('candidate:b 1 UDP 1 192.168.1.2 40004 typ host', 'video')
  await delay(5); assert.deepEqual(calls, [40004])
  const closing = manager.close()
  finish({ address: '8.8.8.8', port: 41004, lease: 120, close: async () => { deleted++ } })
  await closing; assert.equal(deleted, 1); assert.equal(candidates.length, 0); assert.deepEqual(states, ['no-router', 'discovering'])
})

test('Linux selects the kernel route and preferred source despite an incomplete service PATH, aliases and VPN interfaces', async () => {
  const calls: string[][] = [], interfaces = () => ({
    eth0: [{ family: 'IPv4', address: '192.168.1.2', internal: false }, { family: 'IPv4', address: '192.168.1.3', internal: false }],
    wg0: [{ family: 'IPv4', address: '10.20.0.2', internal: false }],
  })
  let output = '[{"gateway":"192.168.1.1","dev":"eth0","prefsrc":"192.168.1.3"}]'
  const options = { platform: 'linux', interfaces, tool: (name: string) => linuxNetworkTool(name, file => file === '/sbin/ip'), execute: async (file: string, args: string[]) => { calls.push([file, ...args]); return { stdout: output } } }
  assert.deepEqual(await desktopRoutes(options), [{ gateway: '192.168.1.1', address: '192.168.1.3' }])
  assert.deepEqual(calls[0], ['/sbin/ip', '-j', '-4', 'route', 'get', '1.1.1.1'])
  output = '[{"dev":"wg0","prefsrc":"10.20.0.2"}]'
  assert.deepEqual(await desktopRoutes(options), [], 'a VPN without a router cannot fall back to the physical LAN')
  output = '[{"type":"unreachable"}]'; assert.deepEqual(await desktopRoutes(options), [])
  await assert.rejects(desktopRoutes({ ...options, tool: () => undefined }), /iproute2/)
  assert.throws(() => linuxNetworkTool('arbitrary-command'), /Unsupported/)
})

test('Mac route discovery uses the selected IPv4 interface and refuses IPv6-only and tunnel gateways', async () => {
  const calls: string[][] = [], interfaces = () => ({
    en0: [{ family: 'IPv4', address: '192.168.3.2', internal: false }],
    en1: [{ family: 'IPv4', address: '192.168.4.2', internal: false }],
    utun0: [{ family: 'IPv4', address: '10.30.0.2', internal: false }],
  })
  let output = '   route to: 1.1.1.1\n    gateway: 192.168.4.1\n  interface: en1\n'
  const options = { platform: 'darwin', interfaces, execute: async (file: string, args: string[]) => { calls.push([file, ...args]); return { stdout: output } } }
  assert.deepEqual(await desktopRoutes(options), [{ gateway: '192.168.4.1', address: '192.168.4.2' }])
  assert.deepEqual(calls[0], ['/sbin/route', '-n', 'get', '-inet', '1.1.1.1'])
  output = 'gateway: link#9\ninterface: utun0\n'; assert.deepEqual(await desktopRoutes(options), [])
  output = 'gateway: fe80::1%en0\ninterface: en0\n'; assert.deepEqual(await desktopRoutes(options), [])
})

test('route discovery failure stays bounded, advertises no mapping, and cannot prevent native cleanup', async () => {
  const states: string[] = []
  const manager = nativeConnectivity({ delayMs: 0, status: (state: string) => states.push(state), routes: async () => { throw new Error('ip unavailable') }, emit: () => assert.fail('failed route cannot advertise an address'), map: [() => assert.fail('failed route cannot mutate a gateway')] })
  manager.candidate('candidate:a 1 UDP 1 192.168.1.2 40007 typ host', 'video')
  await delay(10); await manager.close(); assert.deepEqual(states, ['route-unavailable'])
})

test('Mac/Linux firewall hints are read-only and unknown or unavailable policy never prevents a launch', async () => {
  const queries: string[][] = [], read = async () => ''
  const execute = async (file: string, args: string[], settings: Record<string, unknown>) => {
    assert.equal(settings.timeout, 1500); queries.push([file, ...args])
    return { stdout: args[0] === '--getglobalstate' ? 'Firewall is enabled. (State = 1)' : args[0] === '--getblockall' ? 'Block all DISABLED!' : 'Block incoming connections' }
  }
  const mac = { platform: 'darwin', executable: "/fixture/Mew's $(literal) app/Contents/MacOS/MewDesktop", execute }
  const blocked = await nativeFirewallHint({ ...mac, release: '24.6.0' })
  assert.match(blocked!, /수신 차단/); assert.match(blocked!, /로컬 네트워크/)
  assert.ok(queries.every(args => ['--getglobalstate', '--getblockall', '--getappblocked'].includes(args[1])))
  assert.equal(queries[2][2], mac.executable, 'path is a separate argument, never shell code')
  assert.equal(await nativeFirewallHint({ ...mac, release: '22.6.0', execute: async () => { throw new Error('unavailable') } }), undefined)
  assert.match((await nativeFirewallHint({ platform: 'linux', read: async () => 'ENABLED=yes\n', execute: async () => assert.fail('UFW hint needs no privileged query') }))!, /UFW/)
  assert.match((await nativeFirewallHint({ platform: 'linux', read, tool: () => '/usr/bin/firewall-cmd', execute: async (file, args) => { queries.push([file, ...args]); return { stdout: 'running\n' } } }))!, /firewalld/)
  assert.equal(await nativeFirewallHint({ platform: 'linux', read: async () => { throw new Error('EACCES') }, tool: () => undefined }), undefined)
  assert.equal(await nativeFirewallHint({ platform: 'linux', read, tool: () => '/usr/bin/firewall-cmd', execute: async () => { throw new Error('DBus unavailable') } }), undefined)
})
test('Windows route lookup uses the native IPv4 ABI and does not launch a shell or fall back to another adapter', async () => {
  const controller = new AbortController()
  let code = 0, ipv6 = false, calls = 0
  const load = async () => ({ default: { load: (file: string) => {
    assert.match(file, /\\System32\\iphlpapi\.dll$/i)
    return { func: (signature: string) => {
      assert.match(signature, /__stdcall GetBestRoute2/)
      return (luid: unknown, index: number, from: unknown, destination: Buffer, flags: number, row: Buffer, source: Buffer) => {
        calls++; assert.equal(luid, null); assert.equal(index, 0); assert.equal(from, null); assert.equal(flags, 0)
        assert.equal(destination.length, 28); assert.equal(row.length, 104); assert.equal(source.length, 28)
        assert.equal(destination.readUInt16LE(0), 2); assert.deepEqual([...destination.subarray(4, 8)], [1, 1, 1, 1])
        row.writeUInt16LE(2, 44); Buffer.from([192, 168, 1, 1]).copy(row, 48)
        source.writeUInt16LE(ipv6 ? 23 : 2); Buffer.from([192, 168, 1, 3]).copy(source, 4)
        return code
      }
    } }
  } } })
  assert.deepEqual(await windowsDesktopRoutes({ load }), [{ gateway: '192.168.1.1', address: '192.168.1.3' }])
  code = 1231; await assert.rejects(windowsDesktopRoutes({ load }), /IPv4 경로/)
  code = 0; ipv6 = true; assert.deepEqual(await windowsDesktopRoutes({ load }), [])
  controller.abort(); await assert.rejects(windowsDesktopRoutes({ load, signal: controller.signal }), /abort/i); assert.equal(calls, 3)
})
test('default gateway selection filters nonlocal routes and respects NAT opt-out', async () => {
  const windowsRoutes = async () => [{ gateway: '192.168.1.1', address: '192.168.1.2' }, { gateway: '8.8.8.8', address: '192.168.1.2' }]
  assert.deepEqual(await desktopRoutes({ platform: 'win32', windowsRoutes, execute: () => assert.fail('Windows discovery cannot launch PowerShell') }), [{ gateway: '192.168.1.1', address: '192.168.1.2' }])
  assert.equal(desktopAutoNat({}), true); assert.equal(desktopAutoNat({ MEW_DESKTOP_AUTO_NAT: '0' }), false); assert.throws(() => desktopAutoNat({ MEW_DESKTOP_AUTO_NAT: 'yes' }))
  assert.equal(desktopIceServers({}).flatMap(value => value.urls).length, 2)
  const manager = nativeConnectivity({ enabled: false, emit() { assert.fail('disabled mapping advertised') }, routes() { assert.fail('disabled mapping discovered routes') } })
  manager.candidate('candidate:a 1 UDP 1 192.168.1.2 40005 typ host', 'video'); await manager.close()
})

test('STUN failover uses a fresh agent and isolates old negotiation candidates before any input opens', async () => {
  const peers: { config: { iceServers: string[] }; state?: (value: string) => void; offer?: (sdp: string, type: string) => void; candidate?: (value: string, mid: string) => void; answers: string[]; remotes: string[]; closed?: boolean }[] = []
  const emitted: Record<string, unknown>[] = [], failed: unknown[] = []
  class Video { addH264Codec() {} addSSRC() {} setBitrate() {} }
  class Chain { timestamp = 0; addToChain() {} }
  class Peer {
    self: typeof peers[number]
    constructor(_name: string, config: typeof peers[number]['config']) { this.self = { config, answers: [], remotes: [] }; peers.push(this.self) }
    addTrack() { return { setMediaHandler() {}, onOpen() {}, onError() {}, onMessage() {}, isOpen: () => true, sendMessageBinary: () => true } }
    createDataChannel() { return { onOpen() {}, onMessage() {}, onClosed() {}, onError() {} } }
    onLocalDescription(fn: typeof peers[number]['offer']) { this.self.offer = fn }
    onLocalCandidate(fn: typeof peers[number]['candidate']) { this.self.candidate = fn }
    onStateChange(fn: typeof peers[number]['state']) { this.self.state = fn }
    setLocalDescription() { this.self.offer!('v=0\r\n', 'offer') }
    setRemoteDescription(sdp: string) { this.self.answers.push(sdp) }
    addRemoteCandidate(candidate: string) { this.self.remotes.push(candidate) }
    close() { this.self.closed = true }
  }
  const rtc = { PeerConnection: Peer, Video, RtpPacketizationConfig: Chain, H264RtpPacketizer: Chain, RtcpSrReporter: Chain, RtcpNackResponder: Chain }
  const direct = nativeDirect(rtc, { iceServers: [{ urls: ['stun:first.test:3478', 'stun:second.test:3478'] }], autoNat: false, emit: (v: Record<string, unknown>) => emitted.push(v), input() {}, keyframe() {}, bitrate() {}, fail: (e: unknown) => failed.push(e) })
  assert.deepEqual(peers[0].config.iceServers, ['stun:first.test:3478'])
  peers[0].state!('failed'); await delay(5)
  assert.equal(peers.length, 2); assert.equal(peers[0].closed, true); assert.deepEqual(peers[1].config.iceServers, ['stun:second.test:3478'])
  assert.deepEqual(emitted.filter(v => v.type === 'offer').map(v => v.negotiation), [0, 1])
  direct.signal({ type: 'answer', negotiation: 0, sdp: 'old' }); direct.signal({ type: 'candidate', negotiation: 0, candidate: { candidate: 'old', sdpMid: 'video' } })
  direct.signal({ type: 'answer', negotiation: 1, sdp: 'new' }); direct.signal({ type: 'candidate', negotiation: 1, candidate: { candidate: 'new', sdpMid: 'video' } })
  assert.deepEqual(peers[1].answers, ['new']); assert.deepEqual(peers[1].remotes, ['new'])
  const count = emitted.length; peers[0].candidate!('candidate:old 1 UDP 1 192.168.1.2 40000 typ host', 'video'); assert.equal(emitted.length, count)
  peers[1].state!('failed'); assert.equal(failed.length, 1); await direct.close()
})
