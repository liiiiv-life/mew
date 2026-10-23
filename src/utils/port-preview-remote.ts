import { mewFetch, openMewSocket } from './remote-transport.ts'
import { PORT_PREVIEW_API, validPreviewPort, type PortPreviewSession } from '../../shared/port-preview.ts'

let previewDomain = ''
export function configureRemotePortPreview(domain: string | undefined) {
  previewDomain = domain && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain) ? domain : ''
}
export async function mountRemotePortPreview(frame: HTMLIFrameElement, options: { port: number; path?: string }): Promise<() => void> {
  if (!previewDomain) throw new Error('Mewlink PREVIEW_DOMAIN과 와일드카드 DNS/Worker 경로를 설정해야 포트 미리보기를 열 수 있습니다.')
  if (!validPreviewPort(options.port)) throw new Error('포트가 올바르지 않습니다.')
  const path = options.path ?? '/'
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new Error('미리보기 경로가 올바르지 않습니다.')
  const response = await mewFetch(`${PORT_PREVIEW_API}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options) })
  if (!response.ok) throw new Error((await response.text()).slice(0, 200))
  const session = await response.json() as PortPreviewSession
  const origin = `https://${crypto.randomUUID().replaceAll('-', '')}.${previewDomain}`
  const bridge = new MessageChannel(), controllers = new Set<AbortController>(), sockets = new Set<WebSocket>()
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true; window.removeEventListener('message', ready)
    for (const controller of controllers) controller.abort()
    for (const socket of sockets) socket.close()
    bridge.port1.close(); frame.removeAttribute('src')
    void mewFetch(`${PORT_PREVIEW_API}/session`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: session.token }) }).catch(() => {})
  }
  bridge.port1.onmessage = event => {
    const value = event.data, port = event.ports[0]
    if (disposed || !port || !value || typeof value.path !== 'string' || value.path.length > 8192 || !value.path.startsWith('/') || value.path.startsWith('//') || /[\\\r\n#]/.test(value.path)) { port?.close(); return }
    if (value.type === 'fetch') {
      const controller = new AbortController(); controllers.add(controller)
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reading = false
      const close = () => { controller.abort(); void reader?.cancel().catch(() => {}); controllers.delete(controller); port.close() }
      port.onmessage = ({ data }) => {
        if (data?.type === 'cancel') { close(); return }
        if (data?.type !== 'pull' || reading || !reader) return
        reading = true
        void reader.read().then(result => {
          if (result.done) { port.postMessage({ type: 'end' }); close() }
          else { const bytes = result.value.slice().buffer; port.postMessage({ type: 'chunk', bytes }, [bytes]) }
        }).catch(() => { port.postMessage({ type: 'error' }); close() }).finally(() => { reading = false })
      }
      const allowedMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
      if (!allowedMethods.includes(value.method) || (value.body !== undefined && (!(value.body instanceof ArrayBuffer) || value.body.byteLength > 25 * 1024 * 1024))) { close(); return }
      const cookies = value.path === '/__mew_preview_cookies'
      const target = `${PORT_PREVIEW_API}/${session.token}/${cookies ? 'cookies' : `raw${value.path}`}`
      void mewFetch(target, { method: value.method, headers: Array.isArray(value.headers) ? value.headers : [], body: ['GET', 'HEAD'].includes(value.method) ? undefined : value.body, signal: controller.signal, redirect: 'manual' }).then(result => {
        reader = result.body?.getReader()
        port.postMessage({ type: 'response', status: result.status, headers: [...result.headers] })
        if (!reader) { port.postMessage({ type: 'end' }); close() }
      }).catch(() => { port.postMessage({ type: 'error' }); close() })
    } else if (value.type === 'socket') {
      if (sockets.size >= 16 || !Array.isArray(value.protocols) || value.protocols.some((item: unknown) => typeof item !== 'string' || item.length > 256 || !/^[!#$%&'*+\-.^_`|~\w]+$/.test(item))) { port.close(); return }
      try {
        const socket = openMewSocket(`${PORT_PREVIEW_API}/ws?token=${encodeURIComponent(session.token)}&path=${encodeURIComponent(value.path)}&protocols=${encodeURIComponent(value.protocols.join(','))}`, value.protocols)
        sockets.add(socket); socket.binaryType = 'arraybuffer'
        socket.onopen = () => port.postMessage({ type: 'open', protocol: socket.protocol })
        socket.onmessage = event => { if (event.data instanceof ArrayBuffer) port.postMessage({ type: 'message', data: event.data }, [event.data]); else port.postMessage({ type: 'message', data: String(event.data) }) }
        socket.onclose = event => { sockets.delete(socket); port.postMessage({ type: 'close', code: event.code }); port.close() }
        socket.onerror = () => port.postMessage({ type: 'error' })
        port.onmessage = ({ data }) => { if (data?.type === 'close') socket.close(); else if (data?.type === 'message' && (typeof data.data === 'string' || data.data instanceof ArrayBuffer) && socket.readyState === WebSocket.OPEN) socket.send(data.data) }
      } catch { port.postMessage({ type: 'error' }); port.close() }
    } else port.close()
  }
  const ready = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.type !== 'mew-preview-ready' || disposed) return
    window.removeEventListener('message', ready)
    frame.contentWindow!.postMessage({ type: 'mew-preview-init', path, port: options.port }, origin, [bridge.port2])
  }
  window.addEventListener('message', ready)
  frame.removeAttribute('sandbox'); frame.referrerPolicy = 'no-referrer'; frame.src = `${origin}/__mew_preview_launch`
  return cleanup
}
