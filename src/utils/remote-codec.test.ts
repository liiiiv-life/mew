import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeRemoteBytes, encodeRemoteBytes } from './remote-codec.ts'
test('base64 codec handles every byte, partial views and browsers without native helpers', t => {
  const bytes = Uint8Array.from({ length: 30_001 }, (_, i) => i % 256), view = bytes.subarray(1, bytes.length - 1)
  assert.equal(encodeRemoteBytes(view), Buffer.from(view).toString('base64'))
  assert.deepEqual(decodeRemoteBytes(encodeRemoteBytes(view)), view)
  for (const [object, key] of [[Uint8Array, 'fromBase64'], [Uint8Array.prototype, 'toBase64']] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    Object.defineProperty(object, key, { configurable: true, value: undefined })
    t.after(() => { if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key) })
  }
  assert.equal(encodeRemoteBytes(view), Buffer.from(view).toString('base64'))
  assert.deepEqual(decodeRemoteBytes(encodeRemoteBytes(view)), view)
  assert.deepEqual(decodeRemoteBytes(''), new Uint8Array())
})
