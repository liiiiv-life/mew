import { deflateSync } from 'node:zlib'

function crc(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0) }
  return (value ^ 0xffffffff) >>> 0
}
function chunk(name, bytes) {
  const body = Buffer.concat([Buffer.from(name), bytes]), result = Buffer.alloc(bytes.length + 12)
  result.writeUInt32BE(bytes.length); body.copy(result, 4); result.writeUInt32BE(crc(body), result.length - 4)
  return result
}
/** Cursor BGRA only; desktop pixels never enter this encoder. */
export function cursorPng(shape) {
  const { width, height, pixels } = shape
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 128 || height > 128 || pixels.length !== width * height * 4) throw new Error('Invalid cursor image')
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4, to = y * (width * 4 + 1) + 1 + x * 4, alpha = pixels[from + 3]
    raw[to] = alpha ? Math.min(255, Math.round(pixels[from + 2] * 255 / alpha)) : 0
    raw[to + 1] = alpha ? Math.min(255, Math.round(pixels[from + 1] * 255 / alpha)) : 0
    raw[to + 2] = alpha ? Math.min(255, Math.round(pixels[from] * 255 / alpha)) : 0
    raw[to + 3] = alpha
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
