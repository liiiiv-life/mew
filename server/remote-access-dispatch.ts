import http, { type Server } from 'node:http'
import { duplexPair } from 'node:stream'
import { WebSocket } from 'ws'
import type { AuthenticatedSession } from './auth.ts'
import { bindRemoteSocket } from './remote-access-context.ts'
import { REMOTE_LIMITS, REMOTE_REQUEST_HEADERS, parseRemoteFrame, type RemoteFrame } from '../shared/remote-access.ts'
const REQUEST_HEADERS = new Set<string>(REMOTE_REQUEST_HEADERS)
const RESPONSE_HEADERS = new Set(['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'cache-control', 'x-mew-pdf-revision', 'x-mew-pdf-editable'])
const bodyBudgets = new WeakMap<Server, { bytes: number }>()
export interface RemoteWire { send(value: string): Promise<void>; close(): void }
/** Uses the same HTTP parser/routes and WS handlers without opening a localhost proxy port. */
export function remoteDispatcher(server: Server, wire: RemoteWire, current: () => AuthenticatedSession | null, origin: string) {
  const operations = new Map<string, { close(): void; write?(value: RemoteFrame): void }>()
  const budget = bodyBudgets.get(server) ?? { bytes: 0 }; bodyBudgets.set(server, budget)
  let closed = false
  const send = async (frame: RemoteFrame) => { if (closed || !current()) throw new Error('permission-revoked'); await wire.send(JSON.stringify(frame)) }
  const close = () => { if (closed) return; closed = true; clearInterval(timer); for (const op of operations.values()) op.close(); operations.clear(); wire.close() }
  const timer = setInterval(() => { if (!current()) close() }, 1000); timer.unref()
  function streams() {
    const [client, host] = duplexPair()
    bindRemoteSocket(host, current)
    server.emit('connection', host)
    return { client, host }
  }
  async function receive(raw: string) {
    try {
      if (closed || !current()) { close(); return }
      const value = parseRemoteFrame(raw)
      if (['credit', 'chunk', 'end', 'message'].includes(value.type) && !operations.has(value.id)) return
      if (value.type === 'cancel' || value.type === 'close') { operations.get(value.id)?.close(); operations.delete(value.id); return }
      if (value.type === 'chunk' || value.type === 'end' || value.type === 'message' || value.type === 'credit') { const op = operations.get(value.id); if (!op?.write) throw new Error('unknown-operation'); op.write(value); return }
      if (value.type !== 'request' && value.type !== 'socket') throw new Error('invalid-direction')
      if (operations.has(value.id) || operations.size >= REMOTE_LIMITS.streams) throw new Error('stream-limit')
      const { client, host } = streams()
      if (value.type === 'socket') {
        const ws = new WebSocket(`ws://${new URL(origin).host}${value.path}`, { createConnection: () => client as never, origin, headers: { 'X-Forwarded-Proto': new URL(origin).protocol.slice(0, -1) }, maxPayload: REMOTE_LIMITS.body })
        let parts: Buffer[] = [], sequence = 0, bytesReceived = 0, outgoing = Promise.resolve(), queuedBytes = 0, inFlight = 0, socketClosed = false
        const finishSocket = () => { if (socketClosed) return; socketClosed = true; budget.bytes -= bytesReceived + queuedBytes + inFlight; bytesReceived = queuedBytes = inFlight = 0; parts = []; ws.terminate(); client.destroy(); host.destroy() }
        operations.set(value.id, { close: finishSocket, write: frame => { if (frame.type !== 'message' || ws.readyState !== WebSocket.OPEN) throw new Error('socket-not-open'); const bytes = Buffer.from(frame.data, 'base64')
          if (bytesReceived + bytes.length > REMOTE_LIMITS.body || budget.bytes + bytes.length > REMOTE_LIMITS.uploads || (frame.sequence !== undefined && frame.sequence !== sequence++)) throw new Error('message-limit')
          bytesReceived += bytes.length; budget.bytes += bytes.length
          parts.push(bytes)
          if (frame.sequence === undefined || frame.final) { const message = Buffer.concat(parts); parts = []; bytesReceived = 0; sequence = 0; inFlight += message.length; ws.send(frame.binary ? message : message.toString('utf8'), error => { if (!socketClosed) { budget.bytes -= message.length; inFlight -= message.length }; if (error) close() }); if (ws.bufferedAmount > REMOTE_LIMITS.body) close() } } })
        ws.on('open', () => { void send({ type: 'open', id: value.id }).catch(close) })
        ws.on('message', (data, binary) => {
          const bytes = Buffer.from(data as Buffer)
          if (queuedBytes + bytes.length > REMOTE_LIMITS.body || budget.bytes + bytes.length > REMOTE_LIMITS.uploads) { close(); return }
          queuedBytes += bytes.length; budget.bytes += bytes.length
          outgoing = outgoing.then(async () => {
            if (socketClosed) return
            if (!bytes.length) await send({ type: 'message', id: value.id, data: '', binary })
            for (let offset = 0, part = 0; offset < bytes.length; offset += REMOTE_LIMITS.chunk, part++) await send({ type: 'message', id: value.id, data: bytes.subarray(offset, offset + REMOTE_LIMITS.chunk).toString('base64'), binary, sequence: part, final: offset + REMOTE_LIMITS.chunk >= bytes.length })
          }).catch(close).finally(() => { if (!socketClosed) { queuedBytes -= bytes.length; budget.bytes -= bytes.length } })
        })
        ws.on('close', code => { finishSocket(); operations.delete(value.id); void send({ type: 'close', id: value.id, code }).catch(close) })
        ws.on('error', () => { void send({ type: 'error', id: value.id, code: 'socket-failed' }).catch(close) })
        return
      }
      const headers: Record<string, string> = { host: new URL(origin).host, origin, 'x-forwarded-proto': new URL(origin).protocol.slice(0, -1) }
      for (const [key, val] of Object.entries(value.headers)) if (REQUEST_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = val
      delete headers['content-length']
      const req = http.request({ host: new URL(origin).hostname, port: 80, path: value.path, method: value.method, headers, createConnection: () => client as never })
      let size = 0, ended = false, credits = value.responseWindow ?? 0, finished = false
      let wake: (() => void) | undefined
      const credit = async () => { while (!credits) { if (closed || !operations.has(value.id)) throw new Error('cancelled'); await new Promise<void>(resolve => { wake = resolve }) }; credits-- }
      const finish = () => { if (finished) return; finished = true; budget.bytes -= size; wake?.(); req.destroy(); client.destroy(); host.destroy(); operations.delete(value.id) }
      const write = (bytes: Buffer) => { if (size + bytes.length > REMOTE_LIMITS.body || budget.bytes + bytes.length > REMOTE_LIMITS.uploads || req.writableLength + bytes.length > REMOTE_LIMITS.queue) throw new Error('body-limit'); size += bytes.length; budget.bytes += bytes.length; req.write(bytes) }
      operations.set(value.id, { close: finish, write: frame => {
        if (frame.type === 'credit') { if (++credits > REMOTE_LIMITS.responseWindow) throw new Error('credit-limit'); wake?.(); wake = undefined; return }
        if (ended) throw new Error('request-ended')
        if (frame.type === 'end') { ended = true; req.end(); return }
        if (frame.type !== 'chunk') throw new Error('invalid-direction')
        write(Buffer.from(frame.data, 'base64'))
      } })
      req.on('response', async res => {
        try {
          const responseHeaders: Record<string, string> = {}
          for (const [key, val] of Object.entries(res.headers)) if (RESPONSE_HEADERS.has(key) && typeof val === 'string') responseHeaders[key] = val
          await send({ type: 'response', id: value.id, status: res.statusCode ?? 500, headers: responseHeaders, ...(value.responseWindow ? { responseWindow: value.responseWindow } : {}) })
          for await (const chunk of res) {
            const bytes = Buffer.from(chunk)
            for (let i = 0; i < bytes.length; i += REMOTE_LIMITS.chunk) { await credit(); await send({ type: 'chunk', id: value.id, data: bytes.subarray(i, i + REMOTE_LIMITS.chunk).toString('base64') }) }
          }
          await send({ type: 'end', id: value.id })
        } catch { if (!closed) await send({ type: 'error', id: value.id, code: 'response-interrupted' }).catch(close) }
        finally { finish() }
      })
      req.on('error', () => { if (operations.has(value.id)) { finish(); void send({ type: 'error', id: value.id, code: 'request-failed' }).catch(close) } })
      if (value.body) { const bytes = Buffer.from(value.body, 'base64'); if (bytes.length > REMOTE_LIMITS.chunk) throw new Error('body-limit'); write(bytes) }
      if (value.method === 'GET' || value.method === 'HEAD') { ended = true; req.end() } else req.flushHeaders()
    } catch { close() }
  }
  return { receive, close }
}
