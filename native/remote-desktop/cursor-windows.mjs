import { pointerBitmap, MAX_CURSOR_SIZE } from './cursor-protocol.mjs'

/** Read the system cursor independently of desktop presentation / DXGI updates. */
export function windowsCursor(koffi, dc, bounds) {
  const user = koffi.load('user32.dll'), gdi = koffi.load('gdi32.dll')
  const getCursor = user.func('bool __stdcall GetCursorInfo(void *)')
  const getIcon = user.func('bool __stdcall GetIconInfo(void *, void *)')
  const getObject = gdi.func('int __stdcall GetObjectW(void *, int, void *)')
  const getBits = gdi.func('int __stdcall GetDIBits(void *, void *, uint32, uint32, void *, void *, uint32)')
  const deleteObject = gdi.func('bool __stdcall DeleteObject(void *)')
  let lastHandle, shapeId = 0
  function bitmap(handle, width, height, bits) {
    const pitch = Math.ceil(width * bits / 32) * 4, pixels = Buffer.alloc(pitch * height), info = Buffer.alloc(48)
    info.writeUInt32LE(40); info.writeInt32LE(width, 4); info.writeInt32LE(-height, 8); info.writeUInt16LE(1, 12); info.writeUInt16LE(bits, 14)
    if (getBits(dc, handle, 0, height, pixels, info, 0) !== height) throw new Error('Cursor pixels unavailable')
    return { pixels, pitch }
  }
  function shape(handle) {
    const info = Buffer.alloc(32)
    if (!getIcon(handle, info)) throw new Error('Cursor shape unavailable')
    const mask = koffi.decode(info, 16, 'void *'), color = koffi.decode(info, 24, 'void *')
    try {
      const desc = Buffer.alloc(32)
      if (getObject(color || mask, 32, desc) !== 32) throw new Error('Cursor dimensions unavailable')
      const width = desc.readInt32LE(4), height = desc.readInt32LE(8) / (color ? 1 : 2)
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_CURSOR_SIZE || height > MAX_CURSOR_SIZE) throw new Error('Cursor dimensions unsupported')
      const hotX = info.readUInt32LE(4), hotY = info.readUInt32LE(8)
      if (!color) {
        const data = bitmap(mask, width, height * 2, 1)
        return pointerBitmap({ type: 1, width, height: height * 2, pitch: data.pitch, hotX, hotY }, data.pixels)
      }
      const data = bitmap(color, width, height, 32)
      if (data.pixels.some((value, index) => index % 4 === 3 && value > 0)) return pointerBitmap({ type: 2, width, height, pitch: data.pitch, hotX, hotY }, data.pixels)
      // Legacy color cursors use an AND mask instead of an alpha channel.
      const and = bitmap(mask, width, height, 1)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.pixels[y * data.pitch + x * 4 + 3] = and.pixels[y * and.pitch + (x >> 3)] & (128 >> (x % 8)) ? 255 : 0
      return pointerBitmap({ type: 4, width, height, pitch: data.pitch, hotX, hotY }, data.pixels)
    } finally { if (color) deleteObject(color); if (mask) deleteObject(mask) }
  }
  return () => {
    const info = Buffer.alloc(24); info.writeUInt32LE(24)
    if (!getCursor(info)) throw new Error('Cursor state unavailable')
    const handle = info.readBigUInt64LE(8), visible = !!(info.readUInt32LE(4) & 1)
    let image
    if (handle && handle !== lastHandle) { image = shape(koffi.decode(info, 8, 'void *')); lastHandle = handle; shapeId++ }
    if (visible && !lastHandle) throw new Error('Visible cursor has no shape')
    return { visible, x: (info.readInt32LE(16) - bounds.x) / (bounds.width - 1), y: (info.readInt32LE(20) - bounds.y) / (bounds.height - 1), shapeId, ...(image ? { shape: image } : {}) }
  }
}
