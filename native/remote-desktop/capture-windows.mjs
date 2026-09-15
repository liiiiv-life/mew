// Windows SDK COM ABI (x64/arm64). All GPU work lives in capture-worker.mjs.
// No global cursor visibility changes and no cursor composition into the desktop.
import { pointerBitmap } from './cursor-protocol.mjs'

function guid(value) {
  const b = Buffer.from(value.replaceAll('-', ''), 'hex')
  b.subarray(0, 4).reverse(); b.subarray(4, 6).reverse(); b.subarray(6, 8).reverse()
  return b
}
export function windowsCapture(koffi, bounds) {
  if (!['x64', 'arm64'].includes(process.arch)) throw new Error('DXGI requires a 64-bit runtime')
  // Chromium desktop capture holds a prevent-display-sleep wake lock. Preserve
  // that lifetime for native capture too; a sleeping display may never present.
  const executionState = koffi.load('kernel32.dll').func('uint32 __stdcall SetThreadExecutionState(uint32)')
  const copyMemory = koffi.load('msvcrt.dll').func('void *memcpy(void *, void *, size_t)')
  const ole = koffi.load('ole32.dll'), initialize = ole.func('int32 __stdcall CoInitializeEx(void *, uint32)'), uninitialize = ole.func('void __stdcall CoUninitialize()')
  const types = new Map()
  function com(object, slot, result, params, ...args) {
    const signature = `${result} __stdcall Method(void *, ${params || 'void'})`.replace(', void)', ')')
    if (!types.has(signature)) types.set(signature, koffi.proto(signature.replace('Method(', `Method${types.size}(`)))
    const table = koffi.decode(object, 'void *'), fn = koffi.decode(table, slot * 8, 'void *')
    return koffi.call(fn, types.get(signature), object, ...args)
  }
  const check = (hr, operation) => { if (hr < 0) throw new Error(`DXGI ${operation} failed (0x${(hr >>> 0).toString(16)})`) }
  const release = object => { if (object) com(object, 2, 'uint32', '') }
  const query = (object, id) => { const out = [null]; check(com(object, 0, 'int32', 'void *, _Out_ void **', guid(id), out), 'interface'); return out[0] }
  let factory, adapter, output, output1, device, context, duplication, staging, width, height, closed = false, first = true, comInitialized = false
  const close = () => { if (closed) return; closed = true; try { for (const p of [staging, duplication, context, device, output1, output, adapter, factory]) release(p) } finally { executionState(0x80000000); if (comInitialized) uninitialize() } }
  try {
    check(initialize(null, 0), 'COM initialization'); comInitialized = true
    if (!executionState(0x80000003)) throw new Error('Display wake lock unavailable')
    const createFactory = koffi.load('dxgi.dll').func('int32 __stdcall CreateDXGIFactory1(void *, _Out_ void **)')
    const out = [null]; check(createFactory(guid('770aae78-f26f-4dba-a829-253c83d1b387'), out), 'factory'); factory = out[0]
    for (let a = 0; a < 16 && !output; a++) {
      const candidate = [null]
      const hr = com(factory, 12, 'int32', 'uint32, _Out_ void **', a, candidate)
      if ((hr >>> 0) === 0x887a0002) break
      check(hr, 'adapter')
      try {
        for (let n = 0; n < 32; n++) {
          const item = [null], hr = com(candidate[0], 7, 'int32', 'uint32, _Out_ void **', n, item)
          if ((hr >>> 0) === 0x887a0002) break
          check(hr, 'output')
          const desc = Buffer.alloc(96)
          try {
            check(com(item[0], 7, 'int32', 'void *', desc), 'output description')
            if (desc.readInt32LE(64) === bounds.x && desc.readInt32LE(68) === bounds.y && desc.readInt32LE(72) - bounds.x === bounds.width && desc.readInt32LE(76) - bounds.y === bounds.height && desc.readInt32LE(80)) {
              // Rotation requires a separate coordinate transform; use Chromium fallback.
              if (desc.readUInt32LE(84) !== 1) throw new Error('DXGI rotated display is not supported')
              output = item[0]; adapter = candidate[0]; break
            }
          } finally { if (output !== item[0]) release(item[0]) }
        }
      } finally { if (adapter !== candidate[0]) release(candidate[0]) }
    }
    if (!output) throw new Error('DXGI display not found')
    output1 = query(output, '00cddea8-939b-4b83-a340-a685226666cc')
    const createDevice = koffi.load('d3d11.dll').func('int32 __stdcall D3D11CreateDevice(void *, uint32, void *, uint32, void *, uint32, uint32, _Out_ void **, void *, _Out_ void **)')
    const dev = [null], ctx = [null]
    check(createDevice(adapter, 0, null, 0x20, null, 0, 7, dev, null, ctx), 'device'); device = dev[0]; context = ctx[0]
    const dup = [null]; check(com(output1, 22, 'int32', 'void *, _Out_ void **', device, dup), 'duplicate output'); duplication = dup[0]
    const description = Buffer.alloc(36); com(duplication, 7, 'void', 'void *', description)
    width = description.readUInt32LE(0); height = description.readUInt32LE(4)
    if (width !== bounds.width || height !== bounds.height || width < 2 || height < 2 || width > 4096 || height > 4096 || width * height > 4096 * 2160 || description.readUInt32LE(16) !== 87) throw new Error('DXGI display format not supported')
    const desc = Buffer.alloc(44)
    // D3D11_TEXTURE2D_DESC: BGRA, single sample, staging / CPU read.
    ;[width, height, 1, 1, 87, 1, 0, 3, 0, 0x20000, 0].forEach((n, i) => desc.writeUInt32LE(n, i * 4))
    const texture = [null]; check(com(device, 5, 'int32', 'void *, void *, _Out_ void **', desc, null, texture), 'staging texture'); staging = texture[0]
    // GetCursorInfo reports physical hotspot coordinates and handles invisible cursors.
    const getCursor = koffi.load('user32.dll').func('bool __stdcall GetCursorInfo(void *)')
    let shape, shapeId = 0
    return {
      width, height,
      next() {
        if (closed) throw new Error('DXGI capture closed')
        const info = Buffer.alloc(48), resource = [null]
        const hr = com(duplication, 8, 'int32', 'uint32, void *, _Out_ void **', first ? 250 : 0, info, resource)
        if ((hr >>> 0) === 0x887a0027) return { width, height, changed: false }
        check(hr, 'acquire frame')
        try {
          const size = info.readUInt32LE(44)
          if (size) {
            if (size > 128 * 128 * 8) throw new Error('DXGI cursor too large')
            const bytes = Buffer.alloc(size), used = Buffer.alloc(4), desc = Buffer.alloc(24)
            check(com(duplication, 11, 'int32', 'uint32, void *, void *, void *', size, bytes, used, desc), 'pointer shape')
            shape = pointerBitmap({ type: desc.readUInt32LE(0), width: desc.readUInt32LE(4), height: desc.readUInt32LE(8), pitch: desc.readUInt32LE(12), hotX: desc.readInt32LE(16), hotY: desc.readInt32LE(20) }, bytes)
            shapeId++
          }
          const ci = Buffer.alloc(24); ci.writeUInt32LE(24)
          if (!getCursor(ci)) throw new Error('DXGI cursor unavailable')
          const visible = !!(ci.readUInt32LE(4) & 1)
          // A visible cursor embedded by a driver cannot be safely removed after capture.
          if (visible && (!shape || info.readBigInt64LE(8) !== 0n && !info.readInt32LE(36))) {
            const x = ci.readInt32LE(16), y = ci.readInt32LE(20)
            if (x >= bounds.x && x < bounds.x + width && y >= bounds.y && y < bounds.y + height) throw new Error('DXGI embedded cursor is not supported')
          }
          const cursor = { visible, x: (ci.readInt32LE(16) - bounds.x) / (width - 1), y: (ci.readInt32LE(20) - bounds.y) / (height - 1), shapeId, ...(size && shape ? { shape } : {}) }
          if (!first && info.readBigInt64LE(0) === 0n) return { width, height, changed: false, cursor }
          const texture = query(resource[0], '6f15aaf2-d208-4e89-9ab4-489535d34f9c')
          try { com(context, 47, 'void', 'void *, void *', staging, texture) }
          finally { release(texture) }
          const mapped = Buffer.alloc(16)
          check(com(context, 14, 'int32', 'void *, uint32, uint32, uint32, void *', staging, 0, 1, 0, mapped), 'map')
          let pixels
          try {
            const pitch = mapped.readUInt32LE(8)
            if (pitch < width * 4 || pitch > 65536) throw new Error('DXGI invalid row pitch')
            const data = koffi.decode(mapped, 'void *')
            // Electron's V8 memory cage cannot expose GPU mappings as external
            // ArrayBuffers. Copy into V8-owned storage while the texture is mapped.
            pixels = new Uint8Array(width * height * 4)
            if (pitch === width * 4) copyMemory(pixels, data, pixels.byteLength)
            else {
              const source = new Uint8Array(pitch * height); copyMemory(source, data, source.byteLength)
              for (let y = 0; y < height; y++) pixels.set(source.subarray(y * pitch, y * pitch + width * 4), y * width * 4)
            }
          } finally { com(context, 15, 'void', 'void *, uint32', staging, 0) }
          first = false
          return { width, height, changed: true, pixels, cursor }
        } finally { release(resource[0]); check(com(duplication, 14, 'int32', ''), 'release frame') }
      },
      close,
    }
  } catch (error) { close(); throw error }
}
