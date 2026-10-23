;(() => {
  const port = Number(parent.document.querySelector('iframe')?.title.split(':')[1])
  const rewrite = raw => {
    const url = new URL(String(raw), location.href)
    if (/^(?:localhost|127\.[0-9.]+|\[::1\])$/.test(url.hostname) && Number(url.port) === port) {
      url.hostname = location.hostname; url.port = location.port
      url.protocol = /^wss?:$/.test(url.protocol) ? 'wss:' : location.protocol
    }
    return url
  }
  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, options) => input instanceof Request ? nativeFetch(new Request(rewrite(input.url), input), options) : nativeFetch(rewrite(input), options)
  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function(method, url, ...args) { return originalOpen.call(this, method, rewrite(url).href, ...args) }
  class PreviewSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
    CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3
    readyState = 0; binaryType = 'blob'; bufferedAmount = 0; extensions = ''; protocol = ''
    onopen = null; onmessage = null; onerror = null; onclose = null
    constructor(raw, protocols = []) {
      super(); const url = rewrite(raw); this.url = url.href
      if (!/^wss?:$/.test(url.protocol) || url.hostname !== location.hostname || url.port !== location.port) throw new DOMException('Only this preview port is available', 'SecurityError')
      const names = typeof protocols === 'string' ? [protocols] : [...protocols], channel = new MessageChannel()
      this.channel = channel.port1
      this.queue = Promise.resolve()
      for (const type of ['open', 'message', 'error', 'close']) this.addEventListener(type, event => this['on' + type]?.call(this, event))
      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'open') { this.readyState = 1; this.protocol = data.protocol ?? ''; this.dispatchEvent(new Event('open')) }
        else if (data.type === 'message') this.dispatchEvent(new MessageEvent('message', { data: data.data instanceof ArrayBuffer && this.binaryType !== 'arraybuffer' ? new Blob([data.data]) : data.data }))
        else if (data.type === 'error') this.dispatchEvent(new Event('error'))
        else if (data.type === 'close') { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: data.code ?? 1006 })); channel.port1.close() }
      }
      parent.postMessage({ type: 'mew-preview-socket', request: { type: 'socket', path: url.pathname + url.search, protocols: names } }, location.origin, [channel.port2])
    }
    send(value) {
      if (this.readyState !== 1) throw new DOMException('WebSocket is not open', 'InvalidStateError')
      const snapshot = typeof value === 'string' ? value : value instanceof Blob ? value : ArrayBuffer.isView(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value.slice(0)
      this.queue = this.queue.then(async () => { const data = snapshot instanceof Blob ? await snapshot.arrayBuffer() : snapshot; if (this.readyState === 1) this.channel.postMessage({ type: 'message', data }, data instanceof ArrayBuffer ? [data] : []) })
    }
    close() { if (this.readyState >= 2) return; this.readyState = 2; this.channel.postMessage({ type: 'close' }) }
  }
  window.WebSocket = PreviewSocket
  let cookies = new Map()
  const updateCookies = () => nativeFetch('/__mew_preview_cookies').then(response => response.json()).then(value => { cookies = new Map(Object.entries(value)) }).catch(() => {})
  try { Object.defineProperty(Document.prototype, 'cookie', { configurable: true, get() { return [...cookies].map(([key, value]) => key + '=' + value).join('; ') }, set(value) { const first = String(value).split(';')[0], at = first.indexOf('='); if (at > 0) cookies.set(first.slice(0, at).trim(), first.slice(at + 1)); void nativeFetch('/__mew_preview_cookies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: String(value) }) }).then(updateCookies) } }) } catch {}
  void updateCookies()
})()
