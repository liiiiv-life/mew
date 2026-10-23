import { randomBytes } from 'node:crypto'
import { KEY_CODES } from './keys.mjs'
import { closeSync, fstatSync } from 'node:fs'

/** The desktop portal owns Wayland input authorization; never fall back to XWayland injection. */
export async function portalInput({ load = () => import('dbus-next'), capture = false, closeFd = closeSync, signal } = {}) {
  signal?.throwIfAborted()
  const { default: dbus } = await load()
  const bus = dbus.sessionBus({ negotiateUnixFd: capture }), destination = 'org.freedesktop.portal.Desktop'
  let session, proxy, closed = false, closing, chain = Promise.resolve(), failure = null, queued = 0, fd, source
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
      const cleanup = () => { clearTimeout(timer); bus.off('message', response); signal?.removeEventListener('abort', aborted); void daemon.RemoveMatch(match).catch(() => {}) }
      const aborted = () => { cleanup(); reject(new Error('화면 공유 승인이 취소됐습니다.')) }
      const response = (message) => {
        if (message.path !== requestPath || message.member !== 'Response') return
        cleanup()
        if (message.body[0] !== 0) reject(new Error('Linux 화면 공유/원격 제어 승인이 취소됐습니다.'))
        else resolve(message.body[1])
      }
      const timer = setTimeout(() => { cleanup(); reject(new Error('Linux 데스크톱에서 원격 제어 승인을 완료해 주세요.')) }, 60_000)
      bus.on('message', response)
      signal?.addEventListener('abort', aborted, { once: true })
      if (signal?.aborted) { aborted(); return }
      desktop[method](...args, { ...options, handle_token: variant('s', handle) }).catch((error) => { cleanup(); reject(error) })
    })
  }
  try {
    const object = await bus.getProxyObject(destination, '/org/freedesktop/portal/desktop')
    desktop = object.getInterface('org.freedesktop.portal.RemoteDesktop')
    const created = await request('CreateSession', [], { session_handle_token: variant('s', token()) })
    session = created.session_handle.value
    await request('SelectDevices', [session], { types: variant('u', 3), persist_mode: variant('u', 0) })
    if (capture) {
      const screenCast = object.getInterface('org.freedesktop.portal.ScreenCast')
      const remote = desktop; desktop = screenCast
      try { await request('SelectSources', [session], { types: variant('u', 1), multiple: variant('b', false), cursor_mode: variant('u', 2) }) }
      finally { desktop = remote }
    }
    const result = await request('Start', [session, ''], {})
    if (!(result.devices?.value & 2)) throw new Error('Linux 포인터 제어 권한이 필요합니다.')
    proxy = (await bus.getProxyObject(destination, session)).getInterface('org.freedesktop.portal.Session')
    proxy.on('Closed', () => { closed = true; failure = new Error('Linux 원격 제어 권한이 종료됐습니다.') })
    if (capture) {
      const streams = result.streams?.value
      if (!Array.isArray(streams) || streams.length !== 1 || !Number.isInteger(streams[0][0]) || streams[0][0] <= 0) throw new Error('승인한 Wayland 화면을 찾지 못했습니다.')
      const received = await object.getInterface('org.freedesktop.portal.ScreenCast').OpenPipeWireRemote(session, {})
      if (!Number.isInteger(received) || received < 3) throw new Error('PipeWire 소켓 핸들을 받지 못했습니다.')
      fd = received
      if (!fstatSync(fd).isSocket()) throw new Error('PipeWire 소켓 핸들을 받지 못했습니다. Unix FD 지원을 확인해 주세요.')
      const size = streams[0][1].size?.value, position = streams[0][1].position?.value ?? [0, 0]
      if (!Array.isArray(size) || size.length !== 2 || size.some(value => !Number.isInteger(value) || value < 1 || value > 32768)) throw new Error('Wayland 화면 크기를 확인하지 못했습니다.')
      source = { fd, node: streams[0][0], bounds: { x: position[0], y: position[1], width: size[0], height: size[1] } }
    }
    const call = (method, ...args) => {
      if (failure) throw failure
      if (queued >= 32) throw new Error('Linux 원격 입력이 지연됐습니다. 다시 연결해 주세요.')
      queued++
      chain = chain.then(() => { if (!closed) return desktop[method](session, {}, ...args) }).catch(() => { failure = new Error('Linux 원격 입력이 거부됐습니다.') }).finally(() => { queued-- })
    }
    return {
      check() { if (failure) throw failure; if (closed) throw new Error('Linux 원격 제어 권한이 종료됐습니다.') },
      move(dx, dy) { call('NotifyPointerMotion', dx, dy) },
      // No absolute position is exposed without a matching portal ScreenCast stream.
      button(bit, down) { call('NotifyPointerButton', bit === 1 ? 272 : bit === 2 ? 274 : 273, down ? 1 : 0) },
      wheel(dx, dy) { call('NotifyPointerAxis', dx, dy) },
      key(code, down) { if (result.devices?.value & 1 && KEY_CODES[code]) call('NotifyKeyboardKeycode', KEY_CODES[code].evdev, down ? 1 : 0) },
      async close() {
        closing ??= (async () => {
          try { await chain; if (!closed) await proxy.Close().catch(() => {}) }
          finally { closed = true; bus.disconnect(); if (fd !== undefined) { closeFd(fd); fd = undefined } }
        })()
        return closing
      },
      relativeOnly: true,
      source,
    }
  } catch (error) {
    try { if (session) await (await bus.getProxyObject(destination, session)).getInterface('org.freedesktop.portal.Session').Close() } catch { /* Preserve the original permission error. */ }
    bus.disconnect(); if (fd !== undefined) closeFd(fd); throw error
  }
}
