import http, { type Server } from 'node:http'
import { duplexPair } from 'node:stream'
import { WebSocket } from 'ws'
import type { AuthenticatedSession } from './auth.ts'
import { bindRemoteSocket, remoteUiRequest, type RemoteContext } from './remote-access-context.ts'
import { REMOTE_LIMITS, REMOTE_REQUEST_HEADERS, parseRemoteFrame, type RemoteFrame } from '../shared/remote-access.ts'
import { RemoteSendWindow } from './remote-send-window.ts'
const REQUEST_HEADERS = new Set<string>(REMOTE_REQUEST_HEADERS)
const RESPONSE_HEADERS = new Set(['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'cache-control', 'x-mew-pdf-revision', 'x-mew-pdf-editable'])
const bodyBudgets = new WeakMap<Server, { bytes: number }>()
export interface RemoteWire { send(value: string): Promise<void>; close(): void }
/** Uses the same HTTP parser/routes and WS handlers without opening a localhost proxy port. */
export function remoteDispatcher(server: Server, wire: RemoteWire, current: () => AuthenticatedSession | null, origin: string, local?: Omit<RemoteContext, 'current'> & { alive(): boolean; accessRevision?(): string }) {
  const operations = new Map<string, { socket: boolean; close(): void; write?(value: RemoteFrame): void; authority?: string }>()
  const budget = bodyBudgets.get(server) ?? { bytes: 0 }; bodyBudgets.set(server, budget)
  let closed = false, sessionGeneration = 0, separateStreams = false
  const alive = () => local ? local.alive() : !!current()
  const authority = () => { const session = current(); return JSON.stringify([sessionGeneration, session?.email ?? null, session?.user.role ?? null, session?.user.mustChangePassword ?? false, local?.accessRevision?.() ?? 0]) }
  const revalidate = () => {
    if (!local || closed) return
    const now = authority()
    for (const [id, op] of operations) if (op.authority !== undefined && op.authority !== now) {
      op.close()
      if (!closed && alive()) void wire.send(JSON.stringify({ type: 'error', id, code: 'permission-revoked' })).catch(close)
    }
  }
  const send = async (frame: RemoteFrame, required?: string) => { revalidate(); if (closed || !alive() || (required !== undefined && required !== authority())) throw new Error('permission-revoked'); await wire.send(JSON.stringify(frame)) }
  const close = () => { if (closed) return; closed = true; clearInterval(timer); for (const op of operations.values()) op.close(); operations.clear(); wire.close() }
  const timer = setInterval(() => { if (!alive()) close(); else revalidate() }, 1000); timer.unref()
  function streams(id: string, transition: () => void, capability?: 'port-preview') {
    const [client, host] = duplexPair()
    let boundGeneration = sessionGeneration
    const changeAuthentication = <T>(change: () => T): T => {
      if (closed || boundGeneration !== sessionGeneration || !operations.has(id)) throw new Error('permission-revoked')
      const result = change()
      boundGeneration = ++sessionGeneration
      transition()
      revalidate()
      return result
    }
    const context: RemoteContext = local ? {
      ...local,
      current: () => boundGeneration === sessionGeneration ? current() : null,
      sessionToken: () => boundGeneration === sessionGeneration ? local.sessionToken?.() ?? null : null,
      setSessionToken: token => {
        changeAuthentication(() => local.setSessionToken?.(token))
      },
      activateMewlink: local.activateMewlink ? () => changeAuthentication(() => local.activateMewlink!()) : undefined,
      updateAccountAccess: action => {
        const operation = operations.get(id)
        if (closed || boundGeneration !== sessionGeneration || !operation || operation.authority !== authority()) throw new Error('permission-revoked')
        operation.authority = undefined
        try { return action() }
        finally { transition(); revalidate() }
      },
      trustDevice: local.trustDevice ? label => changeAuthentication(() => local.trustDevice!(label)) : undefined,
    } : { current }
    context.capability = capability
    bindRemoteSocket(host, context)
    server.emit('connection', host)
    return { client, host }
  }
  async function receive(raw: string) {
    try {
      if (closed || !alive()) { close(); return }
      revalidate()
      const value = parseRemoteFrame(raw)
      if (['credit', 'chunk', 'end', 'message'].includes(value.type) && !operations.has(value.id)) return
      if (value.type === 'cancel' || value.type === 'close') { operations.get(value.id)?.close(); operations.delete(value.id); return }
      if (value.type === 'chunk' || value.type === 'end' || value.type === 'message' || value.type === 'credit') { const op = operations.get(value.id); if (!op?.write) throw new Error('unknown-operation'); op.write(value); return }
      if (value.type !== 'request' && value.type !== 'socket') throw new Error('invalid-direction')
      if (value.flowControl?.separateStreams) separateStreams = true
      const sameKind = [...operations.values()].filter(operation => operation.socket === (value.type === 'socket')).length
      if (operations.has(value.id) || operations.size >= REMOTE_LIMITS.streams * (separateStreams ? 2 : 1) || (separateStreams && sameKind >= REMOTE_LIMITS.streams)) throw new Error('stream-limit')
      const bootstrap = value.type === 'request' && (remoteUiRequest(value.method, value.path) || (value.method === 'GET' && ['/api/auth/me', '/api/auth/mewlink'].includes(value.path.split('?')[0])) || (value.method === 'POST' && ['/api/auth/login', '/api/auth/logout', '/api/auth/change-password', '/api/auth/mewlink/request', '/api/auth/mewlink/login'].includes(value.path.split('?')[0])))
      const session = current()
      let required = local && !(value.type === 'request' && remoteUiRequest(value.method, value.path)) ? authority() : undefined
      if (local && !bootstrap && (!session || session.user.mustChangePassword)) {
        const temporary = !!session?.user.mustChangePassword
        if (value.type === 'socket') await send({ type: 'error', id: value.id, code: temporary ? 'must-change-password' : 'login-required' })
        else {
          const body = Buffer.from(JSON.stringify({ error: temporary ? '임시 비밀번호를 먼저 변경해야 합니다' : '로그인이 필요합니다', code: temporary ? 'must-change-password' : 'login-required' })).toString('base64')
          await send({ type: 'response', id: value.id, status: temporary ? 403 : 401, headers: { 'content-type': 'application/json' }, ...(value.responseWindow ? { responseWindow: value.responseWindow } : {}) })
          await send({ type: 'chunk', id: value.id, data: body })
          await send({ type: 'end', id: value.id })
        }
        return
      }
      const { client, host } = streams(value.id, () => {
        required = authority()
        const operation = operations.get(value.id)
        if (operation) operation.authority = required
      }, value.capability)
      if (value.type === 'socket') {
        const window = value.flowControl ? new RemoteSendWindow(REMOTE_LIMITS.responseWindow, value.flowControl.maxWindow) : undefined
        const ws = new WebSocket(`ws://${new URL(origin).host}${value.path}`, value.protocols ?? [], { createConnection: () => client as never, origin, headers: { 'X-Forwarded-Proto': new URL(origin).protocol.slice(0, -1) }, maxPayload: REMOTE_LIMITS.body })
        let parts: Buffer[] = [], sequence = 0, bytesReceived = 0, outgoing = Promise.resolve(), queuedBytes = 0, inFlight = 0, socketClosed = false
        const finishSocket = () => { if (socketClosed) return false; socketClosed = true; window?.close(); budget.bytes -= bytesReceived + queuedBytes + inFlight; bytesReceived = queuedBytes = inFlight = 0; parts = []; operations.delete(value.id); ws.terminate(); client.destroy(); host.destroy(); return true }
        const failSocket = () => { if (finishSocket()) void send({ type: 'error', id: value.id, code: 'socket-failed' }).catch(close) }
        operations.set(value.id, { socket: true, close: finishSocket, authority: required, write: frame => {
          if (frame.type === 'credit' && window) { window.grant(frame.count ?? 1); return }
          if (frame.type !== 'message') throw new Error('invalid-direction')
          if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) return
          if (ws.readyState !== WebSocket.OPEN) throw new Error('socket-not-open')
          const bytes = Buffer.from(frame.data, 'base64')
          if (bytesReceived + bytes.length > REMOTE_LIMITS.body || budget.bytes + bytes.length > REMOTE_LIMITS.uploads || (frame.sequence !== undefined && frame.sequence !== sequence++)) throw new Error('message-limit')
          bytesReceived += bytes.length; budget.bytes += bytes.length
          parts.push(bytes)
          if (frame.sequence === undefined || frame.final) { const message = Buffer.concat(parts); parts = []; bytesReceived = 0; sequence = 0; inFlight += message.length; ws.send(frame.binary ? message : message.toString('utf8'), error => { if (!socketClosed) { budget.bytes -= message.length; inFlight -= message.length }; if (error) failSocket() }); if (ws.bufferedAmount > REMOTE_LIMITS.body) close() } } })
        ws.on('open', () => { void send({ type: 'open', id: value.id, ...(ws.protocol ? { protocol: ws.protocol } : {}), ...(value.flowControl ? { flowControl: value.flowControl } : {}) }, required).catch(() => { if (!socketClosed) close() }) })
        ws.on('message', (data, binary) => {
          const bytes = Buffer.from(data as Buffer)
          if (queuedBytes + bytes.length > REMOTE_LIMITS.body || budget.bytes + bytes.length > REMOTE_LIMITS.uploads) { close(); return }
          queuedBytes += bytes.length; budget.bytes += bytes.length
          outgoing = outgoing.then(async () => {
            if (socketClosed) return
            if (!bytes.length) { await window?.take(); await send({ type: 'message', id: value.id, data: '', binary }, required) }
            for (let offset = 0, part = 0; offset < bytes.length; offset += REMOTE_LIMITS.chunk, part++) { await window?.take(); await send({ type: 'message', id: value.id, data: bytes.subarray(offset, offset + REMOTE_LIMITS.chunk).toString('base64'), binary, sequence: part, final: offset + REMOTE_LIMITS.chunk >= bytes.length }, required) }
          }).catch(() => { if (!socketClosed) close() }).finally(() => { if (!socketClosed) { queuedBytes -= bytes.length; budget.bytes -= bytes.length } })
        })
        ws.on('close', code => {
          outgoing = outgoing.then(async () => { if (finishSocket()) await send({ type: 'close', id: value.id, code }) }).catch(() => { if (!socketClosed) close() })
        })
        ws.on('error', failSocket)
        return
      }
      const headers: Record<string, string> = { host: new URL(origin).host, origin, 'x-forwarded-proto': new URL(origin).protocol.slice(0, -1) }
      for (const [key, val] of Object.entries(value.headers)) if (value.capability === 'port-preview' ? !['cookie','host','origin','referer','connection','upgrade','content-length','x-mew-session','x-forwarded-proto'].includes(key.toLowerCase()) : REQUEST_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = val
      delete headers['content-length']
      const req = http.request({ host: new URL(origin).hostname, port: 80, path: value.path, method: value.method, headers, createConnection: () => client as never })
      let size = 0, ended = false, finished = false
      const window = new RemoteSendWindow(value.flowControl ? REMOTE_LIMITS.responseWindow : value.responseWindow ?? 0, value.flowControl?.maxWindow ?? REMOTE_LIMITS.responseWindow)
      const finish = () => { if (finished) return; finished = true; budget.bytes -= size; window.close(); req.destroy(); client.destroy(); host.destroy(); operations.delete(value.id) }
      const write = (bytes: Buffer) => { if (size + bytes.length > REMOTE_LIMITS.body || budget.bytes + bytes.length > REMOTE_LIMITS.uploads || req.writableLength + bytes.length > REMOTE_LIMITS.queue) throw new Error('body-limit'); size += bytes.length; budget.bytes += bytes.length; req.write(bytes) }
      operations.set(value.id, { socket: false, close: finish, authority: required, write: frame => {
        if (frame.type === 'credit') { if (!value.flowControl && frame.count !== undefined) throw new Error('invalid-credit'); window.grant(frame.count ?? 1); return }
        if (ended) throw new Error('request-ended')
        if (frame.type === 'end') { ended = true; req.end(); return }
        if (frame.type !== 'chunk') throw new Error('invalid-direction')
        write(Buffer.from(frame.data, 'base64'))
      } })
      req.on('response', async res => {
        try {
          const responseHeaders: Record<string, string> = {}
          for (const [key, val] of Object.entries(res.headers)) if ((RESPONSE_HEADERS.has(key) || (value.capability === 'port-preview' && !['set-cookie','connection','transfer-encoding','content-security-policy','x-mew-session'].includes(key)) || (key === 'content-encoding' && remoteUiRequest(value.method, value.path))) && typeof val === 'string') responseHeaders[key] = val
          const authSessionResponse = (value.method === 'POST' && ['/api/auth/login', '/api/auth/logout', '/api/auth/change-password', '/api/auth/mewlink/login', '/api/auth/remote-device'].includes(value.path.split('?')[0])) || (value.method === 'GET' && value.path.split('?')[0] === '/api/auth/me')
          if (local && authSessionResponse && typeof res.headers['x-mew-session'] === 'string') responseHeaders['x-mew-session'] = res.headers['x-mew-session']
          await send({ type: 'response', id: value.id, status: res.statusCode ?? 500, headers: responseHeaders, ...(value.responseWindow ? { responseWindow: value.responseWindow } : {}), ...(value.flowControl ? { flowControl: value.flowControl } : {}) }, required)
          for await (const chunk of res) {
            const bytes = Buffer.from(chunk)
            for (let i = 0; i < bytes.length; i += REMOTE_LIMITS.chunk) { await window.take(); await send({ type: 'chunk', id: value.id, data: bytes.subarray(i, i + REMOTE_LIMITS.chunk).toString('base64') }, required) }
          }
          finish()
          await send({ type: 'end', id: value.id }, required)
        } catch { finish(); if (!closed) await send({ type: 'error', id: value.id, code: 'response-interrupted' }).catch(close) }
        finally { finish() }
      })
      req.on('error', () => { if (operations.has(value.id)) { finish(); void send({ type: 'error', id: value.id, code: 'request-failed' }).catch(close) } })
      if (value.body) { const bytes = Buffer.from(value.body, 'base64'); if (bytes.length > REMOTE_LIMITS.chunk) throw new Error('body-limit'); write(bytes) }
      if (value.method === 'GET' || value.method === 'HEAD') { ended = true; req.end() } else req.flushHeaders()
    } catch { close() }
  }
  return { receive, close, revalidate }
}
