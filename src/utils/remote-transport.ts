import { previewRemotePath } from '../../shared/port-preview.ts'
import { REMOTE_FLOW_CONTROL, REMOTE_LIMITS, REMOTE_REQUEST_HEADERS, parseRemoteFrame, remotePath, type RemoteFrame } from '../../shared/remote-access.ts'
import { RemoteStreamSlots } from './remote-stream-slots.ts'
import { decodeRemoteBytes as decode, encodeRemoteBytes as encode } from './remote-codec.ts'
import { RemoteReceiveWindow } from './remote-receive-window.ts'
import { getAppRuntime, type AppTransport } from '../runtime/app-runtime.ts'
export type { AppTransport } from '../runtime/app-runtime.ts'
let remote: AppTransport | null = null
let remoteMode = false
export const activeRemoteTransport = () => remote
export const isRemoteMode = () => remoteMode
export function setRemoteTransport(transport: AppTransport | null) { remoteMode = true; const old = remote; remote = transport; if (old && old !== transport) old.close() }
export function mewFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const transport = getAppRuntime().transport ?? remote
  if (transport) return transport.fetch(input, init)
  if (remoteMode) return Promise.reject(new Error('기기 연결이 종료됐습니다. 다시 연결해 주세요.'))
  return globalThis.fetch(input, init)
}
export function openMewSocket(url: string | URL, protocols?: string | string[]): WebSocket {
  const transport = getAppRuntime().transport ?? remote
  if (transport) return transport.socket(String(url), protocols)
  if (remoteMode) throw new Error('기기 연결이 종료됐습니다.')
  return new WebSocket(url, protocols)
}
type PendingRequest = { resolve(response: Response): void; reject(error: Error): void; controller?: ReadableStreamDefaultController<Uint8Array>; cleanup(): void; responseStarted(): void; responded: boolean; sentAt: number; window?: number; outstanding?: number; flow?: RemoteReceiveWindow; queuedBytes?: number }
export class DataChannelTransport implements AppTransport {
  channel: RTCDataChannel
  requests = new Map<string, PendingRequest>()
  sockets = new Map<string, RemoteSocket>()
  closed = false
  suspended = false
  private generation = 0
  private slots = new RemoteStreamSlots()
  private forwarded = new Map<string, { ready: Promise<void>; outgoing: Promise<void>; admission: AbortController; release?: () => void; socket: boolean }>()
  constructor(channel: RTCDataChannel) {
    this.channel = channel
    channel.addEventListener('message', this.receive)
    channel.addEventListener('close', () => this.close())
    channel.addEventListener('error', () => this.close())
  }
  async send(frame: RemoteFrame) {
    const generation = this.generation
    const available = () => !this.closed && !this.suspended && generation === this.generation && this.channel.readyState === 'open'
    if (!available()) throw new Error('원격 연결이 종료됐습니다.')
    const data = JSON.stringify(frame)
    if (new TextEncoder().encode(data).byteLength > REMOTE_LIMITS.frame) throw new Error('전송 크기를 초과했습니다.')
    const deadline = Date.now() + 10_000
    while (this.channel.bufferedAmount > REMOTE_LIMITS.queue) {
      if (!available() || Date.now() > deadline) throw new Error('원격 연결이 응답하지 않습니다.')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    if (!available()) throw new Error('원격 연결이 종료됐습니다.')
    this.channel.send(data)
  }
  async forward(frame: RemoteFrame) {
    if (this.closed) throw new Error('원격 연결이 종료됐습니다.')
    if (this.suspended) throw new Error('기기와 다시 연결하는 중입니다. 연결 후 다시 시도해 주세요.')
    if (frame.type === 'request' || frame.type === 'socket') {
      if (this.forwarded.has(frame.id) || this.requests.has(frame.id) || this.sockets.has(frame.id)) throw new Error('중복된 원격 요청입니다.')
      const entry = { ready: Promise.resolve(), outgoing: Promise.resolve(), admission: new AbortController(), release: undefined as (() => void) | undefined, socket: frame.type === 'socket' }
      this.forwarded.set(frame.id, entry)
      entry.ready = this.slots.acquire(entry.admission.signal, frame.type).then(async release => {
        if (this.forwarded.get(frame.id) !== entry || this.closed) { release(); return }
        entry.release = release
        await this.send(frame)
      }).catch(error => {
        if (entry.admission.signal.aborted) return
        if (this.forwarded.get(frame.id) === entry) this.forwarded.delete(frame.id)
        entry.release?.(); throw error
      })
      entry.outgoing = entry.ready
      await entry.ready
      return
    }
    const entry = this.forwarded.get(frame.id)
    if (!entry) return
    if ((frame.type === 'cancel' || frame.type === 'close') && !entry.release) {
      this.forwarded.delete(frame.id); entry.admission.abort(); return
    }
    const outgoing = entry.outgoing.then(async () => {
      if (this.forwarded.get(frame.id) !== entry || this.closed) return
      await this.send(frame)
      if (frame.type === 'cancel' || frame.type === 'close') { this.forwarded.delete(frame.id); entry.release?.() }
    })
    entry.outgoing = outgoing
    await outgoing
  }
  async resetForwarded() {
    const entries = [...this.forwarded.entries()]
    this.forwarded.clear()
    await Promise.all(entries.map(async ([id, entry]) => {
      entry.admission.abort()
      try { if (entry.release) await this.send({ type: entry.socket ? 'close' : 'cancel', id }) }
      finally { entry.release?.() }
    }))
  }
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.closed) throw new Error('원격 연결이 종료됐습니다.')
    if (this.suspended) throw new Error('기기와 다시 연결하는 중입니다. 연결 후 다시 시도해 주세요.')
    const generation = this.generation
    const request = new Request(input instanceof Request ? input : new URL(String(input), location.origin), init)
    const url = new URL(request.url)
    const capability = previewRemotePath(url.pathname + url.search) ? 'port-preview' as const : undefined
    if (url.origin !== location.origin || !remotePath(url.pathname + url.search, false, capability)) throw new Error('이 요청은 원격 접속에서 지원되지 않습니다.')
    const signal = request.signal, release = await this.slots.acquire(signal)
    if (this.closed || this.suspended || generation !== this.generation) { release(); throw new Error('원격 요청이 중단됐습니다. 결과를 확인한 뒤 다시 시도해 주세요.') }
    const id = crypto.randomUUID()
    return new Promise<Response>((resolve, reject) => {
      const abort = () => { const pending = this.requests.get(id); pending?.controller?.error(new DOMException('취소됐습니다.', 'AbortError')); pending?.reject(new DOMException('취소됐습니다.', 'AbortError')); this.requests.delete(id); void this.send({ type: 'cancel', id }).catch(() => {}).finally(cleanup) }
      let timer = setTimeout(abort, 30_000)
      const progress = () => { if (!this.requests.get(id)?.responded) { clearTimeout(timer); timer = setTimeout(abort, 30_000) } }
      const cleanup = () => { pending.flow?.close(); clearTimeout(timer); signal.removeEventListener('abort', abort); release() }
      const pending: PendingRequest = { resolve, reject, cleanup, responseStarted: () => clearTimeout(timer), responded: false, sentAt: performance.now() }
      this.requests.set(id, pending)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      void (async () => {
        const headers = Object.fromEntries([...request.headers].filter(([key]) => capability === 'port-preview' ? !['cookie','host','origin','referer','connection','upgrade','content-length','x-mew-session'].includes(key.toLowerCase()) : (REMOTE_REQUEST_HEADERS as readonly string[]).includes(key)))
        await this.send({ type: 'request', ...(capability ? { capability } : {}), id, method: request.method, path: url.pathname + url.search, headers, responseWindow: REMOTE_LIMITS.responseWindow, flowControl: REMOTE_FLOW_CONTROL })
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
      })().catch(error => { const pending = this.requests.get(id); if (!pending) return; pending.controller?.error(error); this.requests.delete(id); reject(error); void this.send({ type: 'cancel', id }).catch(() => {}).finally(cleanup) })
    })
  }
  socket(url: string, protocols?: string | string[]) {
    if (this.closed) throw new Error('원격 연결이 종료됐습니다.')
    const parsed = new URL(url, location.origin)
    const capability = previewRemotePath(parsed.pathname + parsed.search, true) ? 'port-preview' as const : undefined
    if (parsed.host !== location.host || !remotePath(parsed.pathname + parsed.search, true, capability)) throw new Error('지원하지 않는 원격 소켓입니다.')
    const requested = typeof protocols === 'string' ? [protocols] : protocols ?? []
    if (requested.length > 16 || new Set(requested).size !== requested.length || requested.some(protocol => typeof protocol !== 'string' || protocol.length > 256 || !/^[!#$%&'*+\-.^_`|~\w]+$/.test(protocol))) throw new DOMException('잘못된 WebSocket 프로토콜입니다.', 'SyntaxError')
    const id = crypto.randomUUID(), socket = new RemoteSocket(this, id, url)
    this.sockets.set(id, socket)
    if (this.suspended) { queueMicrotask(() => socket.finish(1006)); return socket as unknown as WebSocket }
    void this.slots.acquire(socket.admission.signal, 'socket').then(release => {
      if (socket.readyState !== WebSocket.CONNECTING) { release(); return }
      socket.release = release
      socket.sentAt = performance.now()
      return this.send({ type: 'socket', ...(capability ? { capability } : {}), id, path: parsed.pathname + parsed.search, ...(requested.length ? { protocols: requested } : {}), flowControl: REMOTE_FLOW_CONTROL })
    }).catch(() => socket.finish(1006))
    return socket as unknown as WebSocket
  }
  receive = (event: MessageEvent) => {
    if (this.closed || this.suspended) return
    const started = performance.now()
    try {
      const frame = parseRemoteFrame(event.data)
      if ((frame.type === 'response' || frame.type === 'open') && frame.flowControl?.separateStreams && (this.forwarded.has(frame.id) || this.requests.has(frame.id) || this.sockets.has(frame.id))) this.slots.enableSeparate()
      const forwarded = this.forwarded.get(frame.id)
      if (forwarded) {
        if (frame.type === 'error' || (forwarded.socket ? frame.type === 'close' : frame.type === 'end')) { this.forwarded.delete(frame.id); forwarded.release?.() }
        return
      }
      const pending = this.requests.get(frame.id), socket = this.sockets.get(frame.id)
      if (socket) {
        if (frame.type === 'open') {
          if (frame.flowControl) socket.flow = new RemoteReceiveWindow(frame.flowControl.maxWindow, performance.now() - socket.sentAt, () => 0, count => {
            if (socket.readyState !== WebSocket.OPEN) return
            void this.send({ type: 'credit', id: frame.id, count }).catch(() => { if (this.sockets.get(frame.id) === socket) this.close() })
          })
          socket.protocol = frame.protocol ?? ''; socket.readyState = WebSocket.OPEN; socket.fire(new Event('open'))
        }
        if (frame.type === 'message') { socket.flow?.take(); socket.message(frame); socket.flow?.consumed(performance.now() - started) }
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
        const highWaterMark = (frame.flowControl?.maxWindow ?? pending.window) * REMOTE_LIMITS.chunk
        pending.queuedBytes = 0
        if (frame.flowControl) pending.flow = new RemoteReceiveWindow(frame.flowControl.maxWindow, performance.now() - pending.sentAt, () => Math.ceil(Math.max(0, highWaterMark - (pending.controller?.desiredSize ?? 0)) / REMOTE_LIMITS.chunk), count => {
          if (!this.requests.has(frame.id)) return
          const generation = this.generation
          void this.send({ type: 'credit', id: frame.id, count }).catch(() => { if (generation === this.generation && this.requests.has(frame.id)) this.close() })
        })
        const replenish = () => {
          if (!this.requests.has(frame.id) || !pending.controller) return
          if (pending.flow) {
            const queued = Math.max(0, highWaterMark - (pending.controller.desiredSize ?? 0))
            if (queued < pending.queuedBytes!) pending.flow.activate()
            pending.queuedBytes = queued
            pending.flow.refresh()
            return
          }
          const free = Math.floor((pending.controller.desiredSize ?? 0) / REMOTE_LIMITS.chunk)
          const count = Math.max(0, Math.min(pending.window!, free) - pending.outstanding!)
          pending.outstanding! += count
          const generation = this.generation
          for (let i = 0; i < count; i++) void this.send({ type: 'credit', id: frame.id }).catch(() => { if (generation === this.generation && this.requests.has(frame.id)) this.close() })
        }
        const stream = new ReadableStream<Uint8Array>({
          start: controller => { pending.controller = controller },
          pull: replenish,
          cancel: () => { this.requests.delete(frame.id); return this.send({ type: 'cancel', id: frame.id }).catch(() => {}).finally(pending.cleanup) },
        }, { highWaterMark, size: bytes => bytes.byteLength })
        pending.resolve(new Response([204, 205, 304].includes(frame.status) ? null : stream, { status: frame.status, headers: frame.headers })); return
      }
      if (frame.type === 'chunk') {
        const bytes = decode(frame.data)
        if (!pending.controller || (pending.controller.desiredSize ?? 0) < bytes.byteLength) throw new Error('response-limit')
        if (pending.flow) pending.flow.take()
        else { if (!pending.outstanding) throw new Error('response-limit'); pending.outstanding-- }
        pending.queuedBytes! += bytes.byteLength
        pending.controller.enqueue(bytes)
        pending.flow?.consumed(performance.now() - started, false)
        return
      }
      if (frame.type === 'end') { pending.controller?.close(); pending.cleanup(); this.requests.delete(frame.id); return }
      if (frame.type === 'error') { const error = new Error('원격 요청이 중단됐습니다. 결과를 확인한 뒤 다시 시도해 주세요.'); pending.controller?.error(error); pending.reject(error); pending.cleanup(); this.requests.delete(frame.id) }
    } catch { this.close() }
  }
  private disconnectPending(error: Error) {
    this.slots.close()
    for (const entry of this.forwarded.values()) { entry.admission.abort(); entry.release?.() }
    this.forwarded.clear()
    for (const pending of this.requests.values()) { pending.controller?.error(error); pending.reject(error); pending.cleanup() }
    this.requests.clear()
    for (const socket of this.sockets.values()) socket.finish(1006)
  }
  suspendForReconnect() {
    if (this.closed || this.suspended) return
    this.suspended = true
    this.generation++
    this.disconnectPending(new Error('원격 요청이 중단됐습니다. 결과를 확인한 뒤 다시 시도해 주세요.'))
  }
  resumeAfterReconnect() {
    if (this.closed || !this.suspended) return
    this.slots = new RemoteStreamSlots()
    this.suspended = false
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.generation++
    this.disconnectPending(new Error('원격 연결이 종료됐습니다.'))
    this.channel.removeEventListener('message', this.receive)
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
  admission = new AbortController()
  release?: () => void
  sentAt = 0
  flow?: RemoteReceiveWindow
  parts: Uint8Array[] = []; receivedBytes = 0; sequence = 0
  constructor(transport: DataChannelTransport, id: string, url: string) {
    super(); this.transport = transport; this.id = id; this.url = url
    for (const type of ['open', 'message', 'close', 'error']) this.addEventListener(type, event => {
      const callback = this[`on${type}` as 'onopen'] as ((event: Event) => void) | null
      callback?.call(this, event)
    })
  }
  fire(event: Event) { this.dispatchEvent(event) }
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
        if (this.readyState !== WebSocket.OPEN) return
        if (!bytes.length) await this.transport.send({ type: 'message', id: this.id, data: '', binary })
        for (let offset = 0, part = 0; offset < bytes.length; offset += REMOTE_LIMITS.chunk, part++) {
          if (this.readyState !== WebSocket.OPEN) return
          await this.transport.send({ type: 'message', id: this.id, data: encode(bytes.subarray(offset, offset + REMOTE_LIMITS.chunk)), binary, sequence: part, final: offset + REMOTE_LIMITS.chunk >= bytes.length })
        }
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
  close() { if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) return; this.readyState = WebSocket.CLOSING; if (this.release) void this.transport.send({ type: 'close', id: this.id }).then(() => this.finish(1000), () => this.finish(1006)); else this.finish(1000) }
  finish(code: number) { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSED; this.flow?.close(); this.transport.sockets.delete(this.id); this.admission.abort(); this.release?.(); this.fire(new CloseEvent('close', { code, wasClean: code === 1000 })) }
}
