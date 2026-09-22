import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Helper policy runs in Electron and Node.
import { startWindowsCapture } from '../native/remote-desktop/capture-start.mjs'

const bounds = { x: 0, y: 0, width: 1920, height: 1080 }
const pixels = new Uint8Array([1, 2, 3, 255])
function fixture(frames: (backend: string, attempt: number, now: number) => { pixels?: Uint8Array }) {
  let now = 0, stopped = false
  const opened: string[] = [], closed: number[] = []
  const options = {
    now: () => now, stopped: () => stopped, pause: async (ms: number) => { now += ms },
    open: async (_bounds: unknown, backend: string) => {
      const id = opened.length; opened.push(backend)
      return { next: async () => frames(backend, id, now), close: async () => { closed.push(id) } }
    },
  }
  return { options, opened, closed, stop: () => { stopped = true }, get elapsed() { return now } }
}

test('first DXGI pixels start immediately without GDI or an artificial wait', async () => {
  const f = fixture(() => ({ pixels }))
  const result = await startWindowsCapture(bounds, f.options)
  assert.equal(result.first.pixels, pixels)
  assert.deepEqual(f.opened, ['dxgi']); assert.deepEqual(f.closed, [])
  assert.equal(f.elapsed, 0)
  await result.capture.close(); assert.deepEqual(f.closed, [0])
})

test('cursor-only DXGI responses fall back after 600ms and close both empty duplications', async () => {
  const f = fixture(backend => backend === 'gdi' ? { pixels } : {})
  const result = await startWindowsCapture(bounds, f.options)
  assert.equal(result.first.pixels, pixels)
  assert.deepEqual(f.opened, ['dxgi', 'dxgi', 'gdi'])
  assert.deepEqual(f.closed, [0, 1]); assert.equal(f.elapsed, 600)
  await result.capture.close(); assert.deepEqual(f.closed, [0, 1, 2])
})

test('a display transition recovers on the second duplication without GDI', async () => {
  const f = fixture((_backend, attempt, now) => attempt === 1 && now >= 400 ? { pixels } : {})
  const result = await startWindowsCapture(bounds, f.options)
  assert.equal(result.first.pixels, pixels)
  assert.deepEqual(f.opened, ['dxgi', 'dxgi']); assert.deepEqual(f.closed, [0])
  assert.ok(f.elapsed >= 400 && f.elapsed < 600)
  await result.capture.close()
})

test('unsupported DXGI skips the retry and failed GDI permits Chromium fallback', async () => {
  const f = fixture(backend => { throw new Error(`${backend} unavailable`) })
  assert.equal(await startWindowsCapture(bounds, f.options), null)
  assert.deepEqual(f.opened, ['dxgi', 'gdi']); assert.deepEqual(f.closed, [0, 1])
  assert.equal(f.elapsed, 0)
})

test('closing while waiting prevents another capture backend from starting', async () => {
  const f = fixture(() => ({}))
  f.options.pause = async () => { f.stop() }
  assert.equal(await startWindowsCapture(bounds, f.options), null)
  assert.deepEqual(f.opened, ['dxgi']); assert.deepEqual(f.closed, [0])
})

test('closing during worker initialization releases it without requesting pixels', async () => {
  const f = fixture(() => assert.fail('no capture after close'))
  const open = f.options.open
  f.options.open = async (...args) => { const capture = await open(...args); f.stop(); return capture }
  assert.equal(await startWindowsCapture(bounds, f.options), null)
  assert.deepEqual(f.closed, [0]); assert.deepEqual(f.opened, ['dxgi'])
})

test('a frame arriving after close is discarded and its worker is released', async () => {
  const f = fixture(() => { f.stop(); return { pixels } })
  assert.equal(await startWindowsCapture(bounds, f.options), null)
  assert.deepEqual(f.closed, [0]); assert.deepEqual(f.opened, ['dxgi'])
})
