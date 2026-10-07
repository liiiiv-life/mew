import { REMOTE_LIMITS, REMOTE_REQUEST_HEADERS, parseRemoteFrame, remotePath, type RemoteFrame } from '../../shared/remote-access.ts'
export interface AppTransport { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; socket(url: string, protocols?: string | string[]): WebSocket; close(): void }
let remote: AppTransport | null = null
let remoteMode = false
export const activeRemoteTransport = () => remote
export const isRemoteMode = () => remoteMode
export function setRemoteTransport(transport: AppTransport | null) { remoteMode = true; const old = remote; remote = transport; if (old && old !== transport) old.close() }
export function mewFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> { return remote ? remote.fetch(input, init) : remoteMode ? Promise.reject(new Error('기기 연결이 종료됐습니다. 다시 연결해 주세요.')) : globalThis.fetch(input, init) }
export function openMewSocket(url: string | URL, protocols?: string | string[]): WebSocket { if (remote) return remote.socket(String(url), protocols); if (remoteMode) throw new Error('기기 연결이 종료됐습니다.'); return new WebSocket(url, protocols) }
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''))
const decode = (data: string) => Uint8Array.from(atob(data), char => char.charCodeAt(0))
type PendingRequest = { resolve(response: Response): void; reject(error: Error): void; controller?: ReadableStreamDefaultController<Uint8Array>; cleanup(): void; responseStarted(): void; responded: boolean; window?: number; outstanding?: number }
export class DataChannelTransport implements AppTransport {
  channel: RTCDataChannel
  requests = new Map<string, PendingRequest>()
  sockets = new Map<string, RemoteSocket>()
  closed = false
  constructor(channel: RTCDataChannel) {
    this.channel = channel
    channel.addEventListener('message', this.receive)
    channel.addEventListener('close', () => this.close())
    channel.addEventListener('error', () => this.close())
  }
  async send(frame: RemoteFrame) {
    if (this.closed || this.channel.readyState !== 'open') throw new Error('원격 연결이 종료됐습니다.')
    const data = JSON.stringify(frame)
    if (new TextEncoder().encode(data).byteLength > REMOTE_LIMITS.frame) throw new Error('전송 크기를 초과했습니다.')
    const deadline = Date.now() + 10_000
    while (this.channel.bufferedAmount > REMOTE_LIMITS.queue) {
      if (this.closed || this.channel.readyState !== 'open' || Date.now() > deadline) throw new Error('원격 연결이 응답하지 않습니다.')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    this.channel.send(data)
  }
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), location.origin), init)
    const url = new URL(request.url)
    if (url.origin !== location.origin || !remotePath(url.pathname + url.search)) throw new Error('이 요청은 원격 접속에서 지원되지 않습니다.')
    if (this.requests.size + this.sockets.size >= REMOTE_LIMITS.streams) throw new Error('동시 요청 한도를 초과했습니다.')
    const id = crypto.randomUUID(), signal = request.signal
    return new Promise<Response>((resolve, reject) => {
      const abort = () => { const pending = this.requests.get(id); pending?.controller?.error(new DOMException('취소됐습니다.', 'AbortError')); pending?.reject(new DOMException('취소됐습니다.', 'AbortError')); this.requests.delete(id); cleanup(); void this.send({ type: 'cancel', id }).catch(() => {}) }
      let timer = setTimeout(abort, 30_000)
      const progress = () => { if (!this.requests.get(id)?.responded) { clearTimeout(timer); timer = setTimeout(abort, 30_000) } }
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      this.requests.set(id, { resolve, reject, cleanup, responseStarted: () => clearTimeout(timer), responded: false })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      void (async () => {
        const headers = Object.fromEntries([...request.headers].filter(([key]) => (REMOTE_REQUEST_HEADERS as readonly string[]).includes(key)))
        await this.send({ type: 'request', id, method: request.method, path: url.pathname + url.search, headers, responseWindow: REMOTE_LIMITS.responseWindow })
        if (!['GET', 'HEAD'].includes(request.method)) {
          const reader = request.body?.getReader(); let size = 0
          try {
            while (reader) {
              if (signal.aborted || !this.requests.has(id) || this.requests.get(id)?.responded) { await reader.cancel(); break }
              const result = await reader.read(); if (result.done) break
              size += result.value.byteLength; if (size > REMOTE_LIMITS.body) throw new Error('파일이 전송 한도를 초과했습니다.')
              for (let offset = 0; offset < result.value.byteLength; offset += REMOTE_LIMITS.chunk) {
                if (signal.aborted || !this.requests.has(id) || this.requests.get(id)?.responded) break
                await this.send({ type: 'chunk', id, data: encode(result.value.subarray(offset, offset + REMOTE_LIMITS.chunk)) }); progress()
              }
            }
          } finally { reader?.releaseLock() }
          if (this.requests.has(id) && !this.requests.get(id)?.responded) await this.send({ type: 'end', id })
        }
      })().catch(error => { const pending = this.requests.get(id); pending?.cleanup(); this.requests.delete(id); reject(error); void this.send({ type: 'cancel', id }).catch(() => {}) })
    })
  }
  socket(url: string, _protocols?: string | string[]) {
    const parsed = new URL(url, location.origin)
    if (parsed.host !== location.host || !remotePath(parsed.pathname + parsed.search, true)) throw new Error('지원하지 않는 원격 소켓입니다.')
    if (this.requests.size + this.sockets.size >= REMOTE_LIMITS.streams) throw new Error('동시 연결 한도를 초과했습니다.')
    const id = crypto.randomUUID(), socket = new RemoteSocket(this, id, url)
    this.sockets.set(id, socket)
    void this.send({ type: 'socket', id, path: parsed.pathname + parsed.search }).catch(() => socket.finish(1006))
    return socket as unknown as WebSocket
  }
  receive = (event: MessageEvent) => {
    try {
      const frame = parseRemoteFrame(event.data), pending = this.requests.get(frame.id), socket = this.sockets.get(frame.id)
      if (socket) {
        if (frame.type === 'open') { socket.readyState = WebSocket.OPEN; socket.fire(new Event('open')) }
        if (frame.type === 'message') { socket.message(frame) }
        if (frame.type === 'close' || frame.type === 'error') socket.finish(frame.type === 'close' ? frame.code ?? 1000 : 1006)
        return
      }
      if (!pending) return
      if (frame.type === 'response') {
        if (pending.responded || !Number.isInteger(frame.status) || frame.status < 200 || frame.status > 599) throw new Error('invalid-response')
        pending.responded = true
        pending.responseStarted()
        pending.window = frame.responseWindow ?? 1
        pending.outstanding = frame.responseWindow ?? 0
        const replenish = () => {
          if (!this.requests.has(frame.id) || !pending.controller) return
          const free = Math.floor((pending.controller.desiredSize ?? 0) / REMOTE_LIMITS.chunk)
          const count = Math.max(0, Math.min(pending.window!, free) - pending.outstanding!)
          pending.outstanding! += count
          for (let i = 0; i < count; i++) void this.send({ type: 'credit', id: frame.id }).catch(() => this.close())
        }
        const stream = new ReadableStream<Uint8Array>({
          start: controller => { pending.controller = controller },
          pull: replenish,
          cancel: () => { pending.cleanup(); this.requests.delete(frame.id); void this.send({ type: 'cancel', id: frame.id }).catch(() => {}) },
        }, { highWaterMark: pending.window * REMOTE_LIMITS.chunk, size: bytes => bytes.byteLength })
        pending.resolve(new Response([204, 205, 304].includes(frame.status) ? null : stream, { status: frame.status, headers: frame.headers })); return
      }
      if (frame.type === 'chunk') {
        const bytes = decode(frame.data)
        if (!pending.controller || !pending.outstanding || (pending.controller.desiredSize ?? 0) < bytes.byteLength) throw new Error('response-limit')
        pending.outstanding--
        pending.controller.enqueue(bytes)
        return
      }
      if (frame.type === 'end') { pending.controller?.close(); pending.cleanup(); this.requests.delete(frame.id); return }
      if (frame.type === 'error') { const error = new Error('원격 요청이 중단됐습니다. 결과를 확인한 뒤 다시 시도해 주세요.'); pending.controller?.error(error); pending.reject(error); pending.cleanup(); this.requests.delete(frame.id) }
    } catch { this.close() }
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.channel.removeEventListener('message', this.receive)
    for (const pending of this.requests.values()) { const error = new Error('원격 연결이 종료됐습니다.'); pending.controller?.error(error); pending.reject(error); pending.cleanup() }
    this.requests.clear()
    for (const socket of this.sockets.values()) socket.finish(1006)
    this.channel.close()
  }
}
class RemoteSocket extends EventTarget {
  transport: DataChannelTransport; id: string; url: string
  readyState: number = WebSocket.CONNECTING
  binaryType = 'blob'
  bufferedAmount = 0
  protocol = ''; extensions = ''
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  queue = Promise.resolve()
  parts: Uint8Array[] = []; receivedBytes = 0; sequence = 0
  constructor(transport: DataChannelTransport, id: string, url: string) { super(); this.transport = transport; this.id = id; this.url = url }
  fire(event: Event) { this.dispatchEvent(event); (this[`on${event.type}` as 'onopen'] as ((event: Event) => void) | null)?.(event) }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== WebSocket.OPEN) throw new DOMException('소켓이 열리지 않았습니다.', 'InvalidStateError')
    const binary = typeof data !== 'string'
    const snapshot = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? data : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() : new Uint8Array(data).slice()
    const size = snapshot instanceof Blob ? snapshot.size : snapshot.byteLength
    if (size > REMOTE_LIMITS.body || this.bufferedAmount + size > REMOTE_LIMITS.body) { this.close(); throw new DOMException('전송 대기열 한도를 초과했습니다.', 'QuotaExceededError') }
    this.bufferedAmount += size
    this.queue = this.queue.then(async () => {
      try {
        if (this.readyState !== WebSocket.OPEN) return
        const bytes = snapshot instanceof Blob ? new Uint8Array(await snapshot.arrayBuffer()) : snapshot
        if (!bytes.length) await this.transport.send({ type: 'message', id: this.id, data: '', binary })
        for (let offset = 0, part = 0; offset < bytes.length; offset += REMOTE_LIMITS.chunk, part++) await this.transport.send({ type: 'message', id: this.id, data: encode(bytes.subarray(offset, offset + REMOTE_LIMITS.chunk)), binary, sequence: part, final: offset + REMOTE_LIMITS.chunk >= bytes.length })
      } finally { this.bufferedAmount -= size }
    }).catch(() => { void this.transport.send({ type: 'close', id: this.id }).catch(() => {}); this.finish(1006) })
  }
  message(frame: Extract<RemoteFrame, { type: 'message' }>) {
    const part = decode(frame.data); this.receivedBytes += part.byteLength
    if (this.receivedBytes > REMOTE_LIMITS.body || (frame.sequence !== undefined && frame.sequence !== this.sequence++)) throw new Error('message-limit')
    this.parts.push(part)
    if (frame.sequence !== undefined && !frame.final) return
    const bytes = new Uint8Array(this.receivedBytes); let offset = 0
    for (const part of this.parts) { bytes.set(part, offset); offset += part.byteLength }
    this.parts = []; this.receivedBytes = 0; this.sequence = 0
    this.fire(new MessageEvent('message', { data: frame.binary ? this.binaryType === 'arraybuffer' ? bytes.buffer : new Blob([bytes]) : new TextDecoder().decode(bytes) }))
  }
  close() { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSING; void this.transport.send({ type: 'close', id: this.id }).catch(() => {}); this.finish(1000) }
  finish(code: number) { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSED; this.transport.sockets.delete(this.id); this.fire(new CloseEvent('close', { code, wasClean: code === 1000 })) }
}
