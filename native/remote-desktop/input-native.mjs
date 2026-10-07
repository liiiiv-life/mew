import { KEY_CODES } from './keys.mjs'

export function windowsInput(koffi, bounds) {
  const user = koffi.load('user32.dll')
  const Point = koffi.struct({ x: 'int32', y: 'int32' })
  const position = user.func('GetCursorPos', 'bool', [koffi.out(koffi.pointer(Point))])
  const setPosition = user.func('bool SetCursorPos(int x, int y)')
  const send = user.func('uint32 SendInput(uint32 count, void *inputs, int size)')
  function packet(type, flags, data = 0) {
    const buffer = Buffer.alloc(40) // INPUT on Windows x64/arm64: union aligned at byte 8.
    buffer.writeUInt32LE(type, 0)
    buffer.writeUInt32LE(flags >>> 0, type === 0 ? 20 : 12)
    if (type === 0) buffer.writeInt32LE(Math.round(data), 16)
    else buffer.writeUInt16LE(data, 8)
    if (send(1, buffer, buffer.length) !== 1) throw new Error('Windows에서 입력을 허용하지 않았습니다. 관리자 창과 UAC 화면은 제어할 수 없습니다.')
  }
  return {
    move(dx, dy) { const point = {}; if (position(point)) setPosition(Math.round(point.x + dx), Math.round(point.y + dy)) },
    moveTo(x, y) { setPosition(Math.round(bounds.x + x * (bounds.width - 1)), Math.round(bounds.y + y * (bounds.height - 1))) },
    button(bit, down) { packet(0, bit === 1 ? down ? 2 : 4 : bit === 2 ? down ? 32 : 64 : down ? 8 : 16) },
    wheel(dx, dy) { if (dy) packet(0, 0x0800, -dy); if (dx) packet(0, 0x1000, dx) },
    key(code, down) { const key = KEY_CODES[code]; if (key) packet(1, (down ? 0 : 2) | (/^(Arrow|Home|End|Page|Delete|Insert|Meta|ControlRight|AltRight|NumpadEnter|NumpadDivide|NumLock|PrintScreen|ContextMenu|AudioVolume|Media|Browser|Launch)/.test(code) ? 1 : 0), key.windows) },
    close() {},
  }
}

export function macInput(koffi, bounds) {
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const Point = koffi.struct({ x: 'double', y: 'double' })
  const create = cg.func('void *CGEventCreate(void *source)')
  const location = cg.func('CGEventGetLocation', Point, ['void *'])
  const mouse = cg.func('CGEventCreateMouseEvent', 'void *', ['void *', 'uint32', Point, 'uint32'])
  const keyboard = cg.func('void *CGEventCreateKeyboardEvent(void *source, uint16 key, bool down)')
  const setFlags = cg.func('void CGEventSetFlags(void *event, uint64 flags)')
  const scroll = cg.func('void *CGEventCreateScrollWheelEvent(void *source, uint32 units, uint32 count, ...)')
  const post = cg.func('void CGEventPost(uint32 tap, void *event)')
  const release = cf.func('void CFRelease(void *value)')
  let held = 0
  const modifiers = new Set()
  const flags = () => [...modifiers].reduce((value, key) => value | (key.startsWith('Shift') ? 1 << 17 : key.startsWith('Control') ? 1 << 18 : key.startsWith('Alt') ? 1 << 19 : key.startsWith('Meta') ? 1 << 20 : 0), 0)
  const current = () => { const event = create(null); if (!event) throw new Error('Mac 커서 위치를 읽을 수 없습니다.'); const point = location(event); release(event); return point }
  const emit = (event) => { if (!event) throw new Error('Mac 입력 이벤트를 만들 수 없습니다.'); setFlags(event, flags()); post(0, event); release(event) }
  const moveTo = (point) => emit(mouse(null, held & 1 ? 6 : held & 4 ? 7 : held & 2 ? 27 : 5, point, held & 4 ? 1 : held & 2 ? 2 : 0))
  return {
    move(dx, dy) { const point = current(); moveTo({ x: point.x + dx, y: point.y + dy }) },
    moveTo(x, y) { moveTo({ x: bounds.x + x * (bounds.width - 1), y: bounds.y + y * (bounds.height - 1) }) },
    button(bit, down) { held = down ? held | bit : held & ~bit; emit(mouse(null, bit === 1 ? down ? 1 : 2 : bit === 4 ? down ? 3 : 4 : down ? 25 : 26, current(), bit === 1 ? 0 : bit === 4 ? 1 : 2)) },
    wheel(dx, dy) { emit(scroll(null, 0, 2, 'int32', Math.round(-dy), 'int32', Math.round(-dx))) },
    key(code, down) { const key = KEY_CODES[code]; if (key && key.mac !== null) { if (down) modifiers.add(code); else modifiers.delete(code); emit(keyboard(null, key.mac, down)) } },
    close() {},
  }
}

