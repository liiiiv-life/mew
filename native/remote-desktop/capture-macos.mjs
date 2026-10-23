import { fileURLToPath } from 'node:url'

// Keep this reference in Electron main too: Objective-C completions can outlive
// the worker's close response. Never unload the dylib before process exit.
let library
export function macCaptureLibrary(koffi) {
  return library ??= koffi.load(fileURLToPath(new URL('./capture-macos.dylib', import.meta.url)))
}

export function macCaptureSize(bounds) {
  const { width, height, scaleFactor = 1, displayId } = bounds
  if (!Number.isInteger(displayId) || displayId < 1 || displayId > 0xffffffff ||
      ![bounds.x, bounds.y, width, height, scaleFactor].every(Number.isFinite) || width < 1 || height < 1 || scaleFactor <= 0) throw new Error('Invalid Mac display')
  const ratio = Math.min(scaleFactor, 1920 / width, 1080 / height)
  return { width: Math.max(2, Math.floor(width * ratio / 2) * 2), height: Math.max(2, Math.floor(height * ratio / 2) * 2) }
}

export function macCapture(koffi, bounds) {
  const { width, height } = macCaptureSize(bounds), lib = macCaptureLibrary(koffi)
  if (lib.func('uint32_t mew_capture_abi()')() !== 1) throw new Error('Mac capture helper needs updating')
  const create = lib.func('void *mew_capture_create(uint32_t, uint32_t, uint32_t, double, double, double, double)')
  const read = lib.func('int mew_capture_read(void *, void *, size_t)')
  const dispose = lib.func('void mew_capture_close(void *)')
  const info = koffi.struct('MewMacCursor', { x: 'double', y: 'double', visible: 'uint32_t', shape_id: 'uint32_t', width: 'uint32_t', height: 'uint32_t', hot_x: 'uint32_t', hot_y: 'uint32_t', changed: 'uint32_t' })
  const cursor = lib.func('mew_capture_cursor', 'int', ['void *', koffi.out(koffi.pointer(info)), 'void *', 'size_t'])
  let handle = create(bounds.displayId, width, height, bounds.x, bounds.y, bounds.width, bounds.height)
  if (!handle) throw new Error('Mac screen capture permission or display unavailable')
  let pixels = new Uint8Array(width * height * 4), shapeId = 0, started = false
  const shapePixels = new Uint8Array(128 * 128 * 4)
  return {
    width, height,
    next() {
      if (!handle) throw new Error('Capture closed')
      const changed = read(handle, pixels, pixels.byteLength)
      if (changed !== 0 && changed !== 1) throw new Error('Mac capture stopped')
      // Preserve the first shape for the first video packet, not a discarded
      // pending startup probe. The viewer needs both before enabling its cursor.
      if (!changed && !started) return { width, height }
      started = true
      const value = {}
      if (cursor(handle, value, shapePixels, shapePixels.byteLength) !== 0) throw new Error('Mac cursor unavailable')
      if (![value.x, value.y].every(Number.isFinite) || !Number.isInteger(value.shape_id) || value.shape_id < 1 ||
          ![value.width, value.height].every(v => Number.isInteger(v) && v >= 1 && v <= 128) ||
          !Number.isInteger(value.hot_x) || value.hot_x < 0 || value.hot_x >= value.width ||
          !Number.isInteger(value.hot_y) || value.hot_y < 0 || value.hot_y >= value.height) throw new Error('Invalid Mac cursor')
      const pointer = { x: value.x, y: value.y, visible: !!value.visible, shapeId: value.shape_id }
      if (value.changed || value.shape_id !== shapeId) {
        pointer.shape = { width: value.width, height: value.height, hotX: value.hot_x, hotY: value.hot_y, pixels: shapePixels.slice(0, value.width * value.height * 4) }
        shapeId = value.shape_id
      }
      const packet = { width, height, cursor: pointer }
      if (changed) { packet.pixels = pixels; pixels = new Uint8Array(width * height * 4) }
      return packet
    },
    close() { if (handle) { dispose(handle); handle = null } },
  }
}
