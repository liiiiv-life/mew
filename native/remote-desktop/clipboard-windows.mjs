/** CF_UNICODETEXT transfers memory ownership to Windows only on success. */
export function windowsClipboard(koffi) {
  const user = koffi.load('user32.dll'), kernel = koffi.load('kernel32.dll')
  const open = user.func('bool OpenClipboard(void *)'), empty = user.func('bool EmptyClipboard()'), close = user.func('bool CloseClipboard()')
  const set = user.func('void *SetClipboardData(uint32, void *)')
  const alloc = kernel.func('void *GlobalAlloc(uint32, uintptr)'), lock = kernel.func('void *GlobalLock(void *)'), unlock = kernel.func('bool GlobalUnlock(void *)'), free = kernel.func('void *GlobalFree(void *)')
  return text => {
    if (typeof text !== 'string' || text.length > 4096 || text.includes('\0')) throw new Error('Invalid clipboard text')
    if (!open(null)) throw new Error('Windows 클립보드를 열지 못했습니다.')
    let memory
    try {
      const data = Buffer.from(`${text}\0`, 'utf16le')
      memory = alloc(0x42, data.length)
      const pointer = memory && lock(memory)
      if (!pointer) throw new Error('Windows 클립보드 메모리를 준비하지 못했습니다.')
      try { koffi.encode(pointer, 'uint8', data, data.length) } finally { unlock(memory) }
      if (!empty() || !set(13, memory)) throw new Error('Windows 클립보드를 변경하지 못했습니다.')
      memory = null
    } finally { if (memory) free(memory); close() }
  }
}
