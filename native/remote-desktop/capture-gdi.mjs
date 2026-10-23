import { windowsCursor } from './cursor-windows.mjs'

/** Bounded fallback for displays where DXGI never supplies its first frame. */
export function gdiCapture(koffi, bounds) {
  const { x, y, width, height } = bounds
  if (!['x64', 'arm64'].includes(process.arch) || ![x, y, width, height].every(Number.isInteger) || width < 2 || height < 2 || width > 4096 || height > 4096 || width * height > 4096 * 2160) throw new Error('GDI display unsupported')
  const user = koffi.load('user32.dll'), gdi = koffi.load('gdi32.dll'), kernel = koffi.load('kernel32.dll'), crt = koffi.load('msvcrt.dll')
  const openDesktop = user.func('void *__stdcall OpenInputDesktop(uint32, bool, uint32)')
  const desktopInfo = user.func('bool __stdcall GetUserObjectInformationW(void *, int, void *, uint32, void *)')
  const setDesktop = user.func('bool __stdcall SetThreadDesktop(void *)'), closeDesktop = user.func('bool __stdcall CloseDesktop(void *)')
  const getDesktop = user.func('void *__stdcall GetThreadDesktop(uint32)'), threadId = kernel.func('uint32 __stdcall GetCurrentThreadId()')
  const dpi = user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t)')
  const wake = kernel.func('uint32 __stdcall SetThreadExecutionState(uint32)')
  const getDC = user.func('void *__stdcall GetDC(void *)'), releaseDC = user.func('int __stdcall ReleaseDC(void *, void *)')
  const createDC = gdi.func('void *__stdcall CreateCompatibleDC(void *)'), deleteDC = gdi.func('bool __stdcall DeleteDC(void *)')
  const createBitmap = gdi.func('void *__stdcall CreateDIBSection(void *, void *, uint32, _Out_ void **, void *, uint32)')
  const select = gdi.func('void *__stdcall SelectObject(void *, void *)'), deleteObject = gdi.func('bool __stdcall DeleteObject(void *)')
  const blit = gdi.func('bool __stdcall BitBlt(void *, int, int, int, int, void *, int, int, uint32)'), flush = gdi.func('bool __stdcall GdiFlush()')
  const compare = crt.func('int memcmp(void *, void *, size_t)'), copy = crt.func('void *memcpy(void *, void *, size_t)')
  const monitorFromRect = user.func('void *__stdcall MonitorFromRect(void *, uint32)'), monitorInfo = user.func('bool __stdcall GetMonitorInfoW(void *, void *)')
  let desktop, oldDesktop, oldDpi, screen, dc, bitmap, oldBitmap, closed = false
  function inputDesktop() {
    const desktop = openDesktop(0, false, 0x83), name = Buffer.alloc(256), required = Buffer.alloc(4)
    if (!desktop) throw new Error('Login desktop unavailable')
    if (!desktopInfo(desktop, 2, name, name.length, required) || name.toString('utf16le').split('\0')[0].toLowerCase() !== 'default') { closeDesktop(desktop); throw new Error('Secure desktop is not supported') }
    return desktop
  }
  const close = () => {
    if (closed) return; closed = true
    if (dc && oldBitmap) select(dc, oldBitmap)
    if (bitmap) deleteObject(bitmap)
    if (dc) deleteDC(dc)
    if (screen) releaseDC(null, screen)
    wake(0x80000000)
    if (oldDpi) dpi(oldDpi)
    if (oldDesktop) setDesktop(oldDesktop)
    if (desktop) closeDesktop(desktop)
  }
  try {
    oldDesktop = getDesktop(threadId()); desktop = inputDesktop()
    if (!oldDesktop || !setDesktop(desktop)) throw new Error('Capture desktop unavailable')
    oldDpi = dpi(-4)
    if (!oldDpi || !wake(0x80000003)) throw new Error('Capture thread unavailable')
    screen = getDC(null); dc = screen && createDC(screen)
    if (!dc) throw new Error('GDI screen unavailable')
    const info = Buffer.alloc(40), data = [null]
    info.writeUInt32LE(40); info.writeInt32LE(width, 4); info.writeInt32LE(-height, 8); info.writeUInt16LE(1, 12); info.writeUInt16LE(32, 14)
    bitmap = createBitmap(screen, info, 0, data, null, 0)
    if (!bitmap || !data[0]) throw new Error('GDI bitmap unavailable')
    oldBitmap = select(dc, bitmap)
    if (!oldBitmap || koffi.address(oldBitmap) === 0xffffffffffffffffn) { oldBitmap = null; throw new Error('GDI bitmap selection failed') }
    const cursor = windowsCursor(koffi, screen, bounds), previous = Buffer.alloc(width * height * 4), rect = Buffer.alloc(16)
    ;[x, y, x + width, y + height].forEach((value, index) => rect.writeInt32LE(value, index * 4))
    let first = true, lastRead = -Infinity, checkedAt = -Infinity
    return {
      width, height,
      next() {
        if (closed) throw new Error('GDI capture closed')
        const now = performance.now()
        if (now - checkedAt > 500) {
          const active = Buffer.alloc(4)
          if (!desktopInfo(desktop, 6, active, active.length, null) || !active.readInt32LE()) throw new Error('Login desktop is no longer active')
          const monitor = monitorFromRect(rect, 0), description = Buffer.alloc(40); description.writeUInt32LE(40)
          if (!monitor || !monitorInfo(monitor, description) || !description.subarray(4, 20).equals(rect)) throw new Error('Display configuration changed')
          checkedAt = now
        }
        const packet = { width, height, changed: false, cursor: cursor() }
        if (now - lastRead < 1000 / 30) return packet
        lastRead = now
        if (!blit(dc, 0, 0, width, height, screen, x, y, 0x40cc0020) || !flush()) throw new Error('GDI screen capture failed')
        // BitBlt copies the desktop without DrawIconEx/system cursor composition.
        // Compare in native memory; never expose an external ArrayBuffer to V8.
        if (!first && compare(data[0], previous, previous.length) === 0) return packet
        copy(previous, data[0], previous.length); first = false
        return { ...packet, changed: true, pixels: new Uint8Array(previous) }
      }, close,
    }
  } catch (error) { close(); throw error }
}
