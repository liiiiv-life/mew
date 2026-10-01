import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
// @ts-expect-error Native helper module is shared with the Windows worker.
import { cursorPng } from '../native/remote-desktop/cursor-png.mjs'

const require = createRequire(import.meta.url)
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core')), 'lib/utilsBundle.js'))

test('native cursor PNG is decoded by an independent PNG reader with alpha and BGRA preserved', () => {
  const encoded = cursorPng({ width: 2, height: 1, pixels: new Uint8Array([16, 32, 64, 128, 255, 255, 255, 0]) })
  const decoded = PNG.sync.read(Buffer.from(encoded, 'base64'), { checkCRC: true })
  assert.equal(decoded.width, 2); assert.equal(decoded.height, 1)
  assert.deepEqual([...decoded.data], [128, 64, 32, 128, 0, 0, 0, 0])
  assert.throws(() => cursorPng({ width: 129, height: 1, pixels: new Uint8Array(516) }))
  assert.throws(() => cursorPng({ width: 2, height: 1, pixels: new Uint8Array(7) }))
})
