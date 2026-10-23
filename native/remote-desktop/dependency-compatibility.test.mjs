import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const xml2js = require('xml2js')
const ProxyObject = require('dbus-next/lib/client/proxy-object')
const xml = '<node name="/org/freedesktop/portal/desktop"><node name="session"/><interface name="org.freedesktop.portal.RemoteDesktop"><method name="CreateSession"><arg name="options" type="a{sv}" direction="in"/><arg name="handle" type="o" direction="out"/></method><property name="AvailableDeviceTypes" type="u" access="read"/><signal name="Closed"><arg name="reason" type="u"/></signal></interface></node>'
const parse = source => new Promise((resolve, reject) => new xml2js.Parser().parseString(source, (error, value) => error ? reject(error) : resolve(value)))

test('D-Bus XML keeps callback parsing, attribute arrays, and headless builder round trips', async () => {
  const parsed = await parse(xml)
  assert.equal(parsed.node.interface[0].$.name, 'org.freedesktop.portal.RemoteDesktop')
  assert.deepEqual(parsed.node.interface[0].method[0].arg.map(arg => arg.$.direction), ['in', 'out'])
  const rebuilt = new xml2js.Builder({ headless: true }).buildObject(parsed)
  assert.equal(rebuilt.startsWith('<?xml'), false)
  assert.deepEqual(await parse(rebuilt), parsed)
  await assert.rejects(parse('<node><interface></node>'))
})

test('dbus-next constructs portal methods, properties and signals without an OS bus', async () => {
  const bus = {
    _nameOwners: {},
    async call(message) {
      assert.equal(message.member, 'GetNameOwner')
      return { body: [':1.77'] }
    },
  }
  const object = await new ProxyObject(bus, 'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')._init(xml)
  const iface = object.getInterface('org.freedesktop.portal.RemoteDesktop')
  assert.deepEqual(object.nodes, ['/org/freedesktop/portal/desktop/session'])
  assert.deepEqual(iface.$methods, [{ name: 'CreateSession', inSignature: 'a{sv}', outSignature: 'o' }])
  assert.deepEqual(iface.$properties, [{ name: 'AvailableDeviceTypes', type: 'u', access: 'read' }])
  assert.deepEqual(iface.$signals, [{ name: 'Closed', signature: 'u' }])
  assert.equal(typeof iface.CreateSession, 'function')
  assert.equal(bus._nameOwners['org.freedesktop.portal.Desktop'], ':1.77')
  await assert.rejects(new ProxyObject(bus, 'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop')._init('<node><interface></node>'))
})
