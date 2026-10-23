import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { windowsInput, macInput, x11Input } from './input-native.mjs'
import { windowsClipboard } from './clipboard-windows.mjs'
import { windowsNotification } from './notification-windows.mjs'
import { portalInput } from './input-portal.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
export async function nativePlatform(koffi) {
  if (process.platform === 'win32') {
    const user = koffi.load('user32.dll'), open = user.func('void *OpenInputDesktop(uint32, bool, uint32)'), close = user.func('bool CloseDesktop(void *)')
    const name = user.func('bool GetUserObjectInformationW(void *, int, void *, uint32, void *)')
    const clipboard = windowsClipboard(koffi)
    return {
      readClipboard: clipboard.read,
      localCursor: true, input: bounds => windowsInput(koffi, bounds), clipboard, notify: windowsNotification(koffi),
      allowed() {
        const desktop = open(0, false, 1); if (!desktop) return false
        const buffer = Buffer.alloc(256), size = Buffer.alloc(4)
        try { return name(desktop, 2, buffer, buffer.length, size) && buffer.toString('utf16le').split('\0')[0].toLowerCase() === 'default' }
        finally { close(desktop) }
      },
    }
  }
  if (process.platform === 'darwin') {
    const library = koffi.load(path.join(directory, 'gpu-macos.dylib'))
    const allowed = library.func('int mew_gpu_allowed()'), pump = library.func('void mew_gpu_pump()')
    const readClipboard = library.func('int mew_gpu_clipboard_read(void *, int)')
    const clipboard = library.func('int mew_gpu_clipboard(const char *)'), notice = library.func('void mew_gpu_notice(int)')
    let loop
    return {
      localCursor: false, allowed: () => !!allowed(), pump, input: bounds => macInput(koffi, bounds),
      begin() { loop ??= setInterval(pump, 16) }, end() { clearInterval(loop); loop = undefined }, close() { clearInterval(loop) },
      prepare() { if (!allowed()) throw new Error('서버 Mac에서 Mew Desktop의 화면 기록·손쉬운 사용 권한을 허용해 주세요. ./mew desktop-setup으로 준비할 수 있습니다.') },
      readClipboard() { const buffer = Buffer.alloc(16 * 1024); if (readClipboard(buffer, buffer.length) < 0) throw new Error('Mac 클립보드를 읽지 못했습니다.'); return buffer.toString('utf8').split('\0')[0] },
      clipboard(text) { if (clipboard(text) !== 0) throw new Error('Mac 붙여넣기에 실패했습니다.') },
      notify() { notice(1); return () => notice(0) },
    }
  }
  if (process.platform !== 'linux') throw new Error('지원하지 않는 원격 데스크톱 OS입니다.')
  const wayland = !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland'
  const dbus = (await import('dbus-next')).default
  let lockBus, broken = false, clip
  const locks = new Map()
  // Desktop lock signals are cached so the input hot path never waits for D-Bus.
  if (process.env.DBUS_SESSION_BUS_ADDRESS) {
    lockBus = dbus.sessionBus(); lockBus.on('error', () => { broken = true })
    const bounded = async promise => {
      let timer
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('잠금 서비스 응답 시간이 초과됐습니다.')), 1000) })]) }
      finally { clearTimeout(timer) }
    }
    try {
      const daemon = (await bounded(lockBus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus'))).getInterface('org.freedesktop.DBus')
      daemon.on('NameOwnerChanged', (service, _previous, owner) => { if (locks.has(service) && !owner) broken = true })
      for (const [service, location] of [['org.freedesktop.ScreenSaver', '/ScreenSaver'], ['org.gnome.ScreenSaver', '/org/gnome/ScreenSaver']]) {
        if (!await bounded(daemon.NameHasOwner(service))) continue
        try {
          const object = await bounded(lockBus.getProxyObject(service, location)), proxy = object.getInterface(service)
          locks.set(service, await bounded(proxy.GetActive()) === true)
          proxy.on('ActiveChanged', value => { locks.set(service, value === true) })
        } catch { broken = true }
      }
    } catch { broken = true }
  }
  const releaseClipboard = () => { clip?.kill('SIGTERM'); clip = undefined }
  return {
    localCursor: false, relativeOnly: wayland, allowed: () => !broken && locks.size > 0 && ![...locks.values()].some(Boolean),
    async prepare(signal) {
      if (!locks.size || broken) throw new Error('Linux 잠금 상태를 확인하지 못했습니다. 로그인한 데스크톱의 사용자 D-Bus·ScreenSaver 서비스를 확인해 주세요.')
      if ([...locks.values()].some(Boolean)) throw new Error('Linux 데스크톱의 잠금을 해제해 주세요.')
      if (wayland) {
        try { await import('usocket') } catch { throw new Error('Wayland의 Unix FD 모듈이 없습니다. C++·Python 빌드 도구를 준비하고 보조앱을 다시 설치해 주세요.') }
        return portalInput({ capture: true, signal })
      }
    },
    input: bounds => x11Input(koffi, bounds),
    async readClipboard() {
      const { stdout } = await promisify(execFile)(wayland ? 'wl-paste' : 'xclip', wayland ? ['--no-newline', '--type', 'text'] : ['-selection', 'clipboard', '-o'], { timeout: 2000, maxBuffer: 16 * 1024, encoding: 'utf8' })
      return stdout
    },
    async clipboard(text) {
      releaseClipboard()
      const child = spawn(wayland ? 'wl-copy' : 'xclip', wayland ? ['--foreground', '--paste-once'] : ['-selection', 'clipboard', '-quiet', '-loops', '1'], { stdio: ['pipe', 'ignore', 'ignore'] })
      clip = child
      await new Promise((resolve, reject) => {
        child.once('error', reject); child.stdin.once('error', reject)
        child.once('exit', code => { if (code) reject(new Error('Linux 붙여넣기에는 wl-copy 또는 xclip이 필요합니다.')) })
        child.stdin.end(text, () => setTimeout(resolve, 30))
      })
    },
    releaseClipboard,
    notify() {
      let cancelled = false, bus, proxy, id
      const close = () => { if (cancelled) return; cancelled = true; clearTimeout(timer); if (id && proxy) void proxy.CloseNotification(id).catch(() => {}); bus?.disconnect() }
      const timer = setTimeout(close, 5000); timer.unref()
      void (async () => {
        bus = dbus.sessionBus(); bus.on('error', close)
        proxy = (await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications')).getInterface('org.freedesktop.Notifications')
        if (!cancelled) id = await proxy.Notify('Mew', 0, '', 'mew 원격 데스크톱 연결됨', '이 PC에 원격으로 연결되었습니다.', [], {}, 4000)
        if (cancelled) bus.disconnect()
      })().catch(close)
      return close
    },
    close() { releaseClipboard(); lockBus?.disconnect() },
  }
}
