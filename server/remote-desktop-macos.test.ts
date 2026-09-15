import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { HELPER_FILES } from '../native/remote-desktop/helper-version.mjs'
import { installMacCapture } from '../native/remote-desktop/install-macos.mjs'
// @ts-expect-error Shared native helper is JavaScript, loaded by Electron workers.
import { macCapture, macCaptureSize } from '../native/remote-desktop/capture-macos.mjs'

test('Mac Retina/portrait/negative-origin displays use bounded even pixels and logical input coordinates', () => {
  assert.deepEqual(macCaptureSize({ displayId: 1, x: 0, y: 0, width: 1512, height: 982, scaleFactor: 2 }), { width: 1662, height: 1080 })
  assert.deepEqual(macCaptureSize({ displayId: 2, x: -1080, y: -500, width: 1080, height: 1920 }), { width: 606, height: 1080 })
  assert.deepEqual(macCaptureSize({ displayId: 3, x: 0, y: 0, width: 800, height: 600 }), { width: 800, height: 600 })
  for (const bad of [{ displayId: NaN }, { width: Infinity }, { height: 0 }, { scaleFactor: -1 }]) {
    assert.throws(() => macCaptureSize({ displayId: 1, x: 0, y: 0, width: 800, height: 600, ...bad }))
  }
})

test('Mac adapter preserves the first cursor, skips idle pixels, owns transferred buffers and releases once', () => {
  let frameResult = 0, cursorCalls = 0, closes = 0
  let cursorResult = { x: .25, y: .75, visible: 1, shape_id: 1, width: 2, height: 2, hot_x: 1, hot_y: 0, changed: 1 }
  const functions: Record<string, (...args: any[]) => any> = {
    mew_capture_abi: () => 1,
    mew_capture_create: (...args) => { assert.deepEqual(args, [12, 800, 600, -800, 100, 800, 600]); return {} },
    mew_capture_read: (_handle, pixels, capacity) => { assert.equal(capacity, 800 * 600 * 4); if (frameResult === 1) pixels.fill(17); return frameResult },
    mew_capture_cursor: (_handle, info, pixels) => { cursorCalls++; Object.assign(info, cursorResult); pixels.fill(255); return 0 },
    mew_capture_close: () => { closes++ },
  }
  const koffi = { load: () => ({ func: (signature: string) => functions[signature.match(/mew_capture_\w+/)![0]] }),
    struct: () => ({}), pointer: (value: unknown) => value, out: (value: unknown) => value }
  const capture = macCapture(koffi, { displayId: 12, x: -800, y: 100, width: 800, height: 600 })
  assert.deepEqual(capture.next(), { width: 800, height: 600 }); assert.equal(cursorCalls, 0)
  frameResult = 1
  const first = capture.next()
  assert.equal(first.pixels.byteLength, 800 * 600 * 4); assert.equal(first.cursor.shape.pixels.byteLength, 16)
  assert.deepEqual([first.cursor.x, first.cursor.y], [.25, .75])
  const owned = structuredClone(first, { transfer: [first.pixels.buffer] })
  frameResult = 0; cursorResult = { ...cursorResult, changed: 0, x: .5 }
  const idle = capture.next()
  assert.equal(idle.pixels, undefined); assert.equal(idle.cursor.shape, undefined); assert.equal(idle.cursor.x, .5)
  cursorResult = { ...cursorResult, shape_id: 2, changed: 1, visible: 0 }
  assert.equal(capture.next().cursor.shape.pixels.byteLength, 16, 'cursor changes travel without a video frame')
  frameResult = 1; const resumed = capture.next()
  assert.equal(resumed.pixels[0], 17); assert.equal(owned.pixels[0], 17)
  frameResult = -1; assert.throws(() => capture.next(), /stopped/)
  frameResult = 0; cursorResult = { ...cursorResult, width: 129 }; assert.throws(() => capture.next(), /Invalid Mac cursor/)
  capture.close(); capture.close(); assert.equal(closes, 1); assert.throws(() => capture.next(), /closed/)
})

test('real Mac ScreenCaptureKit worker returns a cursor-free frame and decodable separate cursor', {
  skip: process.platform !== 'darwin' || process.env.MEW_DESKTOP_TEST_MACOS_CAPTURE !== '1', timeout: 180_000,
}, async () => {
  const source = path.resolve(import.meta.dirname, '../native/remote-desktop')
  const installed = process.env.MEW_DESKTOP_HELPER_DIR || source
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-macos-capture-test-'))
  try {
    for (const file of HELPER_FILES) await fs.copyFile(path.join(source, file), path.join(root, file))
    await fs.symlink(path.join(installed, 'node_modules'), path.join(root, 'node_modules'), 'dir')
    installMacCapture({ target: root })
    // No OS input, saved screen images or changes to the installed helper.
    await fs.writeFile(path.join(root, 'check.mjs'), `
      import { app, screen, nativeImage } from 'electron';
      import assert from 'node:assert/strict';
      import koffi from 'koffi';
      import { nativeCapture } from './native-capture.mjs';
      import { macCaptureLibrary } from './capture-macos.mjs';
      let capture;
      async function check() {
        await app.whenReady(); macCaptureLibrary(koffi);
        const display = screen.getPrimaryDisplay();
        capture = await nativeCapture({ ...display.bounds, displayId: display.id, scaleFactor: display.scaleFactor }, 'macos');
        let first;
        const until = Date.now() + 8000;
        do { first = await capture.next(); if (first.pixels) break; await new Promise(r => setTimeout(r, 16)); } while (Date.now() < until);
        assert.ok(first?.pixels); assert.equal(first.pixels.byteLength, first.width * first.height * 4);
        const shape = first.cursor?.shape; assert.ok(shape);
        const png = nativeImage.createFromBitmap(Buffer.from(shape.pixels), { width: shape.width, height: shape.height }).toPNG();
        const decoded = nativeImage.createFromBuffer(png); assert.equal(decoded.isEmpty(), false);
        assert.ok(decoded.toBitmap().some((v, i) => i % 4 === 3 && v > 0));
        for (let i = 0; i < 120; i++) { await capture.next(); await new Promise(r => setTimeout(r, 16)); }
        await capture.close(); console.log('MEW_MAC_CAPTURE_OK'); app.exit(0);
      }
      void check().catch(async () => { await capture?.close(); console.error('MEW_MAC_CAPTURE_FAILED'); app.exit(1); });
    `)
    const executable = path.join(installed, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
    const { stdout } = await promisify(execFile)(executable, [path.join(root, 'check.mjs')], { env, timeout: 25_000, maxBuffer: 256 * 1024 })
      .catch(() => { throw new Error('Mac native capture check failed; verify Screen Recording permission and an active unlocked display.') })
    assert.match(stdout, /MEW_MAC_CAPTURE_OK/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
