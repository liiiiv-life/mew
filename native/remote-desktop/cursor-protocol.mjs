export const MAX_CURSOR_SIZE = 128
const integer = (n, low, high) => Number.isInteger(n) && n >= low && n <= high
function validPng(shape) {
  if (!shape.png.startsWith('iVBORw0KGgo')) return false
  try {
    const prefix = Uint8Array.from(atob(shape.png.slice(0, 44)), c => c.charCodeAt(0)), view = new DataView(prefix.buffer)
    return view.getUint32(12) === 0x49484452 && view.getUint32(16) === shape.width && view.getUint32(20) === shape.height
  } catch { return false }
}
export function validCursor(value) {
  return value?.type === 'cursor' && typeof value.visible === 'boolean' && integer(value.seq, 0, Number.MAX_SAFE_INTEGER)
    && Number.isFinite(value.x) && Number.isFinite(value.y) && Math.abs(value.x) <= 32 && Math.abs(value.y) <= 32
    && integer(value.width, 1, 4096) && integer(value.height, 1, 4096) && integer(value.shapeId, 0, Number.MAX_SAFE_INTEGER)
    && (value.shape === undefined || value.shape !== null && typeof value.shape === 'object' && integer(value.shape.width, 1, MAX_CURSOR_SIZE) && integer(value.shape.height, 1, MAX_CURSOR_SIZE)
      && integer(value.shape.hotX, 0, value.shape.width - 1) && integer(value.shape.hotY, 0, value.shape.height - 1)
      && typeof value.shape.png === 'string' && value.shape.png.length <= 96 * 1024 && /^[A-Za-z0-9+/]+=*$/.test(value.shape.png) && validPng(value.shape))
}

/** DXGI pointer pixels -> premultiplied BGRA. Invert pixels use a visible white fallback. */
export function pointerBitmap(info, bytes) {
  const { type, width, pitch, hotX, hotY } = info, height = type === 1 ? info.height / 2 : info.height
  if (![1, 2, 4].includes(type) || !integer(width, 1, MAX_CURSOR_SIZE) || !integer(height, 1, MAX_CURSOR_SIZE)
    || !integer(hotX, 0, width - 1) || !integer(hotY, 0, height - 1)
    || !integer(pitch, type === 1 ? Math.ceil(width / 8) : width * 4, 4096) || bytes.length < pitch * info.height) throw new Error('Invalid cursor bitmap')
  const pixels = new Uint8Array(width * height * 4), inverted = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, j = y * pitch + x * 4
    if (type === 1) {
      const bit = 128 >> (x % 8), at = y * pitch + Math.floor(x / 8)
      const and = !!(bytes[at] & bit), xor = !!(bytes[at + height * pitch] & bit)
      pixels[i] = pixels[i + 1] = pixels[i + 2] = xor ? 255 : 0; pixels[i + 3] = and && !xor ? 0 : 255; if (and && xor) inverted.push([x, y])
    } else {
      pixels.set(bytes.subarray(j, j + 4), i)
      if (type === 4) {
        const xor = bytes[j + 3] === 255, nonzero = bytes[j] || bytes[j + 1] || bytes[j + 2]
        pixels[i + 3] = xor && !nonzero ? 0 : 255
        if (xor && nonzero) { pixels[i] = pixels[i + 1] = pixels[i + 2] = 255; inverted.push([x, y]) }
      }
    }
  }
  // Background inversion cannot be represented by CSS cursor PNGs. Give those
  // pixels an opaque light centre and dark outline, visible on both backgrounds.
  if (inverted.length) {
    const pad = width < MAX_CURSOR_SIZE - 1 && height < MAX_CURSOR_SIZE - 1 ? 1 : 0, w = width + pad * 2, h = height + pad * 2
    const outlined = new Uint8Array(w * h * 4)
    for (let y = 0; y < height; y++) outlined.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), ((y + pad) * w + pad) * 4)
    for (const [x, y] of inverted) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = x + pad + dx, py = y + pad + dy, at = (py * w + px) * 4
      if (px >= 0 && px < w && py >= 0 && py < h && outlined[at + 3] === 0) outlined[at + 3] = 255
    }
    return { width: w, height: h, hotX: hotX + pad, hotY: hotY + pad, pixels: outlined }
  }
  return { width, height, hotX, hotY, pixels }
}
