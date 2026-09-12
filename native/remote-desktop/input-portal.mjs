import { randomBytes } from 'node:crypto'
import { KEY_CODES } from './keys.mjs'

/** The desktop portal owns Wayland input authorization; never fall back to XWayland injection. */
export async function portalInput({ load = () => import('dbus-next') } = {}) {
  const { default: dbus } = await load()
  const bus = dbus.sessionBus(), destination = 'org.freedesktop.portal.Desktop'
  let session, proxy, closed = false, chain = Promise.resolve(), failure = null, queued = 0
  bus.on('error', () => { failure = new Error('Linux 원격 제어 연결이 끊겼습니다.') })
  const token = () => `mew${randomBytes(12).toString('hex')}`
  const variant = (type, value) => new dbus.Variant(type, value)
  let desktop
  // Subscribe to the predictable Request path before invoking a portal method (response can race).
  async function request(method, args, options) {
    const handle = token(), sender = bus.name.slice(1).replaceAll('.', '_')
    const requestPath = `/org/freedesktop/portal/desktop/request/${sender}/${handle}`
    const match = `type='signal',sender='${destination}',interface='org.freedesktop.portal.Request',member='Response',path='${requestPath}'`
    const daemon = (await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus')
    await daemon.AddMatch(match)
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); bus.off('message', response); void daemon.RemoveMatch(match).catch(() => {}) }
      const response = (message) => {
        if (message.path !== requestPath || message.member !== 'Response') return
        cleanup()
        if (message.body[0] !== 0) reject(new Error('Linux 화면 공유/원격 제어 승인이 취소됐습니다.'))
        else resolve(message.body[1])
      }
      const timer = setTimeout(() => { cleanup(); reject(new Error('Linux 데스크톱에서 원격 제어 승인을 완료해 주세요.')) }, 60_000)
      bus.on('message', response)
      desktop[method](...args, { ...options, handle_token: variant('s', handle) }).catch((error) => { cleanup(); reject(error) })
    })
  }
  try {
    const object = await bus.getProxyObject(destination, '/org/freedesktop/portal/desktop')
    desktop = object.getInterface('org.freedesktop.portal.RemoteDesktop')
    const created = await request('CreateSession', [], { session_handle_token: variant('s', token()) })
    session = created.session_handle.value
    await request('SelectDevices', [session], { types: variant('u', 3), persist_mode: variant('u', 0) })
    const result = await request('Start', [session, ''], {})
    if (!(result.devices?.value & 2)) throw new Error('Linux 포인터 제어 권한이 필요합니다.')
    proxy = (await bus.getProxyObject(destination, session)).getInterface('org.freedesktop.portal.Session')
    proxy.on('Closed', () => { closed = true; failure = new Error('Linux 원격 제어 권한이 종료됐습니다.') })
    const call = (method, ...args) => {
      if (failure) throw failure
      if (queued >= 32) throw new Error('Linux 원격 입력이 지연됐습니다. 다시 연결해 주세요.')
      queued++
      chain = chain.then(() => { if (!closed) return desktop[method](session, {}, ...args) }).catch(() => { failure = new Error('Linux 원격 입력이 거부됐습니다.') }).finally(() => { queued-- })
    }
    return {
      move(dx, dy) { call('NotifyPointerMotion', dx, dy) },
      // No absolute position is exposed without a matching portal ScreenCast stream.
      button(bit, down) { call('NotifyPointerButton', bit === 1 ? 272 : bit === 2 ? 274 : 273, down ? 1 : 0) },
      wheel(dx, dy) { call('NotifyPointerAxis', dx, dy) },
      key(code, down) { if (result.devices?.value & 1 && KEY_CODES[code]) call('NotifyKeyboardKeycode', KEY_CODES[code].evdev, down ? 1 : 0) },
      async close() { await chain; if (!closed) await proxy.Close().catch(() => {}); closed = true; bus.disconnect() },
      relativeOnly: true,
    }
  } catch (error) {
    try { if (session) await (await bus.getProxyObject(destination, session)).getInterface('org.freedesktop.portal.Session').Close() } catch { /* Preserve the original permission error. */ }
    bus.disconnect(); throw error
  }
}
