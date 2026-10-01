import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { fstatSync } from 'node:fs'
// @ts-expect-error Native helper JavaScript owns the portal adapter.
import { portalInput } from '../native/remote-desktop/input-portal.mjs'

test('Wayland screen and input share one authorization and a real SCM_RIGHTS socket FD closes with that session', {
  skip: process.platform !== 'linux' || !process.env.MEW_DESKTOP_TEST_LINUX_HELPER || process.env.MEW_DESKTOP_TEST_LINUX_ISOLATED !== '1', timeout: 10_000,
}, async () => {
  const require = createRequire(path.join(process.env.MEW_DESKTOP_TEST_LINUX_HELPER!, 'package.json')), dbus = require('dbus-next')
  const service = dbus.sessionBus({ negotiateUnixFd: true }), socket = createServer(), calls: string[] = []
  socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
  const original = (socket as unknown as { _handle: { fd: number } })._handle.fd
  let client: { name: string }, session: string, adapter: Awaited<ReturnType<typeof portalInput>>
  const respond = (method: string, options: { handle_token: { value: string } }, result: unknown) => {
    calls.push(method)
    const request = `/org/freedesktop/portal/desktop/request/${client.name.slice(1).replaceAll('.', '_')}/${options.handle_token.value}`
    queueMicrotask(() => service.send(dbus.Message.newSignal(request, 'org.freedesktop.portal.Request', 'Response', 'ua{sv}', [0, result])))
    return request
  }
  class Session extends dbus.interface.Interface {
    constructor() { super('org.freedesktop.portal.Session') }
    Close() { calls.push('Close') }
  }
  Session.configureMembers({ methods: { Close: {} } })
  class Remote extends dbus.interface.Interface {
    constructor() { super('org.freedesktop.portal.RemoteDesktop') }
    CreateSession(options: { handle_token: { value: string } }) {
      session = '/org/freedesktop/portal/desktop/session/fixture'
      service.export(session, new Session())
      return respond('CreateSession', options, { session_handle: new dbus.Variant('o', session) })
    }
    SelectDevices(value: string, options: { handle_token: { value: string } }) { assert.equal(value, session); return respond('SelectDevices', options, {}) }
    Start(value: string, _parent: string, options: { handle_token: { value: string } }) {
      assert.equal(value, session)
      return respond('Start', options, { devices: new dbus.Variant('u', 3), streams: new dbus.Variant('a(ua{sv})', [[73, { size: new dbus.Variant('(ii)', [1920, 1200]), position: new dbus.Variant('(ii)', [0, 0]) }]]) })
    }
  }
  Remote.configureMembers({ methods: { CreateSession: { inSignature: 'a{sv}', outSignature: 'o' }, SelectDevices: { inSignature: 'oa{sv}', outSignature: 'o' }, Start: { inSignature: 'osa{sv}', outSignature: 'o' } } })
  class Screen extends dbus.interface.Interface {
    constructor() { super('org.freedesktop.portal.ScreenCast') }
    SelectSources(value: string, options: { handle_token: { value: string } }) { assert.equal(value, session); return respond('SelectSources', options, {}) }
    OpenPipeWireRemote(value: string) { assert.equal(value, session); calls.push('OpenPipeWireRemote'); return original }
  }
  Screen.configureMembers({ methods: { SelectSources: { inSignature: 'oa{sv}', outSignature: 'o' }, OpenPipeWireRemote: { inSignature: 'oa{sv}', outSignature: 'h' } } })
  service.export('/org/freedesktop/portal/desktop', new Remote()); service.export('/org/freedesktop/portal/desktop', new Screen())
  try {
    await service.requestName('org.freedesktop.portal.Desktop', 0)
    adapter = await portalInput({ capture: true, load: async () => ({ default: { ...dbus, sessionBus: (options: unknown) => { client = dbus.sessionBus(options); return client } } }) })
    assert.equal(adapter.relativeOnly, true)
    assert.equal(adapter.source.node, 73)
    assert.deepEqual(adapter.source.bounds, { x: 0, y: 0, width: 1920, height: 1200 })
    const received = adapter.source.fd
    assert.notEqual(received, original); assert.ok(fstatSync(received).isSocket())
    await adapter.close()
    assert.throws(() => fstatSync(received), { code: 'EBADF' })
    assert.ok(fstatSync(original).isSocket(), 'the portal owns its original socket independently')
    assert.deepEqual(calls, ['CreateSession', 'SelectDevices', 'SelectSources', 'Start', 'OpenPipeWireRemote', 'Close'])
  } finally {
    await adapter?.close(); service.disconnect(); await new Promise<void>(resolve => socket.close(() => resolve()))
  }
})
