type Base64Array = Uint8Array & { toBase64?(): string }
type Base64Constructor = Uint8ArrayConstructor & { fromBase64?(value: string): Uint8Array }

export function encodeRemoteBytes(bytes: Uint8Array): string {
  const native = (bytes as Base64Array).toBase64
  if (native) return native.call(bytes)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 12 * 1024) binary += String.fromCharCode(...bytes.subarray(offset, offset + 12 * 1024))
  return btoa(binary)
}

export function decodeRemoteBytes(value: string): Uint8Array {
  const native = (Uint8Array as Base64Constructor).fromBase64
  if (native) return native.call(Uint8Array, value)
  const binary = atob(value), bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
