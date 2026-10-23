import type { IncomingMessage, Server } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import { WebSocket, WebSocketServer } from 'ws'
import { accessChanges } from './access-policy.ts'
import { webSocketOriginAllowed } from './websocket-origin.ts'
import { LIVE_WS_PATH, type LiveMessage, type LiveResource } from '../shared/live-updates.ts'

export interface LiveSource {
  key: string
  interval: number
  allowed(): boolean
  read(): Promise<Record<string, unknown>>
}
type Subscriber = { ws: WebSocket; id: string; source: LiveSource; revision: number; error?: string }
type Group = { subscribers: Set<Subscriber>; timer?: ReturnType<typeof setTimeout>; running: boolean; revision: number; fields?: Record<string, string> }

/** One read per scope, with no data frames while its serialized state is unchanged. */
export function attachLiveWebSocket(server: Server | Http2SecureServer, sourceFor: (req: IncomingMessage, resource: LiveResource) => LiveSource) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })
  const groups = new Map<string, Group>()
  const subscriptions = new Map<WebSocket, Map<string, Subscriber>>()
  let closed = false
  const send = (subscriber: Subscriber, value: LiveMessage) => {
    if (subscriber.ws.readyState !== WebSocket.OPEN) return
    if (subscriber.ws.bufferedAmount > 8 * 1024 * 1024) { subscriber.ws.close(1013, 'slow subscriber'); return }
    subscriber.ws.send(JSON.stringify(value))
  }
  const remove = (subscriber: Subscriber) => {
    subscriptions.get(subscriber.ws)?.delete(subscriber.id)
    const group = groups.get(subscriber.source.key)
    group?.subscribers.delete(subscriber)
    if (group && !group.subscribers.size) { clearTimeout(group.timer); groups.delete(subscriber.source.key) }
  }
  const check = (subscriber: Subscriber) => {
    let allowed = false
    try { allowed = subscriber.source.allowed() } catch { /* A failed permission read grants no access. */ }
    if (allowed && subscriber.ws.readyState === WebSocket.OPEN) return true
    send(subscriber, { type: 'error', id: subscriber.id, message: '구독 권한 또는 프로젝트가 변경되었습니다.' })
    remove(subscriber)
    return false
  }
  const tick = async (key: string, group: Group) => {
    if (closed || group.running || groups.get(key) !== group) return
    clearTimeout(group.timer)
    group.running = true
    try {
      const readers = [...group.subscribers].filter(check)
      if (!readers.length) return
      const value = await readers[0].source.read()
      if (closed || groups.get(key) !== group) return
      const fields = Object.fromEntries(Object.entries(value).map(([name, field]) => [name, JSON.stringify(field)]))
      const changed = Object.fromEntries(Object.entries(fields).filter(([name, field]) => group.fields?.[name] !== field).map(([name]) => [name, value[name]]))
      const removed = Object.keys(group.fields ?? {}).filter(name => !(name in fields))
      const base = group.revision
      if (!group.fields || Object.keys(changed).length || removed.length) group.revision++
      group.fields = fields
      for (const subscriber of [...group.subscribers]) {
        if (!check(subscriber)) continue
        // A new/reconnected listener always receives a fresh complete snapshot.
        if (!subscriber.revision || subscriber.error || subscriber.revision !== base) {
          send(subscriber, { type: 'snapshot', id: subscriber.id, revision: group.revision, value })
        } else if (subscriber.revision !== group.revision) {
          send(subscriber, { type: 'patch', id: subscriber.id, base, revision: group.revision, value: changed, removed })
        }
        subscriber.revision = group.revision; subscriber.error = undefined
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '상태 조회에 실패했습니다.'
      for (const subscriber of [...group.subscribers]) {
        if (check(subscriber) && subscriber.error !== message) { send(subscriber, { type: 'error', id: subscriber.id, message }); subscriber.error = message }
      }
    } finally {
      group.running = false
      if (!closed && groups.get(key) === group && group.subscribers.size) {
        group.timer = setTimeout(() => { void tick(key, group) }, [...group.subscribers][0].source.interval)
        group.timer.unref()
      }
    }
  }
  const recheck = () => { for (const clients of subscriptions.values()) for (const subscriber of [...clients.values()]) check(subscriber) }
  accessChanges.on('change', recheck)
  const heartbeat = setInterval(() => {
    recheck()
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue }
      alive.set(ws, false); ws.ping()
    }
  }, 30_000)
  heartbeat.unref()
  const alive = new WeakMap<WebSocket, boolean>()
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clients = new Map<string, Subscriber>(); subscriptions.set(ws, clients); alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))
    ws.on('error', () => ws.close())
    ws.on('close', () => { for (const subscriber of [...clients.values()]) remove(subscriber); subscriptions.delete(ws) })
    ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString())
        if (!message || !/^[a-zA-Z0-9_-]{1,80}$/.test(message.id)) throw new Error('잘못된 구독 요청입니다.')
        const previous = clients.get(message.id)
        if (previous) remove(previous)
        if (message.type === 'unsubscribe') return
        if (message.type !== 'subscribe' || clients.size >= 64) throw new Error('구독 요청 제한을 확인하세요.')
        const source = sourceFor(req, message.resource)
        const subscriber: Subscriber = { ws, id: message.id, source, revision: 0 }
        if (!check(subscriber)) return
        clients.set(message.id, subscriber)
        let group = groups.get(source.key)
        if (!group) { group = { subscribers: new Set(), revision: 0, running: false }; groups.set(source.key, group) }
        group.subscribers.add(subscriber)
        void tick(source.key, group)
      } catch (error) {
        // Malformed clients cannot manufacture arbitrary resource readers.
        let id: unknown
        try { id = JSON.parse(raw.toString()).id } catch { /* Ignore malformed JSON. */ }
        if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)) ws.send(JSON.stringify({ type: 'error', id, message: error instanceof Error ? error.message : '잘못된 구독 요청입니다.' }))
        else ws.close(1008, 'invalid subscription')
      }
    })
  })
  const upgrade = (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    if (new URL(req.url ?? '', 'http://localhost').pathname !== LIVE_WS_PATH) return
    if (!webSocketOriginAllowed(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  }
  server.on('upgrade', upgrade)
  server.once('close', () => {
    closed = true; clearInterval(heartbeat); accessChanges.off('change', recheck); server.off('upgrade', upgrade)
    for (const group of groups.values()) clearTimeout(group.timer)
    groups.clear(); for (const ws of wss.clients) ws.terminate(); wss.close()
  })
}
