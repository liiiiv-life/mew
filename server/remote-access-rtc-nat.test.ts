import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { Script } from 'node:vm'
import { isIP } from 'node:net'
const { nativeConnectivity } = await import(new URL('../native/remote-desktop/native-connectivity.mjs', import.meta.url).href)
const { publicV4 } = await import(new URL('../native/remote-desktop/nat-port-map.mjs', import.meta.url).href)

const settle = () => new Promise(resolve => setImmediate(resolve))
const host = 'candidate:fixture 1 UDP 2122317823 192.168.50.2 55001 typ host'
type Mapping = { address: string; port: number; lease: number; renew(): Promise<number>; close(): Promise<void> }

function fixture(t: TestContext, map: (route: { address: string; gateway: string }, port: number) => Promise<Mapping>) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let candidate = (_value: string, _mid: string) => {}, state = (_value: string) => {}, gathering = (_value: string) => {}, data = (_value: string) => {}
  let peersClosed = 0, channelsClosed = 0, cleaned = 0
  const messages: Record<string, any>[] = []
  class Peer {
    onLocalDescription() {}
    onLocalCandidate(callback: typeof candidate) { candidate = callback }
    onGatheringStateChange(callback: typeof gathering) { gathering = callback }
    onStateChange(callback: typeof state) { state = callback }
    onDataChannel(callback: (channel: Record<string, unknown>) => void) {
      callback({ getLabel: () => 'mew-app', onOpen() {}, onClosed() {}, onError() {}, onMessage(callback: typeof data) { data = callback }, close() { channelsClosed++ } })
    }
    setRemoteDescription() {}
    addRemoteCandidate() {}
    close() { peersClosed++ }
  }
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send(value: Record<string, any>) { messages.push({ ...value }) },
    disconnect(this: EventEmitter & { connected: boolean }) { this.connected = false; this.emit('disconnect') },
  })
  const source = fs.readFileSync(new URL('./remote-access-rtc.mjs', import.meta.url), 'utf8').replace(/^import .+\n/gm, '')
  new Script(source, { filename: 'remote-access-rtc.mjs' }).runInNewContext({
    rtc: { PeerConnection: Peer, cleanup() { cleaned++ } }, createWslLoopbackCandidate: () => () => undefined,
    nativeConnectivity: (options: { emit(candidate: string, mid: string): void; status(state: string): void }) => nativeConnectivity({
      ...options, routes: async () => [{ address: '192.168.50.2', gateway: '192.168.50.1' }], map: [map],
    }),
    publicV4, isIP, process: child, Buffer, Date, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
  })
  child.emit('message', { type: 'start', stun: [], sdp: 'fixture' })
  t.after(async () => { child.emit('message', { type: 'close' }); await settle() })
  return { child, messages, candidate: (value: string) => candidate(value, '0'), state: (value: string) => state(value), gathering: (value: string) => gathering(value), data: (value: string) => data(value),
    closed: () => ({ peers: peersClosed, channels: channelsClosed, cleaned }) }
}

test('Mewlink maps only the real host UDP socket after two seconds and reports address-free diagnostics', async t => {
  const mapped: { address: string; gateway: string; port: number }[] = []
  let renewed = 0, removed = 0
  const h = fixture(t, async (route, port) => {
    mapped.push({ ...route, port })
    return { address: '203.0.113.4', port: 45000, lease: 120, renew: async () => { renewed++; return 120 }, close: async () => { removed++ } }
  })
  h.candidate('candidate:stun 1 UDP 1694498815 203.0.113.4 45001 typ srflx raddr 192.168.50.2 rport 55001')
  h.candidate('candidate:tcp 1 TCP 2122317823 192.168.50.2 9 typ host tcptype active')
  h.candidate(host)
  h.gathering('complete')
  t.mock.timers.tick(1999); await settle()
  assert.equal(mapped.length, 0)
  t.mock.timers.tick(1); await settle()
  assert.deepEqual(mapped, [{ address: '192.168.50.2', gateway: '192.168.50.1', port: 55001 }])
  const candidate = h.messages.find(value => value.type === 'candidate' && value.candidate.candidate.includes('candidate:mew'))
  assert.match(candidate?.candidate.candidate ?? '', /203\.0\.113\.4 45000 typ srflx raddr 192\.168\.50\.2 rport 55001$/)
  const status = h.messages.filter(value => value.type === 'network-status')
  assert.equal(status.at(-1)?.srflx, 2)
  assert.equal(status.at(-1)?.mapping, 'mapped')
  assert.equal(status.at(-1)?.gathering, 'complete')
  assert.ok(status.every(value => Object.keys(value).every(key => ['type', 'host', 'srflx', 'public4', 'ipv6', 'gathering', 'mapping'].includes(key))))
  assert.ok(status.every(value => !JSON.stringify(value).includes('192.168.') && !JSON.stringify(value).includes('203.0.113.')))
  t.mock.timers.tick(60_000); await settle()
  assert.equal(renewed, 1)
  h.child.emit('message', { type: 'close' })
  assert.deepEqual(h.closed(), { peers: 1, channels: 1, cleaned: 0 })
  assert.equal(h.child.connected, true)
  await settle()
  assert.equal(removed, 1)
  assert.deepEqual(h.closed(), { peers: 1, channels: 1, cleaned: 1 })
  assert.equal(h.child.connected, false)
  t.mock.timers.tick(120_000); await settle()
  assert.equal(renewed, 1)
})

test('Mewlink direct connection cancels delayed router discovery', async t => {
  let mapped = 0
  const h = fixture(t, async () => { mapped++; throw new Error('Router access must stay cancelled') })
  h.candidate(host)
  t.mock.timers.tick(1000)
  h.state('connected')
  t.mock.timers.tick(2000); await settle()
  assert.equal(mapped, 0)
})

test('Mewlink revokes transport immediately while deleting a mapping that completes during shutdown', async t => {
  let finish: (value: Mapping) => void = () => {}, removed = 0
  const h = fixture(t, () => new Promise(resolve => { finish = resolve }))
  h.candidate(host)
  t.mock.timers.tick(2000); await settle()
  h.child.emit('message', { type: 'close' })
  assert.deepEqual(h.closed(), { peers: 1, channels: 1, cleaned: 0 })
  const count = h.messages.length
  h.data('late-frame')
  finish({ address: '203.0.113.4', port: 45000, lease: 120, renew: async () => 120, close: async () => { removed++ } })
  await settle()
  assert.equal(removed, 1)
  assert.equal(h.messages.length, count)
  assert.equal(h.child.connected, false)
})

test('Mewlink bounds cleanup when an adapter does not settle', async t => {
  const h = fixture(t, async () => ({ address: '203.0.113.4', port: 45000, lease: 120, renew: async () => 120, close: () => new Promise(() => {}) }))
  h.candidate(host)
  t.mock.timers.tick(2000); await settle()
  h.child.emit('SIGTERM')
  assert.deepEqual(h.closed(), { peers: 1, channels: 1, cleaned: 0 })
  await settle()
  t.mock.timers.tick(3499)
  assert.equal(h.child.connected, true)
  t.mock.timers.tick(1)
  assert.deepEqual(h.closed(), { peers: 1, channels: 1, cleaned: 1 })
  assert.equal(h.child.connected, false)
})
