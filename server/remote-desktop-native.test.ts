import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
// @ts-expect-error Native helper modules run as JavaScript in Electron.
import { windowsInput, macInput, x11Input } from '../native/remote-desktop/input-native.mjs'
// @ts-expect-error Native helper modules run as JavaScript in Electron.
import { portalInput } from '../native/remote-desktop/input-portal.mjs'

function ffi() {
  const calls: { name: string; args: unknown[] }[] = []
  const koffi = { struct: (value: unknown) => value, pointer: (value: unknown) => value, out: (value: unknown) => value, load: () => ({ func: (signature: string) => {
    const name = signature.includes('(') ? signature.match(/(\w+)\s*\(/)![1] : signature
    return (...args: unknown[]) => {
      calls.push({ name, args: args.map(arg => Buffer.isBuffer(arg) ? Buffer.from(arg) : arg) })
      if (name === 'GetCursorPos') Object.assign(args[0] as object, { x: 100, y: 200 })
      if (name === 'CGEventGetLocation') return { x: 100, y: 200 }
      if (name.startsWith('CGEventCreate')) return {}
      return 1
    }
  } }) }
  return { koffi, calls }
}
const bounds = { x: -1920, y: 0, width: 1920, height: 1080 }

test('Windows input uses correctly aligned SendInput packets and physical display coordinates', () => {
  const { koffi, calls } = ffi(), adapter = windowsInput(koffi, bounds)
  adapter.moveTo(1, 1); adapter.button(1, true); adapter.button(2, true); adapter.button(4, false); adapter.wheel(0, 120); adapter.key('ControlRight', true); adapter.key('ControlRight', false)
  assert.deepEqual(calls.find(call => call.name === 'SetCursorPos')!.args, [-1, 1079])
  const packets = calls.filter(call => call.name === 'SendInput').map(call => { assert.equal(call.args[2], 40); return call.args[1] as Buffer })
  assert.deepEqual(packets.slice(0, 4).map(packet => packet.readUInt32LE(20)), [2, 32, 16, 0x800])
  assert.equal(packets[3].readInt32LE(16), -120)
  assert.equal(packets[4].readUInt32LE(0), 1)
  assert.equal(packets[4].readUInt32LE(12), 1)
  assert.equal(packets[5].readUInt32LE(12), 3)
})

test('Mac middle dragging and modifier flags are retained until release', () => {
  const { koffi, calls } = ffi(), adapter = macInput(koffi, bounds)
  adapter.button(2, true); adapter.move(10, -10); adapter.button(2, false); adapter.move(1, 1)
  assert.deepEqual(calls.filter(call => call.name === 'CGEventCreateMouseEvent').map(call => call.args[1]), [25, 27, 26, 5])
  adapter.key('MetaLeft', true); adapter.key('KeyV', true); adapter.key('KeyV', false); adapter.key('MetaLeft', false)
  assert.deepEqual(calls.filter(call => call.name === 'CGEventSetFlags').slice(-4).map(call => call.args[1]), [1 << 20, 1 << 20, 1 << 20, 0])
  adapter.wheel(10, 20)
  assert.deepEqual(calls.find(call => call.name === 'CGEventCreateScrollWheelEvent')!.args, [null, 0, 2, 'int32', -20, 'int32', -10])
})

test('X11 wheel preserves sub-notch input and maps right/middle buttons', () => {
  const { koffi, calls } = ffi(), adapter = x11Input(koffi, bounds)
  adapter.wheel(0, 60); adapter.wheel(0, 60)
  adapter.button(2, true); adapter.button(4, true); adapter.close()
  assert.deepEqual(calls.filter(call => call.name === 'XTestFakeButtonEvent').map(call => call.args.slice(1, 3)), [[5, true], [5, false], [2, true], [3, true]])
  assert.ok(calls.some(call => call.name === 'XCloseDisplay'))
})

test('Wayland subscribes before permission responses, serializes input, and closes its portal session', async () => {
  const bus = Object.assign(new EventEmitter(), { name: ':1.42', disconnected: false, disconnect() { this.disconnected = true }, getProxyObject: async (_destination: string, location: string) => ({ getInterface: () => location === '/org/freedesktop/DBus' ? daemon : location === '/session/test' ? session : desktop }) })
  const calls: unknown[][] = [], matches = new Set<string>()
  const daemon = { async AddMatch(rule: string) { matches.add(rule) }, async RemoveMatch(rule: string) { matches.delete(rule) } }
  const session = Object.assign(new EventEmitter(), { async Close() { calls.push(['Close']) } })
  const request = async (method: string, ...args: unknown[]) => {
    const options = args.at(-1) as { handle_token: { value: string } }, path = `/org/freedesktop/portal/desktop/request/1_42/${options.handle_token.value}`
    assert.ok([...matches].some(match => match.includes(path)))
    calls.push([method, ...args])
    bus.emit('message', { path, member: 'Response', body: [0, method === 'CreateSession' ? { session_handle: { value: '/session/test' } } : { devices: { value: 3 } }] })
    return path
  }
  const desktop = Object.fromEntries(['CreateSession', 'SelectDevices', 'Start', 'NotifyPointerMotion', 'NotifyPointerButton', 'NotifyKeyboardKeycode', 'NotifyPointerAxis'].map(method => [method, (...args: unknown[]) => method.startsWith('Notify') ? Promise.resolve(calls.push([method, ...args])) : request(method, ...args)]))
  const adapter = await portalInput({ load: async () => ({ default: { sessionBus: () => bus, Variant: class { signature: string; value: unknown; constructor(signature: string, value: unknown) { this.signature = signature; this.value = value } } } }) })
  assert.equal(adapter.relativeOnly, true); assert.equal(adapter.moveTo, undefined)
  adapter.button(2, true); adapter.move(10, 20); adapter.button(2, false); await adapter.close()
  assert.deepEqual(calls.filter(call => String(call[0]).startsWith('Notify')), [['NotifyPointerButton', '/session/test', {}, 274, 1], ['NotifyPointerMotion', '/session/test', {}, 10, 20], ['NotifyPointerButton', '/session/test', {}, 274, 0]])
  assert.equal(calls.at(-1)![0], 'Close'); assert.equal(bus.disconnected, true); assert.equal(matches.size, 0)
})