export function x11Input(koffi, bounds) {
  const x = koffi.load('libX11.so.6'), xt = koffi.load('libXtst.so.6')
  const open = x.func('void *XOpenDisplay(const char *name)'), close = x.func('int XCloseDisplay(void *display)'), flush = x.func('int XFlush(void *display)')
  const keysym = x.func('uintptr XStringToKeysym(const char *name)'), keycode = x.func('uchar XKeysymToKeycode(void *display, uintptr sym)')
  const move = xt.func('int XTestFakeRelativeMotionEvent(void *display, int x, int y, ulong delay)')
  const absolute = xt.func('int XTestFakeMotionEvent(void *display, int screen, int x, int y, ulong delay)')
  const button = xt.func('int XTestFakeButtonEvent(void *display, uint button, bool down, ulong delay)')
  const key = xt.func('int XTestFakeKeyEvent(void *display, uint keycode, bool down, ulong delay)')
  const display = open(null)
  if (!display) throw new Error('Linux 데스크톱에 연결할 수 없습니다. 로그인 세션과 DISPLAY를 확인해 주세요.')
  let wheelX = 0, wheelY = 0
  return {
    move(dx, dy) { move(display, Math.round(dx), Math.round(dy), 0); flush(display) },
    moveTo(x, y) { absolute(display, -1, Math.round(bounds.x + x * (bounds.width - 1)), Math.round(bounds.y + y * (bounds.height - 1)), 0); flush(display) },
    button(bit, down) { button(display, bit === 1 ? 1 : bit === 2 ? 2 : 3, down, 0); flush(display) },
    wheel(dx, dy) {
      wheelX += dx; wheelY += dy
      for (const [amount, positive, negative] of [[wheelY, 5, 4], [wheelX, 7, 6]]) {
        for (let i = 0; i < Math.min(40, Math.floor(Math.abs(amount) / 120)); i++) { button(display, amount > 0 ? positive : negative, true, 0); button(display, amount > 0 ? positive : negative, false, 0) }
      }
      wheelX %= 120; wheelY %= 120; flush(display)
    },
    key(code, down) { const mapping = KEY_CODES[code]; if (mapping) { const native = keycode(display, keysym(mapping.x11)); if (native) { key(display, native, down, 0); flush(display) } } },
    close() { close(display) },
  }
}

export async function createNativeInput({ platform, wayland, bounds }) {
  if (platform === 'linux' && wayland) {
    const { portalInput } = await import('./input-portal.mjs')
    return portalInput()
  }
  const { default: koffi } = await import('koffi')
  if (platform === 'win32') return windowsInput(koffi, bounds)
  if (platform === 'darwin') return macInput(koffi, bounds)
  if (platform === 'linux') return x11Input(koffi, bounds)
  throw new Error('이 운영체제는 원격 입력을 지원하지 않습니다.')
}
